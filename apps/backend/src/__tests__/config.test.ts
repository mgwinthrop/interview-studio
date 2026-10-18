import { describe, it, expect } from "vitest";
import { loadConfig, isLoopback, ConfigError } from "../config";

const keys = { ANTHROPIC_API_KEY: "a", ELEVENLABS_API_KEY: "e" };

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ ...keys });
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(3001);
    expect(c.profile).toBe("cloud");
    expect(c.allowedOrigins).toEqual(["http://localhost:3000"]);
    expect(c.auth).toEqual({ mode: "local" });
    expect(c.limits).toEqual({
      maxPayloadBytes: 10 * 1024 * 1024,
      maxTextFrameBytes: 64 * 1024,
      maxConcurrentSessionsPerOwner: 2,
      maxTurnsPerSession: 200,
      idleTimeoutMs: 15 * 60 * 1000,
      reportTimeoutMs: 90_000,
    });
  });

  it("cloud profile requires both keys, naming the missing one", () => {
    expect(() => loadConfig({ ELEVENLABS_API_KEY: "e" })).toThrow(ConfigError);
    expect(() => loadConfig({ ELEVENLABS_API_KEY: "e" })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ ANTHROPIC_API_KEY: "a" })).toThrow(/ELEVENLABS_API_KEY/);
  });

  it("mock profile needs no keys", () => {
    expect(loadConfig({ PROFILE: "mock" }).profile).toBe("mock");
  });

  it("falls back to default voice for empty ELEVENLABS_VOICE_ID", () => {
    expect(loadConfig({ ...keys, ELEVENLABS_VOICE_ID: "" }).elevenlabsVoiceId).toBe("pNInz6obpgDQGcFmaJgB");
  });

  it("refuses non-loopback host without AUTH_TOKEN", () => {
    expect(() => loadConfig({ ...keys, HOST: "0.0.0.0" })).toThrow(/authentication/);
  });

  it("uses token auth for non-loopback host with AUTH_TOKEN", () => {
    const c = loadConfig({ ...keys, HOST: "0.0.0.0", AUTH_TOKEN: "secret" });
    expect(c.auth).toEqual({ mode: "token", token: "secret" });
  });

  it.each(["::1", "localhost", "127.0.0.1", "::ffff:127.0.0.1"])(
    "HOST=%s stays in local mode without AUTH_TOKEN",
    (HOST) => {
      const c = loadConfig({ ...keys, HOST });
      expect(c.host).toBe(HOST);
      expect(c.auth).toEqual({ mode: "local" });
    },
  );

  it("treats an empty AUTH_TOKEN as unset", () => {
    expect(loadConfig({ ...keys, AUTH_TOKEN: "" }).auth).toEqual({ mode: "local" });
    expect(loadConfig({ ...keys, AUTH_TOKEN: "   " }).auth).toEqual({ mode: "local" });
    expect(() => loadConfig({ ...keys, HOST: "0.0.0.0", AUTH_TOKEN: "" })).toThrow(ConfigError);
    expect(() => loadConfig({ ...keys, HOST: "0.0.0.0", AUTH_TOKEN: "" })).toThrow(/authentication/);
  });

  it("rejects non-numeric PORT", () => {
    expect(() => loadConfig({ ...keys, PORT: "abc" })).toThrow(ConfigError);
  });

  it("rejects CARTESIA_API_KEY without CARTESIA_VOICE_ID", () => {
    expect(() => loadConfig({ ...keys, CARTESIA_API_KEY: "c", CARTESIA_VOICE_ID: "" })).toThrow(ConfigError);
  });

  it("parses comma-separated origins and optional values", () => {
    const c = loadConfig({
      ...keys,
      ALLOWED_ORIGIN: "http://a.test, http://b.test",
      RETENTION_DAYS: "30",
      DEBUG_LOG_TEXT: "true",
      CARTESIA_API_KEY: "c",
      CARTESIA_VOICE_ID: "v",
    });
    expect(c.allowedOrigins).toEqual(["http://a.test", "http://b.test"]);
    expect(c.retentionDays).toBe(30);
    expect(c.debugLogText).toBe(true);
    expect(c.cartesia).toEqual({ apiKey: "c", voiceId: "v" });
  });
});

describe("isLoopback", () => {
  it.each(["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1"])("true for %s", (h) => {
    expect(isLoopback(h)).toBe(true);
  });
  it.each(["0.0.0.0", "192.168.1.5"])("false for %s", (h) => {
    expect(isLoopback(h)).toBe(false);
  });
});
