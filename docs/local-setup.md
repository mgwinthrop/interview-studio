# Local setup and deployment

See the root README for installation and local startup. Environment examples contain placeholders only.

`DATABASE_URL=file:./local.db` creates a SQLite database relative to the Prisma schema directory. The backend applies migrations on startup. Run `npx prisma generate` after backend installation if needed.

## Upgrading an existing install

Each release may add database migrations, and they run automatically at backend startup. The newest migration (delivery metrics and the three-part report) only adds nullable columns and rewrites no data. An earlier one (preset interviewers) rebuilt the sessions table; sessions from before it keep their transcripts and reports and appear as "Earlier interview". Migrations are one-way: to go back, restore your backup. Only one backend process may use a database file at a time.

1. Stop every running backend, including `npm run dev` watchers. A second server migrating the database under a running one breaks the running server and loses its in-flight session.
2. Copy the SQLite file (the file named by `DATABASE_URL`, `apps/backend/prisma/local.db` by default) to a backup.
3. Run `npm --prefix apps/backend ci` (new dependencies may have been added), then `cd apps/backend && npx prisma generate`. Migrations do not regenerate the Prisma client. With a stale client the backend can still start and look healthy, but saving a spoken turn or a report fails on the new columns, so sessions end `failed` and reports are not saved (regenerating fails too). If that happens, stop the backend, run `npx prisma generate` and start it again.
4. Start the backend once and watch for "Database migrations applied".

If the migration fails or the process stops part-way, stop the backend, restore the backup and start again. Do not delete the `_prisma_migrations` table. `cd apps/backend && npx prisma migrate status` shows which migrations are applied or failed.

Frontend configuration: `NEXT_PUBLIC_WS_URL=ws://localhost:3001`.
Backend configuration: `ALLOWED_ORIGIN=http://localhost:3000`, plus your own API keys.

To deploy later, create a new app in your Fly.io account, a new volume and new secrets. The supplied `fly.toml` deliberately has no app name; pass `--app YOUR_APP`. Create a new frontend project in your own hosting account and set its WebSocket URL to your backend. Use separate credentials and configuration for each environment.

Add authentication and per-user session authorization, usage controls and retention rules before exposing a hosted service to the public. The current implementation is intended for local or access-controlled single-user experiments.
