"""Minimal ARC-controlled game process."""

import asyncio
import logging

from arc_satellite import (
    ArcSatelliteClient,
    SatelliteOptions,
    SessionEndEvent,
    SessionStartEvent,
    TriggerDefinition,
)


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    client = ArcSatelliteClient(SatelliteOptions(
        app_name="Python Game",
        app_version="1.0.0",
        debug=True,
        triggers=[
            TriggerDefinition("game-started", "Game Started"),
            TriggerDefinition("level-1-complete", "Level 1 Complete"),
            TriggerDefinition("game-complete", "Game Complete"),
        ],
    ))

    @client.event("session-start")
    async def session_started(event: SessionStartEvent) -> None:
        customer = event.customer or {}
        name = (
            customer.get("display_name")
            or customer.get("first_name")
            or "Player"
        )
        print(f"Welcome {name}")

        # This trigger automatically contains event.session_id.
        await client.send_trigger("game-started")

    @client.event("session-end")
    async def session_ended(event: SessionEndEvent) -> None:
        print(f"Session ended: {event.session_id}")
        # Return your application to its holding screen here.
        # Do not call close_session() in response to this event.

    @client.event("error")
    def error_received(error: Exception) -> None:
        logging.error("ARC SDK error: %s", error)

    # Connecting does not start gameplay. Only session-start does that.
    await client.run_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
