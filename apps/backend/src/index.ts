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

  const { runMigrations } = await import("./migrate");
  try {
    await runMigrations(config);
    console.log("Database migrations applied");
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    console.error(`Migration failed: ${errName(err)}${typeof code === "number" ? ` (exit ${code})` : ""}`);
    process.exit(1);
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
