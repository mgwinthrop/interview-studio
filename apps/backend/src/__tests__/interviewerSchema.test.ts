import { describe, expect, it } from "vitest";
import {
  parseInterviewerDefinition,
  parseInterviewerInput,
  SYSTEM_OWNER,
  type FieldError,
} from "../interviewer/schema.js";

function valid(): Record<string, any> {
  return {
    name: "Design Critic",
    purpose: "Practise talking through a design decision.",
    persona: "A calm senior designer.",
    style: "Short, curious questions.",
    opening: "Hi, shall we start?",
    closing: "Thanks for your time.",
    phases: [
      { name: "Intro", instruction: "Say hello.", minTurns: 1, maxTurns: 2 },
      { name: "Deep dive", instruction: "Probe.", minTurns: 2, maxTurns: 5 },
      { name: "Wrap up", instruction: "Close." },
    ],
    focus: ["trade-offs"],
  };
}

function errorsOf(raw: unknown): FieldError[] {
  const r = parseInterviewerInput(raw);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
}

function paths(raw: unknown): string[] {
  return errorsOf(raw).map((e) => e.path);
}

describe("parseInterviewerInput", () => {
  it("accepts a valid input and applies feedback defaults", () => {
    const r = parseInterviewerInput(valid());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.contentFeedback).toBe(true);
      expect(r.value.deliveryFeedback).toBe(true);
      expect(r.value.phases[2].minTurns).toBeUndefined();
    }
  });

  it("keeps explicit feedback flags", () => {
    const r = parseInterviewerInput({ ...valid(), contentFeedback: false, deliveryFeedback: false });
    expect(r.ok && r.value.contentFeedback).toBe(false);
    expect(r.ok && r.value.deliveryFeedback).toBe(false);
  });

  it("exports the system owner", () => {
    expect(SYSTEM_OWNER).toBe("system");
  });

  describe.each([
    ["name", 60],
    ["purpose", 200],
    ["persona", 1500],
    ["style", 600],
    ["opening", 400],
    ["closing", 400],
  ])("%s cap", (field, cap) => {
    it("accepts exactly the cap", () => {
      expect(parseInterviewerInput({ ...valid(), [field]: "a".repeat(cap) }).ok).toBe(true);
    });
    it("rejects over the cap, naming the path", () => {
      expect(paths({ ...valid(), [field]: "a".repeat(cap + 1) })).toContain(field);
    });
    it("rejects empty and whitespace-only", () => {
      expect(paths({ ...valid(), [field]: "" })).toContain(field);
      expect(paths({ ...valid(), [field]: "   \n " })).toContain(field);
    });
    it("trims before checking the cap", () => {
      const r = parseInterviewerInput({ ...valid(), [field]: `  ${"a".repeat(cap)}  ` });
      expect(r.ok).toBe(true);
      if (r.ok) expect((r.value as any)[field]).toBe("a".repeat(cap));
    });
  });

  it("rejects non-string values", () => {
    expect(paths({ ...valid(), name: 5 })).toContain("name");
    expect(paths({ ...valid(), name: undefined })).toContain("name");
  });

  it("rejects non-object input", () => {
    expect(parseInterviewerInput(null).ok).toBe(false);
    expect(parseInterviewerInput("x").ok).toBe(false);
  });

  describe("control characters", () => {
    it("rejects NUL and ESC", () => {
      expect(paths({ ...valid(), persona: "a\u0000b" })).toContain("persona");
      expect(paths({ ...valid(), persona: "a\u001bb" })).toContain("persona");
    });
    it("rejects other listed controls", () => {
      for (const c of ["\u0008", "\u000b", "\u001f", "\u007f"]) {
        expect(paths({ ...valid(), style: `a${c}b` })).toContain("style");
      }
    });
    it("rejects a tab", () => {
      expect(paths({ ...valid(), persona: "a\tb" })).toContain("persona");
    });
    it("normalises CRLF and lone CR to LF", () => {
      for (const raw of ["a\r\nb", "a\rb"]) {
        const r = parseInterviewerInput({ ...valid(), persona: raw });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.persona).toBe("a\nb");
      }
    });
    it("counts each CRLF as one character against the cap", () => {
      const base = Array.from({ length: 750 }, () => "a").join("\r\n"); // 1499 after normalising
      expect(base.length).toBe(2248);
      expect(parseInterviewerInput({ ...valid(), persona: base + "b" }).ok).toBe(true); // 1500
      expect(paths({ ...valid(), persona: base + "bc" })).toContain("persona"); // 1501
    });
    it("intentionally allows U+0085 and U+2028", () => {
      expect(parseInterviewerInput({ ...valid(), persona: "a\u0085b\u2028c" }).ok).toBe(true);
    });
    it("accepts newline", () => {
      expect(parseInterviewerInput({ ...valid(), persona: "line one\nline two" }).ok).toBe(true);
    });
    it("applies to phase text and focus", () => {
      const v = valid();
      v.phases[0].instruction = "x\u0000";
      v.focus = ["y\u001b"];
      const p = paths(v);
      expect(p).toContain("phases.0.instruction");
      expect(p).toContain("focus.0");
    });
  });

  describe("phases", () => {
    it("accepts one phase with no turns", () => {
      expect(parseInterviewerInput({ ...valid(), phases: [{ name: "Only", instruction: "Go." }] }).ok).toBe(true);
    });
    it("accepts eight phases and rejects nine", () => {
      const mk = (n: number) =>
        Array.from({ length: n }, (_, i) =>
          i === n - 1
            ? { name: `P${i}`, instruction: "x" }
            : { name: `P${i}`, instruction: "x", minTurns: 1, maxTurns: 1 },
        );
      expect(parseInterviewerInput({ ...valid(), phases: mk(8) }).ok).toBe(true);
      expect(paths({ ...valid(), phases: mk(9) })).toContain("phases");
    });
    it("rejects zero phases", () => {
      expect(paths({ ...valid(), phases: [] })).toContain("phases");
    });
    it("caps phase name at 40 and instruction at 1200", () => {
      const ok = valid();
      ok.phases[0].name = "n".repeat(40);
      ok.phases[0].instruction = "i".repeat(1200);
      expect(parseInterviewerInput(ok).ok).toBe(true);
      const bad = valid();
      bad.phases[1].name = "n".repeat(41);
      bad.phases[1].instruction = "i".repeat(1201);
      const p = paths(bad);
      expect(p).toContain("phases.1.name");
      expect(p).toContain("phases.1.instruction");
    });
    it("rejects maxTurns < minTurns", () => {
      const v = valid();
      v.phases[1].minTurns = 5;
      v.phases[1].maxTurns = 4;
      expect(paths(v)).toContain("phases.1.maxTurns");
    });
    it("rejects minTurns 0, maxTurns 51 and non-integers", () => {
      const a = valid();
      a.phases[0].minTurns = 0;
      expect(paths(a)).toContain("phases.0.minTurns");
      const b = valid();
      b.phases[0].maxTurns = 51;
      expect(paths(b)).toContain("phases.0.maxTurns");
      const c = valid();
      c.phases[0].minTurns = 1.5;
      expect(paths(c)).toContain("phases.0.minTurns");
    });
    it("accepts maxTurns 50", () => {
      const v = valid();
      v.phases[0].maxTurns = 50;
      expect(parseInterviewerInput(v).ok).toBe(true);
    });
    it("requires turns on non-last phases", () => {
      const v = valid();
      delete v.phases[1].minTurns;
      delete v.phases[0].maxTurns;
      const p = paths(v);
      expect(p).toContain("phases.1.minTurns");
      expect(p).toContain("phases.0.maxTurns");
    });
    it("forbids turns on the last phase", () => {
      const v = valid();
      v.phases[2].minTurns = 1;
      v.phases[2].maxTurns = 2;
      const p = paths(v);
      expect(p).toContain("phases.2.minTurns");
      expect(p).toContain("phases.2.maxTurns");
    });
    it("rejects unknown keys inside a phase", () => {
      const v = valid();
      v.phases[0].extra = 1;
      expect(paths(v)).toContain("phases.0");
    });
  });

  describe("focus", () => {
    it("accepts six items of 120 and rejects a seventh", () => {
      const six = Array.from({ length: 6 }, () => "f".repeat(120));
      expect(parseInterviewerInput({ ...valid(), focus: six }).ok).toBe(true);
      expect(paths({ ...valid(), focus: [...six, "x"] })).toContain("focus");
    });
    it("rejects an item over 120 and an empty item", () => {
      expect(paths({ ...valid(), focus: ["f".repeat(121)] })).toContain("focus.0");
      expect(paths({ ...valid(), focus: ["  "] })).toContain("focus.0");
    });
    it("accepts an empty list", () => {
      expect(parseInterviewerInput({ ...valid(), focus: [] }).ok).toBe(true);
    });
  });

  describe("voice", () => {
    it("is optional and accepts an empty object", () => {
      expect(parseInterviewerInput({ ...valid(), voice: {} }).ok).toBe(true);
    });
    it("accepts 10 and 40 alphanumerics", () => {
      expect(parseInterviewerInput({ ...valid(), voice: { cloud: "a".repeat(10) } }).ok).toBe(true);
      expect(parseInterviewerInput({ ...valid(), voice: { cloud: "A1".repeat(20) } }).ok).toBe(true);
    });
    it("rejects bad format", () => {
      expect(paths({ ...valid(), voice: { cloud: "short" } })).toContain("voice.cloud");
      expect(paths({ ...valid(), voice: { cloud: "a".repeat(41) } })).toContain("voice.cloud");
      expect(paths({ ...valid(), voice: { cloud: "abcdefghi!" } })).toContain("voice.cloud");
    });
    it("rejects unknown keys in voice", () => {
      expect(paths({ ...valid(), voice: { local: "x" } })).toContain("voice");
    });
  });

  it("rejects unknown top-level keys", () => {
    expect(paths({ ...valid(), id: "sneaky" })).toContain("");
  });

  it.each(["source", "ownerId", "version"])("rejects server-assigned key %s without echoing it", (key) => {
    const errs = errorsOf({ ...valid(), [key]: "SECRET-VALUE" });
    expect(errs.map((e) => e.path)).toContain("");
    for (const e of errs) expect(e.message).not.toContain("SECRET");
  });

  it("gives the integer message for non-integers and the type message for strings", () => {
    const a = valid();
    a.phases[0].minTurns = 1.5;
    const e1 = errorsOf(a).find((e) => e.path === "phases.0.minTurns");
    expect(e1?.message).toBe("Must be a whole number.");
    const b = valid();
    b.phases[0].minTurns = "2";
    const e2 = errorsOf(b).find((e) => e.path === "phases.0.minTurns");
    expect(e2?.message).toBe("Wrong type for this field.");
  });

  it("never echoes submitted values in messages", () => {
    const secret = "SECRET-VALUE-123";
    const v = valid();
    v.persona = `${secret}\u0000`;
    v.name = secret.repeat(10);
    v.voice = { cloud: `${secret}!` };
    v.phases[0].instruction = `${secret}\u001b`;
    v.phases[0].name = 7;
    (v as any)[secret] = secret;
    v.phases[1][secret] = secret;
    v.focus = [secret.repeat(20)];
    const errs = errorsOf(v);
    expect(errs.length).toBeGreaterThan(3);
    for (const e of errs) {
      expect(e.message).not.toContain("SECRET");
      expect(e.path).not.toContain("SECRET");
      expect(e.message.length).toBeGreaterThan(0);
    }
  });
});

