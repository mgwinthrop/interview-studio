import { describe, expect, it } from "vitest";
import { setupServerTestEnv } from "./helpers/server";

const env = setupServerTestEnv();

// Read at module level, before beforeAll has run.
let earlyRead: unknown;
try {
  void env.prisma;
} catch (err) {
  earlyRead = err;
}

describe("server test env", () => {
  it("throws when a handle is read before beforeAll", () => {
    expect(earlyRead).toBeInstanceOf(Error);
    expect((earlyRead as Error).message).toContain("server test env used before beforeAll");
  });

  it("refuses a second setup in the same file", () => {
    expect(() => setupServerTestEnv()).toThrow("setupServerTestEnv() called twice");
  });

  it("gives every handle once the hooks have run", () => {
    expect(env.prisma).toBeDefined();
    expect(env.store).toBeDefined();
    expect(env.persistence).toBeDefined();
    expect(env.registry).toBeDefined();
    expect(env.appMod.createApp).toBeTypeOf("function");
    expect(env.dbUrl).toMatch(/^file:/);
  });
});
