import asyncio
import unittest

from arc_satellite import ArcSatelliteClient, SatelliteOptions


class ArcSatelliteClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_is_stored_before_handler_and_attached(self):
        client = ArcSatelliteClient(SatelliteOptions())
        queued = []

        async def capture(message):
            queued.append(message)

        client._queue = capture

        async def started(event):
            self.assertEqual("session-123", client.session_id)
            await client.send_trigger("game-started", {"ready": True})

        client.on("session-start", started)
        await client._receive(
            '{"type":"session-start","session_id":"session-123",'
            '"customer":{"first_name":"Noel"},"message_id":"incoming-1"}'
        )

        self.assertEqual("session-123", client.session_id)
        self.assertEqual("Noel", client.customer["first_name"])
        self.assertEqual("session-123", queued[0]["session_id"])
        self.assertEqual("game-started", queued[0]["trigger_id"])
        self.assertEqual("session-started", queued[1]["type"])
        self.assertEqual("ack", queued[2]["type"])

    async def test_nested_session_and_customer_are_supported(self):
        client = ArcSatelliteClient()
        client._queue = lambda message: asyncio.sleep(0)
        await client._receive(
            '{"type":"session-start","payload":{"session_id":"nested-id",'
            '"customer":{"display_name":"Guest"}}}'
        )
        self.assertEqual("nested-id", client.session_id)
        self.assertEqual("Guest", client.customer["display_name"])

    async def test_external_session_end_clears_state(self):
        client = ArcSatelliteClient()
        client._queue = lambda message: asyncio.sleep(0)
        await client._receive(
            '{"type":"session-start","session_id":"session-123"}'
        )
        await client._receive(
            '{"type":"session-end","session_id":"session-123"}'
        )
        self.assertIsNone(client.session_id)
        self.assertIsNone(client.customer)


if __name__ == "__main__":
    unittest.main()

