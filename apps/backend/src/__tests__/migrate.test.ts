import { describe, expect, it } from "vitest";
import { redactMigrationOutput } from "../migrate";

describe("redactMigrationOutput", () => {
  it("replaces a credential URL's literal value and any user:pass@ segment", () => {
    const url = "postgresql://admin:hunter2@db.internal:5432/app";
    const text = [
      `Error: P1001: Can't reach database server at ${url}`,
      "also seen: mysql://root:s3cret@10.0.0.1/x and https://user@host/path",
    ].join("\n");
    const out = redactMigrationOutput(text, url);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("admin");
    expect(out).not.toContain("s3cret");
    expect(out).not.toContain("root");
    expect(out).toContain("<DATABASE_URL>");
    expect(out).toContain("mysql://***@10.0.0.1/x");
    expect(out).toContain("https://***@host/path");
  });

  it("redacts a credential segment even when DATABASE_URL differs from the printed URL", () => {
    const out = redactMigrationOutput("at postgres://u:p4ss@h/db", "file:./local.db");
    expect(out).toBe("at postgres://***@h/db");
  });

  it("replaces a file: DATABASE_URL", () => {
    const url = "file:/srv/private/interviews.db";
    const text = `Datasource "db": SQLite database "interviews.db" at "${url}"\nError: P3009 failed`;
    const out = redactMigrationOutput(text, url);
    expect(out).not.toContain("/srv/private");
    expect(out).toContain('at "<DATABASE_URL>"');
    expect(out).toContain("Error: P3009 failed");
  });

  it("keeps only the last 10 non-empty lines", () => {
    const text = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join("\n") + "\n\n";
    const out = redactMigrationOutput(text, "file:./x.db");
    expect(out.split("\n")).toEqual(Array.from({ length: 10 }, (_, i) => `line ${i + 16}`));
  });

  it("handles empty output and an empty DATABASE_URL", () => {
    expect(redactMigrationOutput("", "")).toBe("");
    expect(redactMigrationOutput("plain failure", "")).toBe("plain failure");
  });
});
