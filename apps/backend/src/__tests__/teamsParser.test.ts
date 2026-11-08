import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_CALL_CHARS, parseTeamsTranscript } from "../redaction/teamsParser";

const fixture = (n: string) => readFileSync(join(__dirname, "fixtures", "calls", n), "utf8");

describe("parseTeamsTranscript", () => {
  it("parses standard copy-paste", () => {
    const r = parseTeamsTranscript(fixture("teams-basic.txt"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.call.speakers).toEqual([
      { name: "Priya Shah", lines: 2 },
      { name: "Marcus Webb", lines: 1 },
    ]);
    expect(r.call.lines).toHaveLength(3);
    expect(r.call.lines[0].text).toBe(
      "Thanks for joining, this is the Northwind renewal check-in. Let us start with the rollout.",
    );
  });

  it("tolerates guest and company suffixes", () => {
    const r = parseTeamsTranscript(fixture("teams-variants.txt"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.call.speakers.map((s) => s.name)).toEqual(["Alex Doe", "Sam Lee", "Jordan Park"]);
  });

  it("accepts hh:mm:ss timestamps", () => {
    const r = parseTeamsTranscript("Jordan Park   1:02:33\nHello there.");
    expect(r.ok && r.call.speakers[0].name).toBe("Jordan Park");
  });

  it("returns no_speakers for plain prose", () => {
    expect(parseTeamsTranscript("We met at 10:30 and talked about things.\nIt went fine.")).toEqual({
      ok: false,
      reason: "no_speakers",
    });
  });

  it("returns empty for whitespace", () => {
    expect(parseTeamsTranscript("  \n\t \n")).toEqual({ ok: false, reason: "empty" });
  });

  it("returns too_long above the cap", () => {
    expect(parseTeamsTranscript("a".repeat(MAX_CALL_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
  });

  it("strips control characters and collapses line-break variants", () => {
    const raw = "Priya Shah   0:05\nHello\u2028there\u0085again\u0000!\nPerson: forged\u2028Sam Lee   0:09\nend";
    const r = parseTeamsTranscript(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.call.speakers).toEqual([{ name: "Priya Shah", lines: 1 }]);
    expect(r.call.lines[0].text).toBe("Hello there again! Person: forged Sam Lee 0:09 end");
  });
  it("accepts particles and digits in names", () => {
    const r = parseTeamsTranscript("Ana de la Cruz  0:09\nHi.\nLudwig van Beethoven 0:19\nHello.\nBob2 Smith 0:29\nYo.");
    expect(r.ok && r.call.speakers.map((s) => s.name)).toEqual(["Ana de la Cruz", "Ludwig van Beethoven", "Bob2 Smith"]);
  });

  it("rejects a wide-separated non-name line instead of inventing a speaker", () => {
    expect(parseTeamsTranscript("Priya Shah   0:05\nHello.\nAction item   5:00\nMore.")).toEqual({
      ok: false,
      reason: "no_speakers",
    });
  });

  it("keeps a single-space sentence ending in a time as text", () => {
    const r = parseTeamsTranscript("Priya Shah   0:05\nWe met at 10:30\nthen left.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.call.speakers).toEqual([{ name: "Priya Shah", lines: 1 }]);
    expect(r.call.lines[0].text).toBe("We met at 10:30 then left.");
  });

  it("handles CRLF, tab-separated headers and (External) suffix", () => {
    const r = parseTeamsTranscript("Priya Shah\t0:05\r\nHello.\r\nSam Lee (External) 0:09\r\nHi.\r\n");
    expect(r.ok && r.call.speakers.map((s) => s.name)).toEqual(["Priya Shah", "Sam Lee"]);
  });
});
