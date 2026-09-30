# Changelog

## 1.1.0

- Validates `session_id` before accepting `session-start`.
- Reads `session_id` from the top-level message or nested payload.
- Stores the session ID before dispatching `SessionStarted`.
- Appends the current session ID to outgoing triggers and gameplay messages.
- Adds optional logs showing session capture and outbound attachment.
- Preserves heartbeat, acknowledgement, queueing and reconnection behaviour.

## 1.0.0

- Initial Unity C# implementation of the ARC Satellite SDK.
