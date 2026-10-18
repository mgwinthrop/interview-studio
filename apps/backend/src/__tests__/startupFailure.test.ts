import { describe, expect, it } from "vitest";
import { describeStartupFailure, UPGRADE_HINT } from "../startupFailure";

describe("describeStartupFailure", () => {
  it("prints the class and the upgrade hint for other errors, never the message", () => {
    const lines = describeStartupFailure(new TypeError("/Users/x/secret.db broke"), false);
    expect(lines).toEqual(["Preset sync failed: TypeError", UPGRADE_HINT]);
    expect(lines.join("\n")).not.toContain("secret");
    expect(UPGRADE_HINT).toBe('If you just upgraded, run "npx prisma generate" in apps/backend and start again.');
  });

  it("handles non-Error throws by type", () => {
    expect(describeStartupFailure("boom", false)).toEqual(["Preset sync failed: string", UPGRADE_HINT]);
  });

  it("keeps the validation message and adds no hint", () => {
    const err = new Error("preset x: phases is required");
    err.name = "PresetValidationError";
    expect(describeStartupFailure(err, true)).toEqual([
      "Preset sync failed: PresetValidationError: preset x: phases is required",
    ]);
  });
});
