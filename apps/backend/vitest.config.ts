import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude integration tests from the regular unit-test run.
    // Run integration tests separately: npm run test:integration
    // (requires a running backend server and real API keys)
    exclude: ["**/node_modules/**", "**/integration/**"],
  },
});
