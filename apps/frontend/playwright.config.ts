import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Browser smoke tests against the real app in mock mode: no API keys, no microphone hardware.
// Playwright starts the mock backend (on a throwaway database) and a production build of the
// frontend itself, so `npm run test:e2e` works from a fresh clone after `npm ci` and
// `npx playwright install chromium`. Ports 3000 and 3001 must be free.
const dbFile = path.join(os.tmpdir(), "interview-studio-e2e.db");
// Playwright loads this file again inside every test worker, so clean up only in the main process;
// a worker deleting the file would pull the database out from under the running backend.
if (process.env.TEST_WORKER_INDEX === undefined) {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
}

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    permissions: ["microphone"],
    launchOptions: {
      // A fake microphone so the browser grants one without hardware or a prompt.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "npx tsx src/index.ts",
      cwd: "../backend",
      url: "http://127.0.0.1:3001/api/features",
      env: { PROFILE: "mock", DATABASE_URL: `file:${dbFile}`, HOST: "127.0.0.1", PORT: "3001" },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run build && npm run start",
      url: "http://localhost:3000/avatar",
      // The e2e build compiles in the test seams (app/session/testSeams.ts) and writes to its own
      // .next-e2e, so it never replaces the normal build in .next (FQ-108 S0).
      env: { NEXT_PUBLIC_WS_URL: "ws://localhost:3001", NEXT_PUBLIC_TEST_SEAMS: "1", NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
