/**
 * Conversation integration test
 *
 * Opt-in run against REAL providers (not part of `npm test`; the keyless equivalent is
 * conversation.test.ts). Drives a real session over WebSocket using text_input (no audio
 * required). Asserts on message sequence, phase transitions, the stored report, and LLM
 * response quality via an LLM-as-judge rubric.
 *
 * HOW TO RUN:
 *   1. Start the backend with real keys (PROFILE=cloud):  npm run dev  (in apps/backend/)
 *   2. In another terminal:  cd apps/backend && npm run test:integration
 *
 * ENVIRONMENT:
 *   TEST_WS_URL   — WebSocket URL of the server (default: ws://localhost:3001)
 *   INTEGRATION_TEST=1  — required to un-skip these tests
 *
 * All other env vars (ANTHROPIC_API_KEY, ELEVENLABS_API_KEY, DATABASE_URL)
 * must be set for the backend server — not for this test script itself. ANTHROPIC_API_KEY
 * must also be set here for the LLM-as-judge calls. If the server runs with AUTH_TOKEN,
 * set TEST_AUTH_TOKEN so the test can send it as a Bearer header.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import Anthropic from "@anthropic-ai/sdk";

const WS_URL = process.env.TEST_WS_URL ?? "ws://localhost:3001";
const HTTP_URL = WS_URL.replace(/^ws/, "http");
const RUN = !!process.env.INTEGRATION_TEST;
const AUTH_HEADERS: Record<string, string> = process.env.TEST_AUTH_TOKEN
  ? { Authorization: `Bearer ${process.env.TEST_AUTH_TOKEN}` }
  : {};

// ── WebSocket client ──────────────────────────────────────────────────────────

type AnyMsg = Record<string, unknown>;

class WsClient {
  private ws: WebSocket;
  private received: AnyMsg[] = [];
  private waiters: Array<{
    pred: (m: AnyMsg) => boolean;
    resolve: (m: AnyMsg) => void;
    reject: (e: Error) => void;
  }> = [];

  readonly opened: Promise<void>;
  readonly closed: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url, { headers: AUTH_HEADERS });

    this.opened = new Promise((res, rej) => {
      this.ws.once("open", res);
      this.ws.once("error", rej);
    });
    this.closed = new Promise((res) => this.ws.once("close", () => res()));

    this.ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) return; // TTS audio chunks — not relevant for flow assertions
      let msg: AnyMsg;
      try {
        msg = JSON.parse((data as Buffer).toString()) as AnyMsg;
      } catch {
        return;
      }
      this.received.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(msg)) {
          w.resolve(msg);
          return false;
        }
        return true;
      });
    });
  }

  send(msg: object): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the first matching message (already received or future). */
  waitFor(pred: (m: AnyMsg) => boolean, timeoutMs = 45_000): Promise<AnyMsg> {
    const existing = this.received.find(pred);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        reject(new Error(`Timeout (${timeoutMs}ms) waiting for WS message`));
      }, timeoutMs);

      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
        reject,
      });
    });
  }

  /** Number of already-received messages matching pred. */
  count(pred: (m: AnyMsg) => boolean): number {
    return this.received.filter(pred).length;
  }

  all(): AnyMsg[] {
    return [...this.received];
  }

  close(): void {
    this.ws.close();
  }
}

// ── LLM-as-judge ─────────────────────────────────────────────────────────────

async function judgeResponse(
  aiText: string,
  rubric: string,
): Promise<{ pass: boolean; reason: string }> {
  const client = new Anthropic();
  const result = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages: [
      {
        role: "user",
        content: [
          "Evaluate this interviewer response against the rubric.",
          "Reply with JSON only — no other text: {\"pass\": true/false, \"reason\": \"one sentence\"}",
          "",
          `RUBRIC: ${rubric}`,
          "",
          `RESPONSE: "${aiText}"`,
        ].join("\n"),
      },
    ],
  });

  const raw = result.content[0].type === "text" ? result.content[0].text : "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { pass: false, reason: "judge returned unparseable output" };
  try {
    return JSON.parse(match[0]) as { pass: boolean; reason: string };
  } catch {
    return { pass: false, reason: "judge JSON parse error" };
  }
}

// ── Integration tests ─────────────────────────────────────────────────────────

