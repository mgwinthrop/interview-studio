import "dotenv/config";
import { ConfigError, loadConfig, type Config } from "./config";

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  // Prisma reads DATABASE_URL from the environment: make it the validated value before the
  // database client is loaded (the modules below are imported only after this line).
  process.env.DATABASE_URL = config.databaseUrl;

  const { runMigrations, redactMigrationOutput } = await import("./migrate");
  try {
    await runMigrations(config);
    console.log("Database migrations applied");
  } catch (err) {
    const { code, stderr } = err as { code?: unknown; stderr?: unknown };
    console.error(`Migration failed: ${errName(err)}${typeof code === "number" ? ` (exit ${code})` : ""}`);
    const output =
      typeof stderr === "string" || Buffer.isBuffer(stderr)
        ? redactMigrationOutput(stderr.toString(), config.databaseUrl)
        : "";
    if (output) console.error(output);
    process.exit(1);
  }

  // A bad preset is a build error: stop before serving. The message of a PresetValidationError
  // names the preset id and field paths only; other errors (database) are named by class.
  const { PresetValidationError, syncPresets } = await import("./interviewerStore");
  try {
    const { PRESETS } = await import("./interviewer/presets");
    const r = await syncPresets(PRESETS);
    console.log(`[startup] presets synced: ${r.inserted} inserted, ${r.updated} updated, ${r.removed} removed`);
  } catch (err) {
    const { describeStartupFailure } = await import("./startupFailure");
    for (const line of describeStartupFailure(err, err instanceof PresetValidationError)) console.error(line);
    process.exit(1);
  }

  // Single instance: nothing is live at boot, so any "active" row was left by a crash.
  try {
    const { abandonStaleActiveSessions } = await import("./persistence");
    const count = await abandonStaleActiveSessions();
    console.log(`[startup] marked ${count} stale active session(s) abandoned`);
  } catch (err) {
    console.error(`Stale session sweep failed: ${errName(err)}`);
  }

  try {
    const { runRetention } = await import("./retention");
    await runRetention(config);
  } catch (err) {
    console.error(`Retention purge failed: ${errName(err)}`);
  }

  const { createProviders } = await import("./providers");
  const { createApp } = await import("./app");
  const { default: prisma } = await import("./db");

  const app = createApp({ config, providers: createProviders(config) });
  app.server.listen(config.port, config.host, () => {
    console.log(
      `Server listening on ${config.host}:${config.port} (profile ${config.profile}, auth ${config.auth.mode})`,
    );
  });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: shutting down`);
    app
      .close()
      .then(() => prisma.$disconnect())
      .catch((err: unknown) => console.error(`Shutdown error: ${errName(err)}`))
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(`Startup failed: ${errName(err)}`);
  process.exit(1);
});
