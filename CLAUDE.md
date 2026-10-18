# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Interview Studio: a voice-conversation tool where an AI interviewer asks questions and then produces a transcript and written feedback. Two independent npm projects (no workspace root install): `apps/backend` (Node/Express/WebSocket/Prisma+SQLite) and `apps/frontend` (Next.js 14 App Router). Prototype only: single-user, no authentication. Read `AGENTS.md` for the binding repo rules (never commit credentials, transcripts, databases or deployment identifiers; keep changes inside this repo).

## Commands

Requires Node 20+. Install per app: `npm --prefix apps/backend ci` and `npm --prefix apps/frontend ci`. Copy `apps/backend/.env.example` to `.env` and `apps/frontend/.env.example` to `.env.local`.

Backend (`apps/backend`):
- `npx prisma generate` — required once after install, and after schema changes
- `npm run dev` — tsx watch on port 3001
- `npm test` — vitest unit tests (also `npm test` at repo root); single file: `npx vitest run src/__tests__/topic.test.ts`; single test: `npx vitest run -t "name"`
- `npm run test:integration` — drives a real session over WebSocket with an LLM judge. Needs the backend already running plus real API keys; sets `INTEGRATION_TEST=1`; `TEST_WS_URL` overrides the default `ws://localhost:3001`. Excluded from `npm test`.
- `npm run build` — `tsc`

Frontend (`apps/frontend`): `npm run dev` (port 3000), `npm run lint`, `npm run build`. There are no frontend tests.

Before publishing, run all of: `npm test`, frontend lint, frontend build, backend build.

`http://localhost:3000/avatar` previews every avatar state with no backend, keys or microphone. Use it to check UI states and reduced motion.

## Architecture

Pipeline: browser mic → AudioWorklet (PCM16, 16kHz mono) → Silero VAD (`@ricky0123/vad-web`, client-side, decides end of turn) → WebSocket binary frame → ElevenLabs Scribe STT (`scribeSession.ts`) → Claude (`llm.ts`) → `sentenceChunker.ts` → TTS (`ttsStream.ts`, ElevenLabs with optional Cartesia fallback) → binary MP3 frames back → `lib/audioQueue.ts` (Web Audio, serialised playback). `docs/architecture.md` has the latency budget and diagram.

Backend:
- `index.ts` — Express app plus the single WebSocket endpoint at the root path. Binary frames (`isBinary`) are audio; everything else is typed JSON. `session_start` must be the first message.
- `orchestrator.ts` — per-session turn handling and the interrupt flow. Phase transitions (`intro` → `share_work` → `deep_dive` → `wrap_up`) are driven by user-turn counts in the orchestrator, never decided by the LLM. `buildSystemPrompt(phase, topic)` injects per-phase instructions.
- `topic.ts` — the three preset interviewers (topic IDs and prompts).
- `sessionStore.ts` / `runtimeStore.ts` — in-memory active session state. `persistence.ts` + `prisma/schema.prisma` write to SQLite on completed turns, phase changes and session end. `reportGenerator.ts` builds the post-session feedback.

Frontend: `app/session/page.tsx` is the live conversation, built on `hooks/useWebSocket.ts`, `hooks/useVAD.ts` and `lib/audioQueue.ts`. `app/components/InterviewerAvatar.tsx` is an inline SVG animated by CSS in `globals.css`. `app/lib/topics.ts` mirrors the backend topic IDs. Report and history pages are `app/report/[sessionId]` and `app/dashboard`.

## Contracts to keep stable

- Topic IDs (`ai-se-delivery`, `experience-design`, `product-design-strategy`) exist in both `backend/src/topic.ts` and `frontend/app/lib/topics.ts`; change both or neither.
- The WebSocket protocol is specified in `docs/websocket-protocol.md`. Keep client, server and that doc in sync. Do not change the audio framing or message types unless the task says to.
- Interrupts must stop both audio playback (`audioQueue.flush()`, which bumps a generation counter to discard in-flight decodes) and the server's TTS and LLM streams (abort signals), and reset Scribe. The client snaps to the interrupt state locally before any server round-trip.
- Avatar states must reflect real connection, pause, interrupt and audio-playback state, not timers, and must respect `prefers-reduced-motion`.
- `docs/architecture.md` lists "locked decisions" (Claude Sonnet model with `max_tokens: 300`, Scribe v2, `eleven_flash_v2_5`, phase thresholds 2/5/10, 16kHz PCM16). Treat them as fixed unless explicitly asked to change them.
