import { defineConfig } from "vitest/config";

// Unit tests for the pure logic under app/ (parsers, validators, chart maths). Tests that touch
// sessionStorage opt into jsdom with a `// @vitest-environment jsdom` comment. Browser tests live
// in e2e/ and run with Playwright (`npm run test:e2e`).
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
