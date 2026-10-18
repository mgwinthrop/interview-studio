# Contributing

Read `AGENTS.md` and the root README. Keep changes small and verify backend unit tests plus both builds. Use the `/avatar` preview to inspect all UI states and reduced motion.

Audio framing, preset interviewer ids and WebSocket messages are shared contracts. Keep frontend and backend consistent. The frontend character follows actual playback; interrupts must stop both scheduled audio and animation.

Never commit provider keys, session data or deployment account metadata. New public hosting requires authentication and session authorization.
