# Interview Studio

A tool for finding your voice through guided conversation and helpful feedback. The current prototype has four preset interviewers, and the backend can store custom interviewers through its API; there is no interviewer editor in the app yet. Keep changes within this repository.

- Preserve existing attribution. Never commit credentials, real transcripts, databases or company deployment identifiers.
- Keep the preset interviewer IDs (`tell-a-story`, `explain-an-idea`, `rehearse-an-interview`, `work-out-a-point-of-view`) and the existing audio/WebSocket protocol stable unless a task explicitly changes them.
- Never store audio. Delivery numbers in a report come from code, never from model output.
- Avatar states must reflect connection, pause, interrupt and actual audio playback state. Respect prefers-reduced-motion.
- Public source is not a public hosted service: local mode accepts loopback connections only, with Host and Origin checks, and an optional shared `AUTH_TOKEN` mode exists. It is still a single-user prototype with no per-user accounts.
- Verify frontend lint/build and backend tests/build before publishing changes.
