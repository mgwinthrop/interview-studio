# Security policy

Interview Studio is a single-user prototype that runs on your own machine. See [Operations](docs/operations.md#before-you-put-this-on-a-network) before exposing it to a network.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private reporting instead:

1. Go to the [Security tab](https://github.com/mgwinthrop/interview-studio/security) of this repository.
2. Choose **Report a vulnerability** and describe the problem, how to reproduce it and what it could allow.

You can expect an acknowledgement within a week. This is a hobby-scale project, so fixes are made on a best-effort basis.

## In scope

- The auth and origin checks (`apps/backend/src/auth.ts`): loopback-only local mode, `Host` and `Origin` checks, the optional `AUTH_TOKEN` mode.
- The WebSocket and HTTP endpoints, including input limits and owner scoping of sessions, interviewers and reports.
- Anything that could leak API keys, transcripts or the SQLite database.

## Out of scope

- Running the app on a public network without following [Operations](docs/operations.md).
- Problems in the Anthropic, ElevenLabs or Cartesia services themselves.
- Findings that need an attacker who already controls your machine.

## If you find a leaked credential

Never commit credentials, transcripts, databases or deployment identifiers (see `AGENTS.md`). If you spot one in this repository, report it privately as above and revoke it at the provider.