describe.skipIf(!RUN)(
  "session integration (requires running server + API keys)",
  { timeout: 180_000 },
  () => {
    let client: WsClient;
    let allMessages: AnyMsg[];
    let sessionId = "";

    beforeAll(async () => {
      // Verify the server is reachable before spending time on WS setup
      const health = await fetch(`${HTTP_URL}/health`, { headers: AUTH_HEADERS }).then(
        (r) => r.json() as Promise<{ status: string }>,
      );
      if (health.status !== "ok") throw new Error(`Server health check failed at ${HTTP_URL}`);

      client = new WsClient(WS_URL);
      await client.opened;

      // ── 1. Start session in demo mode (intro threshold = 1 turn) ─────────
      // The server issues the session id; the client never chooses one.
      client.send({ type: "session_start", topicId: "ai-se-delivery", demo: true });
      const started = await client.waitFor((m) => m.type === "session_started");
      sessionId = started.sessionId as string;

      // Wait for the AI greeting to fully arrive (tts_end = TTS chain complete)
      await client.waitFor((m) => m.type === "tts_end");

      // ── 2. Send one user turn — in demo mode this triggers intro → share_work ──
      client.send({
        type: "text_input",
        content:
          "Hi, I'm Alex, a software engineer at a fintech startup. I've been using GitHub Copilot for about six months.",
      });

      // Wait for the AI response to complete: the second tts_end (the first was the greeting)
      await client.waitFor(() => client.count((m) => m.type === "tts_end") >= 2);

      // ── 3. End the session ────────────────────────────────────────────────
      client.send({ type: "session_end" });
      await client.waitFor((m) => m.type === "session_complete", 30_000);

      allMessages = client.all();
    });

    afterAll(() => {
      client?.close();
    });

    // ── Message sequence assertions ──────────────────────────────────────────

    it("session_started is the first message and carries a UUID", () => {
      expect(allMessages[0].type).toBe("session_started");
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("greeting transcript arrives after session_start", () => {
      const greet = allMessages.find(
        (m) => m.type === "transcript" && m.role === "assistant",
      );
      expect(greet, "no assistant transcript received").toBeDefined();
      expect((greet!.text as string).length).toBeGreaterThan(10);
    });

    it("tts_start and tts_end bracket the greeting", () => {
      const types = allMessages.map((m) => m.type);
      const startIdx = types.indexOf("tts_start");
      const endIdx = types.indexOf("tts_end");
      expect(startIdx, "tts_start missing").toBeGreaterThanOrEqual(0);
      expect(endIdx, "tts_end missing").toBeGreaterThanOrEqual(0);
      expect(endIdx).toBeGreaterThan(startIdx);
    });

    it("user transcript is echoed", () => {
      const userTurn = allMessages.find(
        (m) => m.type === "transcript" && m.role === "user",
      );
      expect(userTurn, "no user transcript received").toBeDefined();
      expect(userTurn!.text as string).toContain("Alex");
    });

    it("AI responds after user turn", () => {
      const userIdx = allMessages.findIndex(
        (m) => m.type === "transcript" && m.role === "user",
      );
      expect(userIdx, "user transcript not found").toBeGreaterThanOrEqual(0);
      const aiAfter = allMessages
        .slice(userIdx + 1)
        .find((m) => m.type === "transcript" && m.role === "assistant");
      expect(aiAfter, "no AI transcript after user turn").toBeDefined();
      expect((aiAfter!.text as string).length).toBeGreaterThan(10);
    });

    it("phase_change to share_work fires (demo intro = 1 turn)", () => {
      const phaseChange = allMessages.find((m) => m.type === "phase_change");
      expect(phaseChange, "no phase_change received").toBeDefined();
      expect(phaseChange!.phase).toBe("share_work");
    });

    it("latency_metric is emitted and is under 5 seconds", () => {
      const metric = allMessages.find((m) => m.type === "latency_metric");
      expect(metric, "no latency_metric received").toBeDefined();
      const ms = metric!.ms as number;
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(5_000);
    });

    it("session_complete carries the started session id and the report is stored", async () => {
      const complete = allMessages.find((m) => m.type === "session_complete");
      expect(complete, "no session_complete received").toBeDefined();
      expect(complete!.reportId).toBe(sessionId);
      expect(allMessages.some((m) => m.type === "session_failed")).toBe(false);

      const res = await fetch(`${HTTP_URL}/api/session/${sessionId}/report`, { headers: AUTH_HEADERS });
      expect(res.status).toBe(200);
      const report = (await res.json()) as { summary?: unknown };
      expect(typeof report.summary).toBe("string");
    });

    it("no stt_error events were emitted", () => {
      const errors = allMessages.filter((m) => m.type === "stt_error");
      expect(errors).toHaveLength(0);
    });

    // ── LLM quality judges ────────────────────────────────────────────────────

    it(
      "greeting passes quality rubric",
      async () => {
        const greet = allMessages.find(
          (m) => m.type === "transcript" && m.role === "assistant",
        );
        const { pass, reason } = await judgeResponse(
          greet!.text as string,
          "Greets the participant warmly. Asks at most one question. " +
            "Is 40 words or fewer. Contains no bullet points, numbered lists, or markdown formatting.",
        );
        expect(pass, `Rubric failed: ${reason}`).toBe(true);
      },
      30_000,
    );

    it(
      "AI response to user turn passes quality rubric",
      async () => {
        const userIdx = allMessages.findIndex(
          (m) => m.type === "transcript" && m.role === "user",
        );
        // Take the last assistant transcript (assembled final, or last partial)
        const aiResponses = allMessages
          .slice(userIdx + 1)
          .filter((m) => m.type === "transcript" && m.role === "assistant");
        const aiText = (aiResponses[aiResponses.length - 1]?.text ?? "") as string;

        const { pass, reason } = await judgeResponse(
          aiText,
          "Asks exactly one question. Is 40 words or fewer. " +
            "Contains no bullet points, numbered lists, or markdown formatting. " +
            "Does not open by summarising or paraphrasing what the participant said.",
        );
        expect(pass, `Rubric failed: ${reason}`).toBe(true);
      },
      30_000,
    );
  },
);
