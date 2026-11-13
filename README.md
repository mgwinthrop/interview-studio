# Interview Studio

[![CI](https://github.com/mgwinthrop/interview-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/mgwinthrop/interview-studio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](https://nodejs.org/)

**Find your voice through guided conversation.** An AI interviewer asks questions, follows up on your answers and gives you space to work out what you want to say. Afterwards you get a transcript and a written reflection on what you said and how you delivered it.

![The Interview Studio home page, showing the four conversation phases and the preset interviewers](docs/images/studio-home.jpg)

Explore an idea, tell a story, rehearse an interview or work through a point of view, or build your own interviewer.

> **Status:** a single-user prototype that runs on your own machine, not a hosted service. See [Before you deploy it](docs/operations.md#before-you-put-this-on-a-network).

## How it works

```mermaid
flowchart LR
    You([You speak]) --> Browser["Browser<br/>detects when you stop talking"]
    Browser --> Backend["Backend<br/>speech to text, then Claude,<br/>then text to speech"]
    Backend --> Hear([You hear the reply])
    Backend --> Report["Transcript and report<br/>saved in a local SQLite file"]
```

The report covers **Content**, **Delivery** (pace, pauses, answer length) and **Next steps**. Audio is never stored. Details: [How it works](docs/how-it-works.md).

## Quick start

Needs Node.js 22.12+ and git. Mock mode uses scripted replies, so no API keys are needed.

```sh
git clone https://github.com/mgwinthrop/interview-studio.git
cd interview-studio
npm --prefix apps/backend ci
npm --prefix apps/frontend ci
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
(cd apps/backend && npx prisma generate)

# terminal 1
cd apps/backend && PROFILE=mock npm run dev

# terminal 2
cd apps/frontend && npm run dev
```

Open <http://localhost:3000> and allow the microphone.

For real conversations, put `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` in `apps/backend/.env` and restart the backend without `PROFILE=mock`. Each provider bills your own account. Problems? See [Troubleshooting](docs/getting-started.md#troubleshooting).

## Docs

[Getting started](docs/getting-started.md) · [How it works](docs/how-it-works.md) · [Interviewers](docs/interviewers.md) · [Reports](docs/reports.md) · [Operations](docs/operations.md) · [Settings](docs/settings.md) · [Usage](docs/usage.md) · [Calls and privacy](docs/calls-and-privacy.md) · [WebSocket protocol](docs/websocket-protocol.md) · [Contributing](docs/contributing.md)

## Project background

Based on the AI Interview Tool implementation at commit `ffb890a`, with an animated interviewer, playback feedback and local setup documentation. Released under the [MIT License](LICENSE).
