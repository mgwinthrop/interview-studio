# Interview Studio

A tool for finding your voice through guided conversation and helpful feedback. The current prototype has three preset AI interviewers; user-created interviewer types are planned. Keep changes within this repository.

- Preserve existing attribution. Never commit credentials, real transcripts, databases or company deployment identifiers.
- Keep the existing topic IDs and the existing audio/WebSocket protocol stable unless a task explicitly changes them.
- Avatar states must reflect connection, pause, interrupt and actual audio playback state. Respect prefers-reduced-motion.
- Public source is not a public hosted service: the prototype has no authentication.
- Verify frontend lint/build and backend tests/build before publishing changes.
