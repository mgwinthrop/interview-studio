import { describe, expect, it } from "vitest";
import { redactCall } from "../redaction/redact";
import type { CallLine, ParsedCall } from "../redaction/teamsParser";

// All people and companies below are invented.
function call(lines: CallLine[]): ParsedCall {
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  return { lines, speakers: [...counts].map(([name, n]) => ({ name, lines: n })) };
}

const BUYER = "Priya Shah";
const SELLER = "Marcus Webb";

function one(text: string, terms: string[] = [], speaker = SELLER) {
  const r = redactCall(call([{ speaker, text }]), BUYER, terms);
  return r.lines[0].segments.map((s) => s.text).join("");
}

describe("redactCall", () => {
  it("assigns roles: counterpart is Buyer, others Our side N by first appearance", () => {
    const r = redactCall(
      call([
        { speaker: "Marcus Webb", text: "Hello there." },
        { speaker: "Priya Shah", text: "Hi." },
        { speaker: "Ines van der Berg", text: "Morning." },
        { speaker: "Marcus Webb", text: "Shall we start?" },
      ]),
      "Priya Shah",
      [],
    );
    expect(r.lines.map((l) => l.role)).toEqual(["Our side 1", "Buyer", "Our side 2", "Our side 1"]);
    expect(r.text).toBe(
      ["Our side 1: Hello there.", "Buyer: Hi.", "Our side 2: Morning.", "Our side 1: Shall we start?"].join("\n"),
    );
  });

  it("replaces speaker names including possessives and other casing", () => {
    expect(one("I read priya's notes and PRIYA agreed.")).toBe("I read [NAME] notes and [NAME] agreed.");
    expect(one("Ask Shah about it.")).toBe("Ask [NAME] about it.");
    expect(one("Priya Shah’s team is ready.")).toBe("[NAME] team is ready.");
    // The speaker's own name inside their own line is replaced too.
    const r = redactCall(call([{ speaker: SELLER, text: "This is Marcus speaking." }]), BUYER, []);
    expect(r.lines[0].segments.map((s) => s.text).join("")).toBe("This is [NAME] speaking.");
    expect(r.lines[0].segments.find((s) => s.change)).toEqual({ text: "[NAME]", change: "name" });
  });

  it("matches name parts of 3+ characters only, and accented names", () => {
    const r = redactCall(
      call([
        { speaker: "Li Wei", text: "Hi." },
        { speaker: "Zoë Ångström", text: "Li is here, wei too, and zoë and ÅNGSTRÖM. Liam is not." },
      ]),
      "Li Wei",
      [],
    );
    expect(r.lines[1].segments.map((s) => s.text).join("")).toBe(
      "Li is here, [NAME] too, and [NAME] and [NAME]. Liam is not.",
    );
  });

  it("does not match name parts inside longer words", () => {
    expect(one("The Shahnameh and Priyanka are unrelated.")).toBe("The Shahnameh and Priyanka are unrelated.");
  });

  it("removes names inside emails", () => {
    expect(one("Mail priya.shah@acme.com today.")).toBe("Mail [CONTACT] today.");
  });

  it("applies user terms case-insensitively with word boundaries", () => {
    expect(one("ACME and Acme Ltd are not Acmeville.", ["Acme"])).toBe(
      "[CLIENT] and [CLIENT] Ltd are not Acmeville.",
    );
    expect(one("Northwind (Café) won.", ["Northwind (Café)", "", "  "])).toBe("[CLIENT] won.");
    expect(one("We met Société Générale-ish folk at société générale.", ["Société Générale"])).toBe(
      "We met [CLIENT]-ish folk at [CLIENT].",
    );
    const r = redactCall(call([{ speaker: SELLER, text: "Acme said yes." }]), BUYER, ["acme"]);
    expect(r.lines[0].segments[0]).toEqual({ text: "[CLIENT]", change: "term" });
  });

  it("replaces amounts", () => {
    for (const a of ["£1,200", "$50/hr", "1.2k", "20%", "USD 5,000", "1.5m", "EUR 40k", "€300", "12,500", "250 GBP"]) {
      expect(one(`It came to ${a} in the end.`)).toBe("It came to [AMOUNT] in the end.");
    }
    expect(one("We charge 1.2k a day.")).toBe("We charge [AMOUNT] a day.");
    const r = redactCall(call([{ speaker: SELLER, text: "About £1,200." }]), BUYER, []);
    expect(r.lines[0].segments[1]).toEqual({ text: "[AMOUNT]", change: "amount" });
  });

  it("replaces pence, space-separated thousands and short dashed phone numbers whole", () => {
    expect(one("Only 50p each.")).toBe("Only [AMOUNT] each.");
    expect(one("About 1 200 euros or £10 000.")).toBe("About [AMOUNT] or [AMOUNT].");
    expect(one("Call me at 555-0199.")).toBe("Call me at [CONTACT].");
  });

  it("leaves small plain numbers and times alone", () => {
    expect(one("We have 3 options at 10:30 for 2 weeks.")).toBe("We have 3 options at 10:30 for 2 weeks.");
  });

  it("removes emails phones urls", () => {
    expect(one("Email m.webb+sales@north-wind.co.uk or call +44 20 7946 0958.")).toBe(
      "Email [CONTACT] or call [CONTACT].",
    );
    expect(one("Ring (020) 7946-0958 now.")).toBe("Ring [CONTACT] now.");
    expect(one("See https://acme.example.com/pricing?x=1, or www.acme-shop.com.")).toBe(
      "See [CONTACT], or [CONTACT].",
    );
    expect(one("It is on acmecorp.com/pricing today.")).toBe("It is on [CONTACT] today.");
    const r = redactCall(call([{ speaker: SELLER, text: "x@y.io" }]), BUYER, []);
    expect(r.lines[0].segments).toEqual([{ text: "[CONTACT]", change: "contact" }]);
  });

  it("suggests capitalised mid-sentence terms not already redacted", () => {
    const r = redactCall(
      call([
        { speaker: SELLER, text: "Fine. We spoke to Northwind Traders on Monday. Contoso agreed with Acme." },
        { speaker: BUYER, text: "I think Fabrikam's team and Priya know Teams well. Then Northwind Traders called." },
      ]),
      BUYER,
      ["Acme"],
    );
    expect(r.suggestions).toEqual(["Fabrikam", "Northwind Traders"]);
  });

  it("numbers in words are not detected", () => {
    // Known limit: spelled-out amounts pass through unchanged. The review UI tells the person
    // that redaction is best-effort and that they must check the text before sending it.
    expect(one("It was two hundred pounds a day.")).toBe("It was two hundred pounds a day.");
  });

  it("segments reconstruct text", () => {
    const r = redactCall(
      call([
        { speaker: SELLER, text: "Priya, mail priya@acme.com about the £1,200 Acme deal, 20% off." },
        { speaker: BUYER, text: "Thanks Marcus." },
        { speaker: BUYER, text: "Nothing to change here." },
      ]),
      BUYER,
      ["Acme"],
    );
    const joined = r.lines.map((l) => `${l.role}: ${l.segments.map((s) => s.text).join("")}`).join("\n");
    expect(joined).toBe(r.text);
    expect(r.text).toBe(
      [
        "Our side 1: [NAME], mail [CONTACT] about the [AMOUNT] [CLIENT] deal, [AMOUNT] off.",
        "Buyer: Thanks [NAME].",
        "Buyer: Nothing to change here.",
      ].join("\n"),
    );
    expect(r.lines[2].segments).toEqual([{ text: "Nothing to change here." }]);
  });

  it("forbidden contains every original speaker name part and term", () => {
    const r = redactCall(
      call([
        { speaker: "Priya Shah", text: "Hi." },
        { speaker: "Ines van der Berg", text: "Hi." },
        { speaker: "Li Wei", text: "Hi." },
      ]),
      "Priya Shah",
      ["Acme", "acme", "", "Northwind"],
    );
    expect(r.forbidden.sort()).toEqual(
      ["Priya Shah", "Priya", "Shah", "Ines van der Berg", "Ines", "Berg", "Li Wei", "Wei", "Acme", "Northwind"].sort(),
    );
    for (const f of r.forbidden) {
      expect(f).not.toMatch(/^\[|^Buyer$|^Our side/);
    }
  });

  describe("review round 1", () => {
    it("splits speaker labels containing dots into name parts", () => {
      const r = redactCall(call([{ speaker: "Marcus Webb", text: "Priya said so, ask Shah" }]), "Priya.Shah", []);
      expect(r.lines[0].segments.map((s) => s.text).join("")).toBe("[NAME] said so, ask [NAME]");
      expect(r.forbidden).toEqual(expect.arrayContaining(["Priya.Shah", "Priya", "Shah"]));
    });

    it("treats straight, curly and modifier apostrophes in names as the same", () => {
      const r = redactCall(
        call([{ speaker: "Marcus Webb", text: "Ask O’Brien and Brien. Then oʼbrien's notes and O'Brien’s." }]),
        "Sean O'Brien",
        [],
      );
      expect(r.lines[0].segments.map((s) => s.text).join("")).toBe(
        "Ask [NAME] and [NAME]. Then [NAME] notes and [NAME].",
      );
      expect(r.forbidden).toEqual(expect.arrayContaining(["Sean O'Brien", "Sean", "Brien"]));
    });

    it("redacts amount ranges as one span", () => {
      const cases: [string, string][] = [
        ["It is $50-75/hr now.", "It is [AMOUNT] now."],
        ["It is £50-60 an hour now.", "It is [AMOUNT] now."],
        ["A 20-25% cut.", "A [AMOUNT] cut."],
        ["A cut between 10 and 15% maybe.", "A cut between [AMOUNT] maybe."],
        ["About 2-3k a month.", "About [AMOUNT]."],
        ["From $50 to 75 per hour.", "From [AMOUNT]."],
        ["Roughly £1,000–£1,500 total.", "Roughly [AMOUNT] total."],
      ];
      for (const [input, out] of cases) expect(one(input)).toBe(out);
      // Ranges with no currency, suffix or percent are left alone.
      expect(one("Pages 10-15 and between 3 and 4 people.")).toBe("Pages 10-15 and between 3 and 4 people.");
    });

    it("redacts letter-prefixed currency ranges", () => {
      expect(one("It is US$50-75/hr.")).toBe("It is [AMOUNT].");
      expect(one("Say HK$100 to 200 per day.")).toBe("Say [AMOUNT].");
      expect(one("Say AU$ 50-75 then.")).toBe("Say [AMOUNT] then.");
      expect(one("Say A$20-30k then.")).toBe("Say [AMOUNT] then.");
      expect(one("Just US$50 and CA$5.")).toBe("Just [AMOUNT] and [AMOUNT].");
      expect(one("Pages 10-15 and between 3 and 4 people.")).toBe("Pages 10-15 and between 3 and 4 people.");
    });

    it("matches a currency symbol after the number", () => {
      expect(one("It costs 300€, 300 € or 1 200 € or 1 200 €.")).toBe(
        "It costs [AMOUNT], [AMOUNT] or [AMOUNT] or [AMOUNT].",
      );
    });

    it("lets a longer term win over a speaker-name part inside it", () => {
      const r = redactCall(call([{ speaker: "Marcus Webb", text: "We use Webb Logistics daily." }]), BUYER, [
        "Webb Logistics",
      ]);
      expect(r.lines[0].segments).toEqual([
        { text: "We use " },
        { text: "[CLIENT]", change: "term" },
        { text: " daily." },
      ]);
      expect(r.suggestions).not.toContain("Logistics");
      expect(r.forbidden).toContain("Webb Logistics");
    });

    it("merges partly overlapping spans so no part survives", () => {
      expect(one("Marcus Webb Logistics called.", ["Webb Logistics"])).toBe("[CLIENT] called.");
    });

    it("matches currency codes and suffixes case-insensitively", () => {
      expect(one("It is usd 500 total, gbp 300, 3BN or 1.5mn and 2MM.")).toBe(
        "It is [AMOUNT] total, [AMOUNT], [AMOUNT] or [AMOUNT] and [AMOUNT].",
      );
    });

    it("normalises the counterpart before comparing with speaker labels", () => {
      const r = redactCall(call([{ speaker: "Zoë Park", text: "Hi." }]), " Zoë Park ", []);
      expect(r.lines[0].role).toBe("Buyer");
    });

    it("redacts long runs of ranges and trailing symbols quickly", () => {
      const unit = "$50-75/hr, 20-25% and 1 200 € or between 10 and 15k, ";
      // Whole units only, so no range is cut in half at the end.
      const text = unit.repeat(Math.floor(24_000 / unit.length));
      const digits = "1-".repeat(12_000);
      const spaced = "1 2".repeat(8_000);
      const prefixed = "US$1-".repeat(4_800);
      const start = performance.now();
      const r = redactCall(call([{ speaker: SELLER, text }]), BUYER, []);
      redactCall(call([{ speaker: SELLER, text: prefixed }]), BUYER, []);
      redactCall(call([{ speaker: SELLER, text: digits }]), BUYER, []);
      redactCall(call([{ speaker: SELLER, text: spaced }]), BUYER, []);
      expect(performance.now() - start).toBeLessThan(1000);
      expect(r.lines[0].segments.map((s) => s.text).join("")).not.toMatch(/\d/);
    });
  });

  it("redacts a 24,000-character line quickly", () => {
    const unit = "Priya said £1,200 to Acme at a@b.co, ok. ";
    const text = unit.repeat(Math.ceil(24_000 / unit.length)).slice(0, 24_000);
    const start = performance.now();
    const r = redactCall(call([{ speaker: SELLER, text }]), BUYER, ["Acme"]);
    expect(performance.now() - start).toBeLessThan(500);
    expect(r.text).not.toMatch(/Priya|Acme|1,200/);

    const flat = "a".repeat(24_000);
    const t2 = performance.now();
    redactCall(call([{ speaker: SELLER, text: flat }]), BUYER, ["Acme"]);
    const digits = "1".repeat(24_000);
    redactCall(call([{ speaker: SELLER, text: digits }]), BUYER, []);
    expect(performance.now() - t2).toBeLessThan(500);
  });
});
