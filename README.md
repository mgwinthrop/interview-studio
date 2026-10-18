# Interview Studio

Interview Studio helps you find your voice through guided conversation and helpful feedback. An AI interviewer asks questions, explores your answers and gives you space to develop what you want to say. After the conversation, review the transcript and feedback to reflect on what came across and what you want to explore further.

The broader goal is to support different kinds of conversations: exploring an idea, telling a story, rehearsing an interview or working through a point of view. The tool is evolving toward letting you create different types of interviewers to suit the conversation and feedback you need.

## Available today

The current prototype includes three preset interviewers focused on AI use in engineering, experience design and product strategy. It supports:

- Voice conversations with follow-up questions and interrupt handling.
- An animated interviewer with listening, thinking, speaking and connection states.
- Transcripts, written feedback and session history stored in a local SQLite database.
- Responsive layouts, accessible state labels and reduced-motion support.

Animation follows actual audio playback; it does not provide phoneme-level lip sync.

## How to use it

1. Check your microphone and choose one of the available interviewers.
2. Explore the topic in conversation. Current sessions typically take 8–12 minutes.
3. Respond to follow-up questions, take your time, or interrupt to clarify a point.
4. Review the transcript and feedback to decide what you want to express differently or explore next.

## Planned: create your own interviewers

Interviewer creation is a planned capability, not yet available in the application. The direction is to let you shape an interviewer's purpose, topic, conversational style and feedback focus. Different interviewers could help you explore ideas, practise telling a story or prepare for a challenging conversation.

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

This is a single-user prototype. It has no authentication or authorization for session history and reports. Run locally or behind access controls; publishing source does not make the application suitable for unrestricted public hosting. Speech is sent to the configured speech provider, and transcripts are sent to the configured language model. Use practice content, not confidential interview or candidate data. Provider calls incur charges on your accounts.

## Customization

- `apps/frontend/app/components/InterviewerAvatar.tsx`: character artwork and labels.
- `apps/frontend/app/globals.css`: animation, colors and reduced-motion behavior.
- `apps/frontend/app/components/Nav.tsx`: product name and navigation.
- `apps/backend/src/topic.ts`: interview topics and prompts.

## Project background

Based on the AI Interview Tool implementation at commit `ffb890a`, with an animated interviewer, playback feedback and local setup documentation. No open-source license has been specified.

[Source repository](https://github.com/mgwinthrop/mg-interview-studio)
