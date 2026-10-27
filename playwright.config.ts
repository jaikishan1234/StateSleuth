import os from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for the StateSleuth verification journey.
 *
 * The journey runs against a throwaway production server on 127.0.0.1, with its
 * own workflow and evidence directories, so a test run can never touch the
 * project's own `.data/workflows` records. System Chrome is used through
 * `channel`, so no Playwright browser download is needed.
 *
 * A production server (rather than `next dev`) is used on purpose: Next refuses
 * to start a second dev server for the same project while one is already
 * running, and the built output is the more meaningful target anyway.
 */
const PORT = 3177;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export const TEST_WORKFLOW_DIR = path.join(os.tmpdir(), "statesleuth-playwright-workflows");
export const TEST_EVIDENCE_DIR = path.join(os.tmpdir(), "statesleuth-playwright-evidence");

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command: `npm run build && npm run start:local -- --port ${PORT}`,
    url: `${BASE_URL}/demo`,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      STATESLEUTH_WORKFLOW_DIR: TEST_WORKFLOW_DIR,
      STATESLEUTH_EVIDENCE_DIR: TEST_EVIDENCE_DIR,
    },
  },
});