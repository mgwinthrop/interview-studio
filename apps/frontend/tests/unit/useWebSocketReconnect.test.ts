// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "../../app/hooks/useWebSocket";

// FQ-110 (#110): after Start over (reconnect() once the old socket has already closed), the next
// clean server close of the new socket must still show "disconnected" with its close reason.
// Deliberate closes (a reconnect while a socket is open, and unmount) must still never set
// "disconnected", so the Connection lost overlay does not flash.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A fake WebSocket that follows the browser's close rules: close() on a socket that is already
 * closing or closed does nothing and fires no event; close() on an open socket fires `close`
 * later (code 1005, no status); close() while still connecting fires `error`, then `close` (1006).
 */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSING || this.readyState === FakeSocket.CLOSED) return;
    const wasConnecting = this.readyState === FakeSocket.CONNECTING;
    this.readyState = FakeSocket.CLOSING;
    setTimeout(() => {
      if (wasConnecting) this.onerror?.();
      this.finishClose(wasConnecting ? 1006 : 1005, "");
    }, 0);
  }

  /** Test helper: the server accepts the connection. */
  serverOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Test helper: the server closes the connection cleanly (no error event). */
  serverClose(code: number, reason = ""): void {
    this.finishClose(code, reason);
  }

  private finishClose(code: number, reason: string): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

type Api = ReturnType<typeof useWebSocket>;

let root: Root | null = null;
let api: Api;
let states: string[] = [];

function mount(): void {
  function Harness() {
    api = useWebSocket("tell-a-story", false);
    states.push(api.connectionState);
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(createElement(Harness)));
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function latest(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1];
}

beforeEach(() => {
  FakeSocket.instances = [];
  states = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubEnv("NEXT_PUBLIC_WS_URL", "ws://test.invalid");
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useWebSocket close handling (FQ-110)", () => {
  it("shows a clean server close as disconnected", async () => {
    mount();
    act(() => latest().serverOpen());
    expect(api.connectionState).toBe("connected");

    act(() => latest().serverClose(1001));
    await flush();
    expect(api.connectionState).toBe("disconnected");
    expect(api.closeInfo).toEqual({ code: 1001, reason: "" });
  });

  it("after Start over on a closed socket, the next clean server close still shows disconnected", async () => {
    mount();
    act(() => latest().serverOpen());
    act(() => latest().serverClose(1001));
    await flush();
    expect(api.connectionState).toBe("disconnected");

    // Start over: the overlay is only shown once the old socket is already closed.
    act(() => api.reconnect());
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
    const second = latest();
    act(() => second.serverOpen());
    expect(api.connectionState).toBe("connected");

    act(() => second.serverClose(1001, "idle"));
    await flush();
    expect(api.connectionState).toBe("disconnected");
    expect(api.closeInfo).toEqual({ code: 1001, reason: "idle" });
    expect(api.closeReason).toBe("The conversation timed out from inactivity. Start over.");
  });

  it("after Start over, a rejected request (1008) on the new socket still shows disconnected", async () => {
    mount();
    act(() => latest().serverOpen());
    act(() => latest().serverClose(1013));
    await flush();

    act(() => api.reconnect());
    await flush();
    act(() => latest().serverOpen());
    act(() => latest().serverClose(1008, "bad start"));
    await flush();
    expect(api.connectionState).toBe("disconnected");
    expect(api.closeInfo).toEqual({ code: 1008, reason: "bad start" });
  });

  it("a reconnect while the socket is still open never shows disconnected", async () => {
    mount();
    const first = latest();
    act(() => first.serverOpen());

    states = [];
    act(() => api.reconnect());
    await flush(); // the old socket's close event fires here
    expect(first.readyState).toBe(FakeSocket.CLOSED);
    expect(states).not.toContain("disconnected");
    expect(api.connectionState).toBe("connecting");

    act(() => latest().serverOpen());
    expect(api.connectionState).toBe("connected");
  });

  it("unmounting closes the open socket and renders no disconnected state", async () => {
    // After unmount the hook's state is gone, so this guards that cleanup closes the socket and
    // its late close event runs without error; it cannot observe a post-unmount state update.
    mount();
    const sock = latest();
    act(() => sock.serverOpen());

    states = [];
    act(() => root!.unmount());
    root = null;
    await flush();
    expect(sock.readyState).toBe(FakeSocket.CLOSED);
    expect(states).not.toContain("disconnected");
  });
});
