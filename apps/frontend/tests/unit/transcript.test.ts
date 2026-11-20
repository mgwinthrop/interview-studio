import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../app/lib/config", () => ({ apiUrl: "http://api.test" }));

import { fetchTurns, parseTurns } from "../../app/lib/transcript";

// FQ-50 S0 (#151): a malformed or missing transcript must never break the report: parseTurns
// rejects bad shapes and fetchTurns resolves null instead of throwing.

const GOOD = {
  turns: [
    { role: "assistant", content: "Hello. What brings you here?", phase: "intro" },
    { role: "user", content: "hello there", phase: "intro", answer: 1 },
  ],
};
const one = (t: object) => ({ turns: [t] });

describe("parseTurns", () => {
  it("accepts the route's shape", () => {
    expect(parseTurns(GOOD)).toEqual(GOOD.turns);
  });

  it.each([
    ["null", null],
    ["turns not an array", { turns: "x" }],
    ["unknown role", one({ role: "system", content: "x", phase: "intro" })],
    ["content not a string", one({ role: "user", content: 3, phase: "intro", answer: 1 })],
    ["phase missing", one({ role: "assistant", content: "x" })],
    ["user turn without a positive answer number", one({ role: "user", content: "x", phase: "intro", answer: 0 })],
    ["answer on an interviewer turn", one({ role: "assistant", content: "x", phase: "intro", answer: 1 })],
  ])("rejects %s", (_name, json) => {
    expect(parseTurns(json)).toBeNull();
  });
});

describe("fetchTurns", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fetches the session's turns from the API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(GOOD), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchTurns("a b")).resolves.toEqual(GOOD.turns);
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/api/session/a%20b/turns", expect.anything());
  });

  it.each([
    ["a 404", async () => new Response("{}", { status: 404 })],
    ["a bad shape", async () => new Response(JSON.stringify({ turns: 1 }), { status: 200 })],
    ["invalid JSON", async () => new Response("not json", { status: 200 })],
    ["a network error", async () => { throw new TypeError("network"); }],
  ])("resolves null on %s, without throwing", async (_name, impl) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    await expect(fetchTurns("s1")).resolves.toBeNull();
  });
});
