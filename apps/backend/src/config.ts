import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface Config {
  host: string;
  port: number;
  allowedOrigins: string[];
  profile: "cloud" | "mock";
  databaseUrl: string;
  anthropicApiKey?: string;
  elevenlabsApiKey?: string;
  elevenlabsVoiceId: string;
  cartesia?: { apiKey: string; voiceId: string };
  auth: { mode: "local" } | { mode: "token"; token: string };
  limits: {
    /** ws maxPayload: the largest frame of any kind; one binary frame is one whole utterance. */
    maxPayloadBytes: number;
    /** Largest JSON text frame; bigger ones close the socket 1009. */
    maxTextFrameBytes: number;
    maxConcurrentSessionsPerOwner: number;
    maxTurnsPerSession: number;
    idleTimeoutMs: number;
    /** Upper bound on end(): the in-flight turn plus report generation. */
    reportTimeoutMs: number;
  };
  debugLogText: boolean;
  /** Show filler-word counts in reports. Off until speech-to-text is known to keep fillers. */
  reportFillerCounts: boolean;
  /** Operator switch: allow transcript text to be sent to the cloud LLM (persona from calls). */
  cloudSend: boolean;
  retentionDays?: number;
}

const DEFAULT_VOICE_ID = "pNInz6obpgDQGcFmaJgB";

export function isLoopback(host: string): boolean {
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "::ffff:127.0.0.1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

const schema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ALLOWED_ORIGIN: z.string().default("http://localhost:3000"),
  PROFILE: z.enum(["cloud", "mock"]).default("cloud"),
  DATABASE_URL: z.string().default("file:./local.db"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default(DEFAULT_VOICE_ID),
  CARTESIA_API_KEY: z.string().optional(),
  CARTESIA_VOICE_ID: z.string().optional(),
  AUTH_TOKEN: z.string().optional(),
  DEBUG_LOG_TEXT: z.enum(["true", "false", "1", "0"]).optional(),
  RETENTION_DAYS: z.coerce.number().int().positive().optional(),
  REPORT_FILLER_COUNTS: z.string().optional(),
  CLOUD_SEND_TRANSCRIPTS: z.string().optional(),
});

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // Blank values mean unset.
  const cleaned: Record<string, string | undefined> = {};
  for (const key of Object.keys(schema.shape)) {
    const v = env[key];
    cleaned[key] = v === undefined || v.trim() === "" ? undefined : v.trim();
  }

  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;

  if (e.PROFILE === "cloud") {
    const missing = (["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY"] as const).filter((k) => !e[k]);
    if (missing.length > 0) {
      throw new ConfigError(`Missing required key for cloud profile: ${missing.join(", ")}`);
    }
  }

  if (e.CARTESIA_API_KEY && !e.CARTESIA_VOICE_ID) {
    throw new ConfigError("CARTESIA_VOICE_ID: required when CARTESIA_API_KEY is set");
  }

  let auth: Config["auth"] = { mode: "local" };
  if (e.AUTH_TOKEN) {
    auth = { mode: "token", token: e.AUTH_TOKEN };
  } else if (!isLoopback(e.HOST)) {
    throw new ConfigError(
      `HOST ${e.HOST} is not loopback: authentication is required, set AUTH_TOKEN or bind to 127.0.0.1`,
    );
  }

  return {
    host: e.HOST,
    port: e.PORT,
    allowedOrigins: e.ALLOWED_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
    profile: e.PROFILE,
    databaseUrl: e.DATABASE_URL,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    elevenlabsApiKey: e.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: e.ELEVENLABS_VOICE_ID,
    cartesia:
      e.CARTESIA_API_KEY && e.CARTESIA_VOICE_ID
        ? { apiKey: e.CARTESIA_API_KEY, voiceId: e.CARTESIA_VOICE_ID }
        : undefined,
    auth,
    limits: {
      // 16 kHz mono PCM16 is 32 KB/s, so 10 MiB is about 5.5 minutes of speech.
      maxPayloadBytes: 10 * 1024 * 1024,
      maxTextFrameBytes: 64 * 1024,
      maxConcurrentSessionsPerOwner: 2,
      maxTurnsPerSession: 200,
      idleTimeoutMs: 15 * 60 * 1000,
      reportTimeoutMs: 90_000,
    },
    debugLogText: e.DEBUG_LOG_TEXT === "true" || e.DEBUG_LOG_TEXT === "1",
    reportFillerCounts: ["1", "true"].includes((e.REPORT_FILLER_COUNTS ?? "").toLowerCase()),
    cloudSend: ["1", "true"].includes((e.CLOUD_SEND_TRANSCRIPTS ?? "").toLowerCase()),
    retentionDays: e.RETENTION_DAYS,
  };
}

/** Persona-from-calls is on when the operator allows cloud sends, or the mock profile (nothing leaves the machine). */
export function callsEnabled(config: Pick<Config, "cloudSend" | "profile">): boolean {
  return config.cloudSend || config.profile === "mock";
}
