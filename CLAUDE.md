# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Interview Studio: a voice-conversation tool where an AI interviewer asks questions and then produces a transcript and written feedback. Two independent npm projects (no workspace root install): `apps/backend` (Node/Express/WebSocket/Prisma+SQLite) and `apps/frontend` (Next.js 14 App Router). Single-user prototype: local mode (no `AUTH_TOKEN`) accepts loopback peers only, with `Host` and `Origin` checks; setting `AUTH_TOKEN` enables an optional shared-token mode. Read `AGENTS.md` for the binding repo rules (never commit credentials, transcripts, databases or deployment identifiers; keep changes inside this repo).

## Commands

Requires Node 20+. Install per app: `npm --prefix apps/backend ci` and `npm --prefix apps/frontend ci`. Copy `apps/backend/.env.example` to `.env` and `apps/frontend/.env.example` to `.env.local`.

Backend (`apps/backend`):
- `npx prisma generate` — required once after install, and after schema changes
- Upgrading an existing database (migrations run at startup, `prisma generate` does not): see "Upgrading an existing install" in `docs/local-setup.md`
- `npm run dev` — tsx watch on `127.0.0.1:3001`. With the default `PROFILE=cloud` it needs `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`; `PROFILE=mock npm run dev` runs a full conversation (greeting, replies, interrupt, report) with no keys
- `npm test` — vitest unit tests plus the keyless end-to-end conversation test (`src/__tests__/conversation.test.ts`, mock providers, temp SQLite DB; no keys or running server) (also `npm test` at repo root); single file: `npx vitest run src/__tests__/orchestrator.test.ts`; single test: `npx vitest run -t "name"`
- `npm run test:integration` — opt-in run of a real session against real providers over WebSocket with an LLM judge. Needs the backend already running with `PROFILE=cloud` and real API keys (also `ANTHROPIC_API_KEY` in the test's environment for the judge); sets `INTEGRATION_TEST=1`; `TEST_WS_URL` overrides the default `ws://localhost:3001`. Excluded from `npm test`.
- `npm run build` — `tsc`

Frontend (`apps/frontend`): `npm run dev` (port 3000), `npm run lint`, `npm run build`. There are no frontend tests.

Before publishing, run all of: `npm test`, frontend lint, frontend build, backend build.

`http://localhost:3000/avatar` previews every avatar state with no backend, keys or microphone. Use it to check UI states and reduced motion.

## Architecture

Pipeline: browser mic → AudioWorklet (PCM16, 16kHz mono) → Silero VAD (`@ricky0123/vad-web`, client-side, decides end of turn) → WebSocket binary frame (one whole utterance) → STT (one request per utterance, not streaming) → LLM → `sentenceChunker.ts` → TTS → binary MP3 frames back → `lib/audioQueue.ts` (Web Audio, serialised playback). `docs/architecture.md` has the latency budget and diagram.

Backend:
- `index.ts` — thin entrypoint: `loadConfig` (`config.ts`; exits on a bad setting), `runMigrations` (`migrate.ts`; exits on failure), `createProviders`, `createApp`, `listen`.
- `app.ts` — `createApp` builds the Express routes and the single WebSocket endpoint at the root path without listening (tests use it on port 0). `auth.ts` runs on every HTTP request and on the upgrade (origin check, loopback-only local mode, optional `AUTH_TOKEN`) and yields the `ownerId` every query filters by. The server issues session IDs; binary frames (`isBinary`) are audio, everything else is typed JSON, and `session_start` must be the first frame and names an `interviewerId`.
- `providers/` — STT, LLM and TTS interfaces with cloud (ElevenLabs Scribe, Claude, ElevenLabs TTS with optional Cartesia fallback) and mock implementations; `PROFILE=mock` needs no keys.
- `sessionController.ts` — one controller per connection: turn queue, interrupt and abort flow, idle timeout, end and report; `sessionRegistry.ts` tracks live controllers. `orchestrator.ts` holds the pure turn helpers, including `advancePhase`. Phase transitions are driven by per-phase user-turn counts from the interviewer's own settings, never decided by the LLM.
- Interviewers (see `docs/architecture.md`, "Interviewers"): `interviewer/schema.ts` defines the record, its caps and validation; `interviewer/presets/` holds the four preset interviewers (`tell-a-story`, `explain-an-idea`, `rehearse-an-interview`, `work-out-a-point-of-view`) as repo files; `interviewer/prompt.ts` builds the system prompt (fixed voice-rules wrapper around the interviewer's text); `interviewerStore.ts` is the owner-scoped store over the `Interviewer` table (50 custom interviewers per owner, versioned updates, `syncPresets`); `interviewerRoutes.ts` serves `/api/interviewers`. `index.ts` syncs the presets into the database after migrations. A session stores a full snapshot of its interviewer (`Session.interviewerJson`), so editing or deleting an interviewer never changes a past or running session or its report; sessions from before interviewers have no snapshot and show as "Earlier interview".
- `persistence.ts` + `prisma/schema.prisma` write to SQLite as turns complete, on phase changes and when the session ends (`complete`, `failed` or `abandoned`). `reportGenerator.ts` builds the post-session feedback.
- Data lifecycle: `DELETE /api/session/:sessionId` (owner-scoped; 204, 404 for unknown or foreign, 409 while the session is live) removes a session with its turns and report; the dashboard has a delete button. Set `RETENTION_DAYS` to have `retention.ts` purge ended sessions older than that once at startup (a failure is logged and does not block startup).

Frontend: `app/session/page.tsx` is the live conversation, built on `hooks/useWebSocket.ts`, `hooks/useVAD.ts` and `lib/audioQueue.ts`. `app/components/InterviewerAvatar.tsx` is an inline SVG animated by CSS in `globals.css`. `app/lib/interviewers.ts` loads interviewers from the API (the frontend hard-codes no interviewer ids); the session page loads the interviewer before it opens the WebSocket. Report and history pages are `app/report/[sessionId]` and `app/dashboard`.

## Contracts to keep stable

- The WebSocket protocol is specified in `docs/websocket-protocol.md`. Keep client, server and that doc in sync. Do not change the audio framing or message types unless the task says to.
- Interrupts must stop both audio playback (`audioQueue.flush()`, which bumps a generation counter to discard in-flight decodes) and the server's TTS and LLM streams (one abort signal per turn) and drop queued utterances. The client snaps to the interrupt state locally before any server round-trip.
- Avatar states must reflect real connection, pause, interrupt and audio-playback state, not timers, and must respect `prefers-reduced-motion`.
- `docs/architecture.md` lists "locked decisions" (Claude Sonnet model with `max_tokens: 300`, Scribe v2, `eleven_flash_v2_5`, 16kHz PCM16). Treat them as fixed unless explicitly asked to change them. Phase thresholds are not locked: they are per-interviewer settings. The presets default to 2/5/10 cumulative user turns (intro 2, share 3 more, deep dive 5 more), and demo mode ends each phase at its `minTurns`.
