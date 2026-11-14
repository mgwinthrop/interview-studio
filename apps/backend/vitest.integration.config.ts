import { defineConfig } from "vitest/config";

// Opt-in run of the real-provider test: npm run test:integration.
// The default config (vitest.config.ts) excludes this folder from `npm test`.
export default defineConfig({
  test: {
    include: ["src/__tests__/integration/**/*.test.ts"],
    // A real session with real providers and an LLM judge is slow.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
