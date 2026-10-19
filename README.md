# Interview Studio

Interview Studio helps you find your voice through guided conversation and helpful feedback. An AI interviewer asks questions, explores your answers and gives you space to develop what you want to say. After the conversation, review the transcript and a written reflection, including how you delivered your answers, to see what came across and what you want to explore further.

The tool supports different kinds of conversations: exploring an idea, telling a story, rehearsing an interview or working through a point of view. It is evolving toward letting you create your own interviewers to suit the conversation and feedback you need.

## Available today

The current prototype includes four preset interviewers: Tell a story, Explain an idea, Rehearse an interview and Work out a point of view. It supports:

- Voice conversations with follow-up questions and interrupt handling.
- An animated interviewer with listening, thinking, speaking and connection states.
- Transcripts and session history stored in a local SQLite database. Audio is never stored.
- A three-part report: Content (what you said), Delivery (pace, pauses, answer length and time to start answering, measured in code from word timings, with a plain-language reading) and Next steps. Filler-word counts are off by default (`REPORT_FILLER_COUNTS=1` shows them). A failed report can be regenerated from the report page.
- A backend API for custom interviewers (purpose, voice, phase lengths and feedback switches); the app has no editor for them yet.
- Responsive layouts, accessible state labels and reduced-motion support.

Animation follows actual audio playback; it does not provide phoneme-level lip sync.

## How to use it

1. Check your microphone and choose one of the available interviewers.
2. Talk with the interviewer. Each interviewer sets its own phases and pace, so sessions vary in length.
3. Respond to follow-up questions, take your time, or interrupt to clarify a point.
4. Review the transcript and report to decide what you want to express differently or explore next.

## Planned: design your own interviewers in the app

The backend already stores custom interviewers (up to 50 per owner), but creating one in the application is not available yet. The direction is a designer that lets you shape an interviewer's purpose, conversational style and feedback focus.

The goal is to help you find your own voice and receive useful feedback on the conversation, rather than prescribe one correct way to speak.

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

This is a single-user prototype. By default it accepts connections from this machine only (loopback, with Host and Origin checks); setting `AUTH_TOKEN` enables an optional shared-token mode, and there are no per-user accounts. Run locally or behind access controls; publishing source does not make the application suitable for unrestricted public hosting. Speech is sent to the configured speech provider, and transcripts are sent to the configured language model. Use practice content, not confidential interview or candidate data. Provider calls incur charges on your accounts.

## Customization

- `apps/frontend/app/components/InterviewerAvatar.tsx`: character artwork and labels.
- `apps/frontend/app/globals.css`: animation, colors and reduced-motion behavior.
- `apps/frontend/app/components/Nav.tsx`: product name and navigation.
- `apps/backend/src/interviewer/presets/`: the preset interviewers, their prompts and phase settings.

## Project background

Based on the AI Interview Tool implementation at commit `ffb890a`, with an animated interviewer, playback feedback and local setup documentation. No open-source license has been specified.

[Source repository](https://github.com/mgwinthrop/interview-studio)
