# MG Interview Studio

MG Interview Studio is a voice-first interview practice tool for explaining your work, reflecting on your use of AI, and receiving structured feedback. An animated AI interviewer guides the conversation, asks follow-up questions, and produces a transcript and written assessment.

Designed for practitioners in engineering, experience design and product strategy who want to rehearse examples from their work and identify where their explanations could be clearer or more specific.

## How to use it

1. Check your microphone and choose an interview focus.
2. Talk through concrete examples of how you use AI in your work. Sessions typically take 8–12 minutes.
3. Respond to follow-up questions, or interrupt to clarify a point.
4. Review the transcript and feedback, then use them to refine your examples.

## What it does

- Structured interviews across AI-enabled engineering, experience design, and product strategy.
- Speech recognition, streamed LLM responses, synthesized speech and interrupt handling.
- A local animated character with listening, thinking, speaking, interruption and connection states.
- Speech animation follows actual audio playback; it does not provide phoneme-level lip sync.
- Written reports and session history stored in a local SQLite database.
- Responsive layout, accessible state labels and reduced-motion support.

## Quick start

Requires Node.js 20+ and your own Anthropic and ElevenLabs API keys. Cartesia is optional.

```sh
npm --prefix apps/backend ci
npm --prefix apps/frontend ci
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
```

Add your keys to `apps/backend/.env`, then run in separate terminals:

```sh
cd apps/backend
npx prisma generate
npm run dev
```

```sh
cd apps/frontend
npm run dev
```

Open http://localhost:3000. To preview all avatar states without credentials, a backend or microphone access, open http://localhost:3000/avatar.

## Architecture

Next.js / React / TypeScript frontend → WebSocket → Node / Express backend. The voice pipeline uses Silero VAD, ElevenLabs Scribe, Claude and ElevenLabs TTS, with an optional Cartesia fallback. Prisma persists sessions in SQLite. The avatar is an inline SVG component with CSS animation: no additional avatar service or subscription.

## Verification

```sh
npm test
npm --prefix apps/frontend run lint
npm --prefix apps/frontend run build
npm --prefix apps/backend run build
```

## Scope and data

This is a single-user prototype. It has no authentication or authorization for session history and reports. Run locally or behind access controls; publishing source does not make the application suitable for unrestricted public hosting. Speech is sent to the configured speech provider, and transcripts are sent to the configured language model. Use practice content, not confidential interview or candidate data. Provider calls incur charges on your accounts.

## Customization

- `apps/frontend/app/components/InterviewerAvatar.tsx`: character artwork and labels.
- `apps/frontend/app/globals.css`: animation, colors and reduced-motion behavior.
- `apps/frontend/app/components/Nav.tsx`: product name and navigation.
- `apps/backend/src/topic.ts`: interview topics and prompts.

## Project background

Based on the AI Interview Tool implementation at commit `ffb890a`, with an animated interviewer, playback feedback and local setup documentation. No open-source license has been specified.

[Source repository](https://github.com/mgwinthrop/mg-interview-studio)
