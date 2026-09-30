"""Async ARC Satellite WebSocket client."""

from __future__ import annotations

import asyncio
import base64
import copy
import inspect
import json
import logging
import time
import uuid
from collections import defaultdict
from contextlib import suppress
from typing import Any, Callable, DefaultDict, Dict, Iterable, Optional

import websockets
from websockets.exceptions import ConnectionClosed

from .models import (
    CloseInfo,
    JsonObject,
    SatelliteOptions,
    SessionEndEvent,
    SessionStartEvent,
    TriggerDefinition,
)

EventHandler = Callable[[Any], Any]


class ArcSatelliteClient:
    """ARC Satellite client with session tracking, heartbeats and reconnects.

    Event handlers may be ordinary functions or async functions. Register them
    with ``on(event_name, handler)``. Supported names are ``open``, ``close``,
    ``error``, ``session-start``, ``session-end``, ``command``, ``message``,
    ``content`` and ``ack``.
    """

    def __init__(self, options: Optional[SatelliteOptions] = None) -> None:
        self.options = options or SatelliteOptions()
        self._handlers: DefaultDict[str, list[EventHandler]] = defaultdict(list)
        self._triggers: Dict[str, TriggerDefinition] = {}
        self._outbound: asyncio.Queue[JsonObject] = asyncio.Queue()
        self._pending_acks: Dict[str, asyncio.Future[JsonObject]] = {}
        self._socket: Any = None
        self._runner: Optional[asyncio.Task[None]] = None
        self._send_task: Optional[asyncio.Task[None]] = None
        self._stop = asyncio.Event()
        self._pong = asyncio.Event()
        self._pong_timed_out = False
        self._connected = False
        self._intentional_close = False
        self._session_id: Optional[str] = None
        self._customer: Optional[JsonObject] = None
        self._log = logging.getLogger("arc_satellite")
        self._register_locally(self.options.triggers)

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def session_id(self) -> Optional[str]:
        return self._session_id

    @property
    def customer(self) -> Optional[JsonObject]:
        return copy.deepcopy(self._customer)

    @property
    def websocket_uri(self) -> str:
        return self.options.websocket_uri

    def on(self, event_name: str, handler: EventHandler) -> EventHandler:
        """Register an event handler and return it for decorator-style use."""
        self._handlers[event_name].append(handler)
        return handler

    def off(self, event_name: str, handler: EventHandler) -> None:
        with suppress(ValueError):
            self._handlers[event_name].remove(handler)

    def event(self, event_name: str) -> Callable[[EventHandler], EventHandler]:
        """Decorator form of :meth:`on`."""
        def register(handler: EventHandler) -> EventHandler:
            return self.on(event_name, handler)
        return register

    async def connect(self) -> None:
        """Start the connection loop. Safe to call repeatedly."""
        if self._runner and not self._runner.done():
            return
        self._intentional_close = False
        self._stop.clear()
        self._runner = asyncio.create_task(
            self._connection_loop(), name="arc-satellite"
        )
        await asyncio.sleep(0)

    async def run_forever(self) -> None:
        """Connect and wait until :meth:`disconnect` is called."""
        await self.connect()
        if self._runner:
            await self._runner

    async def disconnect(self) -> None:
        """Stop the socket and all automatic reconnect attempts."""
        self._intentional_close = True
        self._stop.set()
        socket = self._socket
        if socket is not None:
            with suppress(Exception):
                await socket.close(code=1000, reason="client disconnect")
        if self._runner and self._runner is not asyncio.current_task():
            with suppress(asyncio.CancelledError, Exception):
                await self._runner

    async def send_trigger(
        self, trigger_id: str, payload: Optional[JsonObject] = None
    ) -> None:
        if not trigger_id or not trigger_id.strip():
            raise ValueError("A trigger ID is required.")
        await self._queue(self._with_session({
            "type": "trigger",
            "trigger_id": trigger_id,
            "payload": payload or {},
        }))

    async def send_trigger_with_ack(
        self, trigger_id: str, payload: Optional[JsonObject] = None
    ) -> JsonObject:
        if not trigger_id or not trigger_id.strip():
            raise ValueError("A trigger ID is required.")
        return await self._send_with_ack(self._with_session({
            "type": "trigger",
            "trigger_id": trigger_id,
            "payload": payload or {},
        }))

    async def send_score(
        self, score: float, metadata: Optional[JsonObject] = None
    ) -> None:
        payload = copy.deepcopy(metadata) if metadata else {}
        payload["score"] = score
        await self.send_trigger("score-achieved", payload)

    async def send_message(
        self, message_type: str, payload: Optional[JsonObject] = None
    ) -> None:
        if not message_type or not message_type.strip():
            raise ValueError("A message type is required.")
        await self._queue(self._with_session({
            "type": message_type,
            "payload": payload or {},
        }))

    async def send_content_url(
        self,
        url: str,
        mime_type: str = "application/octet-stream",
        metadata: Optional[JsonObject] = None,
    ) -> JsonObject:
        if not url or not url.strip():
            raise ValueError("A URL is required.")
        return await self._send_with_ack(self._with_session({
            "type": "ugc-upload",
            "url": url,
            "mime_type": mime_type,
            "meta": metadata or {},
        }))

    async def send_content_bytes(
        self,
        data: bytes,
        mime_type: str = "application/octet-stream",
        metadata: Optional[JsonObject] = None,
    ) -> JsonObject:
        if data is None:
            raise ValueError("Content data is required.")
        return await self._send_with_ack(self._with_session({
            "type": "ugc-upload",
            "data": base64.b64encode(data).decode("ascii"),
            "mime_type": mime_type,
            "meta": metadata or {},
        }))

    async def confirm_receipt(self, message_id: Optional[str]) -> None:
        if message_id:
            await self._queue({"type": "ack", "message_id": message_id})

    async def close_session(self) -> None:
        """Request an app-initiated end and immediately clear local state."""
        session_id = self._session_id
        if not session_id:
            return
        self._session_id = None
        self._customer = None
        await self._queue({
            "type": "close-session",
            "session_id": session_id,
        })

    async def register_triggers(
        self, triggers: Iterable[TriggerDefinition]
    ) -> None:
        self._register_locally(triggers)
        if self.connected:
            await self._queue({
                "type": "register-triggers",
                "triggers": self._trigger_snapshot(),
            })

    async def _connection_loop(self) -> None:
        delay = self.options.reconnect_delay
        while not self._stop.is_set():
            close_info = CloseInfo(was_intentional=self._intentional_close)
            try:
                self._debug("Connecting to %s...", self.websocket_uri)
                async with websockets.connect(
                    self.websocket_uri,
                    ping_interval=None,
                    ping_timeout=None,
                ) as socket:
                    self._socket = socket
                    self._connected = True
                    delay = self.options.reconnect_delay
                    self._debug("Connected to Satellite")
                    await self._emit("open")
                    await self._send_now(self._build_hello())
                    self._send_task = asyncio.create_task(
                        self._send_loop(socket), name="arc-satellite-send"
                    )
                    heartbeat = asyncio.create_task(
                        self._heartbeat_loop(socket), name="arc-satellite-heartbeat"
                    )
                    try:
                        async for raw in socket:
                            await self._receive(raw)
                    finally:
                        heartbeat.cancel()
                        self._send_task.cancel()
                        with suppress(asyncio.CancelledError):
                            await heartbeat
                        with suppress(asyncio.CancelledError):
                            await self._send_task
            except asyncio.CancelledError:
                raise
            except ConnectionClosed as exc:
                close_info = CloseInfo(
                    code=exc.code,
                    reason=exc.reason,
                    was_intentional=self._intentional_close,
                )
            except Exception as exc:
                await self._emit("error", exc)
            finally:
                self._connected = False
                self._socket = None
                self._send_task = None
                self._reject_acks(ConnectionError(
                    "ARC Satellite connection closed."
                ))
                await self._emit("close", close_info)

            if (
                self._stop.is_set()
                or self._intentional_close
                or not self.options.auto_reconnect
            ):
                break
            if self._pong_timed_out:
                delay = self.options.maximum_reconnect_delay
                self._pong_timed_out = False
            self._debug("Reconnecting in %.0fms...", delay * 1000)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass
            delay = min(
                delay * self.options.reconnect_factor,
                self.options.maximum_reconnect_delay,
            )

    async def _send_loop(self, socket: Any) -> None:
        while True:
            message = await self._outbound.get()
            try:
                await self._send_now(message, socket)
            except Exception:
                message_type = message.get("type")
                if message_type not in {"ping", "pong", "ack"}:
                    await self._outbound.put(message)
                raise
            finally:
                self._outbound.task_done()

    async def _heartbeat_loop(self, socket: Any) -> None:
        if self.options.ping_interval <= 0:
            return
        while True:
            await asyncio.sleep(self.options.ping_interval)
            self._pong.clear()
            await self._send_now({"type": "ping"}, socket)
            if self.options.pong_timeout <= 0:
                continue
            try:
                await asyncio.wait_for(
                    self._pong.wait(), timeout=self.options.pong_timeout
                )
            except asyncio.TimeoutError:
                error = TimeoutError("ARC Satellite pong timeout.")
                await self._emit("error", error)
                self._pong_timed_out = True
                await socket.close(code=1011, reason="pong timeout")
                return

    async def _receive(self, raw: Any) -> None:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            message = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._debug("Ignoring non-JSON message: %r", raw)
            return
        if not isinstance(message, dict):
            self._debug("Ignoring non-object JSON message: %r", message)
            return

        message_type = message.get("type")
        self._debug("<- %s: %s", message_type, self._json(message))
        await self._emit("message", copy.deepcopy(message))

        if message_type == "pong":
            self._pong.set()
        elif message_type == "ack":
            self._handle_ack(message)
            await self._emit("ack", copy.deepcopy(message))
        elif message_type == "session-start":
            await self._handle_session_start(message)
        elif message_type == "session-end":
            await self._handle_session_end(message)
        elif message_type == "command":
            await self._emit("command", copy.deepcopy(message))
            await self.confirm_receipt(message.get("message_id"))
        elif message_type == "content":
            await self._emit(
                "content", copy.deepcopy(message.get("payload", message))
            )
            await self.confirm_receipt(message.get("message_id"))
        else:
            await self._emit("command", copy.deepcopy(message))

    async def _handle_session_start(self, message: JsonObject) -> None:
        payload = message.get("payload")
        payload_object = payload if isinstance(payload, dict) else {}
        session_id = message.get("session_id") or payload_object.get("session_id")
        if isinstance(session_id, str):
            session_id = session_id.strip()
        if not session_id:
            await self._emit(
                "error",
                ValueError(
                    "ARC session-start did not contain a valid session_id."
                ),
            )
            return

        customer = message.get("customer")
        if not isinstance(customer, dict):
            customer = payload_object.get("customer")
        if not isinstance(customer, dict):
            customer = None

        # Session state is committed before the application callback.
        self._session_id = session_id
        self._customer = copy.deepcopy(customer)
        self._debug("Session stored: session_id=%s", session_id)

        event = SessionStartEvent(
            session_id=session_id,
            customer=copy.deepcopy(customer),
            action=message.get("action"),
            payload=copy.deepcopy(payload),
            raw_message=copy.deepcopy(message),
        )
        await self._emit("session-start", event)
        await self._queue({
            "type": "session-started",
            "session_id": session_id,
        })
        await self.confirm_receipt(message.get("message_id"))

    async def _handle_session_end(self, message: JsonObject) -> None:
        session_id = message.get("session_id") or self._session_id
        self._session_id = None
        self._customer = None
        await self._emit("session-end", SessionEndEvent(
            session_id=session_id,
            raw_message=copy.deepcopy(message),
        ))
        await self._queue({
            "type": "session-ended",
            "session_id": session_id,
        })

    async def _send_with_ack(self, message: JsonObject) -> JsonObject:
        message_id = self._message_id()
        message["message_id"] = message_id
        message["request_ack"] = True
        future = asyncio.get_running_loop().create_future()
        self._pending_acks[message_id] = future
        await self._queue(message)
        try:
            return await asyncio.wait_for(
                future, timeout=self.options.ack_timeout
            )
        except asyncio.TimeoutError as exc:
            raise TimeoutError(
                f"Ack timeout for message {message_id}."
            ) from exc
        finally:
            self._pending_acks.pop(message_id, None)

    def _handle_ack(self, message: JsonObject) -> None:
        message_id = message.get("message_id") or message.get("ack_id")
        future = self._pending_acks.pop(message_id, None)
        if future and not future.done():
            future.set_result(copy.deepcopy(message))

    async def _queue(self, message: JsonObject) -> None:
        await self._outbound.put(copy.deepcopy(message))

    async def _send_now(
        self, message: JsonObject, socket: Any = None
    ) -> None:
        socket = socket or self._socket
        if socket is None:
            raise ConnectionError("ARC Satellite WebSocket is not open.")
        data = self._json(message)
        await socket.send(data)
        self._debug("-> %s: %s", message.get("type"), data)

    def _with_session(self, message: JsonObject) -> JsonObject:
        session_id = self._session_id
        message_type = message.get("type")
        if session_id:
            message["session_id"] = session_id
            self._debug(
                "Session attached: type=%s, session_id=%s",
                message_type,
                session_id,
            )
        elif message_type == "trigger":
            self._debug(
                "WARNING: trigger %r was created without an active session_id.",
                message.get("trigger_id"),
            )
        return message

    def _build_hello(self) -> JsonObject:
        message: JsonObject = {
            "type": "hello",
            "app": self.options.app_name,
            "version": self.options.app_version,
        }
        triggers = self._trigger_snapshot()
        if triggers:
            message["triggers"] = triggers
        return message

    def _register_locally(
        self, triggers: Iterable[TriggerDefinition]
    ) -> None:
        for trigger in triggers or []:
            if trigger and trigger.id and trigger.id.strip():
                self._triggers[trigger.id] = trigger

    def _trigger_snapshot(self) -> list[JsonObject]:
        return [trigger.as_dict() for trigger in self._triggers.values()]

    async def _emit(self, event_name: str, value: Any = None) -> None:
        for handler in list(self._handlers.get(event_name, [])):
            try:
                result = handler() if value is None else handler(value)
                if inspect.isawaitable(result):
                    await result
            except Exception as exc:
                if event_name != "error":
                    await self._emit("error", exc)
                else:
                    self._log.exception("ARC error handler failed")

    def _reject_acks(self, error: Exception) -> None:
        for future in self._pending_acks.values():
            if not future.done():
                future.set_exception(error)
        self._pending_acks.clear()

    def _debug(self, message: str, *args: Any) -> None:
        if self.options.debug:
            self._log.info(message, *args)

    @staticmethod
    def _message_id() -> str:
        return f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}"

    @staticmethod
    def _json(message: JsonObject) -> str:
        return json.dumps(message, separators=(",", ":"), ensure_ascii=False)

    async def __aenter__(self) -> "ArcSatelliteClient":
        await self.connect()
        return self

    async def __aexit__(self, *_: Any) -> None:
        await self.disconnect()
