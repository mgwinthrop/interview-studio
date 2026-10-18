# Local setup and deployment

See the root README for installation and local startup. Environment examples contain placeholders only.

`DATABASE_URL=file:./local.db` creates a SQLite database relative to the Prisma schema directory. The backend applies migrations on startup. Run `npx prisma generate` after backend installation if needed.

Frontend configuration: `NEXT_PUBLIC_WS_URL=ws://localhost:3001`.
Backend configuration: `ALLOWED_ORIGIN=http://localhost:3000`, plus your own API keys.

To deploy later, create a new app in your Fly.io account, a new volume and new secrets. The supplied `fly.toml` deliberately has no app name; pass `--app YOUR_APP`. Create a new frontend project in your own hosting account and set its WebSocket URL to your backend. Use separate credentials and configuration for each environment.

Add authentication and per-user session authorization, usage controls and retention rules before exposing a hosted service to the public. The current implementation is intended for local or access-controlled single-user experiments.
