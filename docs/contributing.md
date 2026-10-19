# Contributing

Read `AGENTS.md` and the root README. Keep changes small and verify backend unit tests plus both builds. Use the `/avatar` preview to inspect all UI states and reduced motion.

Audio framing, preset interviewer ids and WebSocket messages are shared contracts. Keep frontend and backend consistent. The frontend character follows actual playback; interrupts must stop both scheduled audio and animation.

Never commit provider keys, session data or deployment account metadata. New public hosting requires authentication and session authorization.

## Adding a server test

Server tests start the real app on port 0 with mock providers and a temporary SQLite database. They live in `apps/backend/src/__tests__/server.<area>.test.ts` (session, auth-http, conversation, report, designer).

- Shared helpers are in `apps/backend/src/__tests__/helpers/server.ts` (`setupServerTestEnv`, `start`, `connect`, `makeConfig` and the message and preset constants) and `helpers/report.ts` (`seedStored`, `regenerate`, `statusOf`).
- Call `const env = setupServerTestEnv();` once at the top of the file, then read `env.prisma`, `env.store`, `env.persistence`, `env.registry` and the rest inside tests or hooks. Reading `env` in a `describe` body throws, and calling the setup twice in one file throws.
- Add the test to the file for its area; start a new `server.<area>.test.ts` only for a new area. Run one file with `npx vitest run src/__tests__/server.report.test.ts`.
