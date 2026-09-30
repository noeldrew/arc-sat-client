"""Public data models for the ARC Satellite SDK."""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


JsonObject = Dict[str, Any]


@dataclass(frozen=True)
class TriggerDefinition:
    id: str
    name: str
    description: Optional[str] = None

    def as_dict(self) -> JsonObject:
        result: JsonObject = {"id": self.id, "name": self.name}
        if self.description is not None:
            result["description"] = self.description
        return result


@dataclass(frozen=True)
class SessionStartEvent:
    session_id: str
    customer: Optional[JsonObject]
    action: Optional[str]
    payload: Any
    raw_message: JsonObject


@dataclass(frozen=True)
class SessionEndEvent:
    session_id: Optional[str]
    raw_message: JsonObject


@dataclass(frozen=True)
class CloseInfo:
    code: Optional[int] = None
    reason: Optional[str] = None
    was_intentional: bool = False


@dataclass
class SatelliteOptions:
    host: str = "localhost"
    port: int = 25585
    app_name: str = "Local App"
    app_version: str = "1.0.0"
    auto_reconnect: bool = True
    reconnect_delay: float = 2.0
    maximum_reconnect_delay: float = 30.0
    reconnect_factor: float = 1.5
    ping_interval: float = 25.0
    pong_timeout: float = 10.0
    ack_timeout: float = 8.0
    debug: bool = False
    triggers: list[TriggerDefinition] = field(default_factory=list)

    @property
    def websocket_uri(self) -> str:
        return f"ws://{self.host}:{self.port}"