describe("parseInterviewerDefinition", () => {
  function def(): Record<string, any> {
    return {
      ...valid(),
      contentFeedback: true,
      deliveryFeedback: true,
      id: "design-critic_1",
      source: "custom",
      ownerId: SYSTEM_OWNER,
      version: 1,
      createdAt: "2026-10-18T10:00:00.000Z",
      updatedAt: "2026-10-18T10:00:00.000Z",
    };
  }

  it("returns a valid definition", () => {
    const d = parseInterviewerDefinition(def());
    expect(d.id).toBe("design-critic_1");
    expect(d.version).toBe(1);
  });

  it("throws listing paths only", () => {
    const bad = def();
    bad.id = "bad id SECRET";
    bad.version = 0;
    bad.persona = "SECRET\u0000";
    let msg = "";
    try {
      parseInterviewerDefinition(bad);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe("Invalid interviewer definition: persona, id, version");
    expect(msg).not.toContain("SECRET");
  });

  it("rejects bad source, ownerId, dates and long id", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ source: "other" }, "source"],
      [{ ownerId: "" }, "ownerId"],
      [{ ownerId: "o".repeat(65) }, "ownerId"],
      [{ createdAt: "yesterday" }, "createdAt"],
      [{ updatedAt: 5 }, "updatedAt"],
      [{ id: "i".repeat(65) }, "id"],
      [{ id: "" }, "id"],
      [{ version: 1.5 }, "version"],
    ];
    for (const [patch, path] of cases) {
      expect(() => parseInterviewerDefinition({ ...def(), ...patch })).toThrow(
        new Error(`Invalid interviewer definition: ${path}`),
      );
    }
  });

  it("rejects unknown keys", () => {
    expect(() => parseInterviewerDefinition({ ...def(), extra: 1 })).toThrow(
      new Error("Invalid interviewer definition: (root)"),
    );
  });
});
