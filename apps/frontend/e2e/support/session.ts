import fs from "node:fs";
import path from "node:path";
import type { Page, WebSocketRoute } from "@playwright/test";

// Shared e2e harness for the client session rebuild's oracle (FQ-108 phase 0, design §2.2).
// - proxySession: a Playwright routeWebSocket proxy between the page and the mock backend. The
//   mock's TTS sends two 4-byte frames per sentence, which the client drops (< 512 bytes), so
//   nothing ever plays. The proxy replaces each sentence's audio with a real silent MP3 so
//   playback, turn_timing and barge-in can be tested. It can also hold a server frame type,
//   inject frames the mock never sends, and records the client→server frame order (O3).
// - installProbes: live microphone tracks, playback starts, focus target, insertion counters.
// - speech: drives the voice detector through the e2e build's test seam (app/session/testSeams.ts).

const SILENCE_MP3 = fs.readFileSync(path.join(__dirname, "../fixtures/silence-250ms.mp3"));

type HeldType = "tts_end" | "tts_start" | "session_complete" | "session_failed";

export interface ProxyControl {
  /** Holds the next server frame of this type (and everything after it) until release(). */
  hold(type: HeldType): void;
  release(): void;
  /** Sends a frame the mock never produces, or closes the page's socket with a code. */
  inject(frame: object | { close: number; reason?: string }): void;
  /** Ordered client→server frame types seen so far: JSON `type`, or "audio" for binary. */
  clientFrames(): string[];
}

export interface ProxyOptions {
  /** Replace the mock's audio with the silent MP3 (default true). False forwards it unchanged. */
  replaceAudio?: boolean;
}

function frameType(message: string | Buffer): string | null {
  if (typeof message !== "string") return null;
  try {
    return (JSON.parse(message) as { type?: string }).type ?? null;
  } catch {
    return null;
  }
}

/** Installs the proxy. Call before page.goto. Applies to every socket the page opens. */
export async function proxySession(page: Page, options: ProxyOptions = {}): Promise<ProxyControl> {
  const replaceAudio = options.replaceAudio ?? true;
  const frames: string[] = [];
  let current: WebSocketRoute | null = null;
  let holdType: HeldType | null = null;
  let holding = false;
  const held: (string | Buffer)[] = [];

  await page.routeWebSocket(/localhost:3001/, (ws) => {
    current = ws;
    const server = ws.connectToServer();
    // True from tts_start until this sentence's audio has been replaced.
    let replaceNext = false;

    const deliver = (message: string | Buffer) => {
      if (holding) {
        held.push(message);
        return;
      }
      ws.send(message);
    };

    ws.onMessage((message) => {
      frames.push(typeof message === "string" ? frameType(message) ?? "unknown" : "audio");
      server.send(message);
    });

    server.onMessage((message) => {
      const type = frameType(message);
      if (type !== null && type === holdType && !holding) {
        holdType = null;
        holding = true;
      }
      if (type === "tts_start") replaceNext = true;
      if (typeof message !== "string" && replaceAudio) {
        if (!replaceNext) return; // the rest of this sentence's mock frames
        replaceNext = false;
        deliver(SILENCE_MP3);
        return;
      }
      deliver(message);
    });
  });

  return {
    hold(type) {
      holdType = type;
    },
    release() {
      holding = false;
      for (const m of held.splice(0)) current?.send(m);
    },
    inject(frame) {
      if (!current) throw new Error("inject: no socket is open yet");
      if ("close" in frame && typeof frame.close === "number") {
        void current.close({ code: frame.close, reason: (frame as { reason?: string }).reason ?? "" });
        return;
      }
      current.send(JSON.stringify(frame));
    },
    clientFrames: () => [...frames],
  };
}

export interface Probes {
  /** Microphone tracks the page opened that are still live. */
  liveTracks(): Promise<number>;
  /** How many audio buffers the page has started playing. */
  playbackStarts(): Promise<number>;
  /** How many started audio buffers have finished. */
  playbackEnds(): Promise<number>;
  /** Role and accessible name of the focused element, e.g. "button:Resume session". */
  focusTarget(): Promise<string>;
  /** How many times an element matching the selector has been inserted into the page. */
  insertions(selector: string): Promise<number>;
}

type ProbeWindow = Window & {
  __probe: {
    tracks: MediaStreamTrack[];
    starts: number;
    ends: number;
    selectors: Record<string, number>;
  };
};

/** Installs the probes. Call before page.goto. */
export async function installProbes(page: Page): Promise<Probes> {
  await page.addInitScript(() => {
    const w = window as unknown as ProbeWindow;
    w.__probe = { tracks: [], starts: 0, ends: 0, selectors: {} };
    const md = navigator.mediaDevices;
    const getUserMedia = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      const s = await getUserMedia(c);
      w.__probe.tracks.push(...s.getAudioTracks());
      return s;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      w.__probe.starts++;
      this.addEventListener("ended", () => { w.__probe.ends++; });
      return start.apply(this, args);
    };
    new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          for (const sel of Object.keys(w.__probe.selectors)) {
            if (n.matches(sel) || n.querySelector(sel)) w.__probe.selectors[sel]++;
          }
        });
      }
    }).observe(document, { childList: true, subtree: true });
  });
  return {
    liveTracks: () =>
      page.evaluate(() => (window as unknown as ProbeWindow).__probe.tracks.filter((t) => t.readyState === "live").length),
    playbackStarts: () => page.evaluate(() => (window as unknown as ProbeWindow).__probe.starts),
    playbackEnds: () => page.evaluate(() => (window as unknown as ProbeWindow).__probe.ends),
    focusTarget: () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "body";
        const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
        return `${role}:${name}`;
      }),
    insertions: async (selector) => {
      // Counting starts on first use; register before the action being counted.
      await page.evaluate((sel) => {
        const p = (window as unknown as ProbeWindow).__probe;
        p.selectors[sel] = p.selectors[sel] ?? 0;
      }, selector);
      return page.evaluate((sel) => (window as unknown as ProbeWindow).__probe.selectors[sel], selector);
    },
  };
}

type SeamWindow = Window & { __testSeams?: { vad?: { speechStart(): void; speechEnd(samples?: Float32Array): void } } };

async function seam(page: Page) {
  await page.waitForFunction(() => !!(window as SeamWindow).__testSeams?.vad, undefined, { timeout: 10_000 });
}

/** Drives the live voice detector through the e2e build's test seam. */
export const speech = {
  async start(page: Page): Promise<void> {
    await seam(page);
    await page.evaluate(() => (window as SeamWindow).__testSeams!.vad!.speechStart());
  },
  async end(page: Page): Promise<void> {
    await seam(page);
    await page.evaluate(() => (window as SeamWindow).__testSeams!.vad!.speechEnd());
  },
};
