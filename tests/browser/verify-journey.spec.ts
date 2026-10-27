import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { APIRequestContext } from "@playwright/test";
import { runDemoJourney } from "../../lib/verification-browser.ts";
import { verdictFromAssertions } from "../../lib/verification.ts";

/**
 * Genuine browser journeys, run in the installed system Chrome.
 *
 * These are the end-to-end proof: a real browser drives the real demo board,
 * and the planted rename/completion defect must produce a failed verdict. A
 * passing verdict here would mean the verifier is broken.
 */

/** Kept out of the project's `.data` so a test run leaves no evidence behind. */
const EVIDENCE_DIR = path.join(os.tmpdir(), "statesleuth-playwright-evidence");

/** Checks the demo board must satisfy before the defect is reachable. */
const PASSING_STEPS = ["board-ready", "task-created", "marked-complete", "renamed"];
/** Checks the planted defect must break. */
const DEFECT_STEPS = ["rename-keeps-completion", "rename-keeps-counter", "completion-persists"];

test("the runner records a genuine failed verdict for the planted defect", async ({ baseURL }) => {
  const outcome = await runDemoJourney({
    baseUrl: baseURL ?? "http://127.0.0.1:3100",
    runId: `verify_pw_${Date.now()}`,
    evidenceDir: EVIDENCE_DIR,
  });

  const byId = new Map(outcome.assertions.map((step) => [step.id, step]));

  for (const id of PASSING_STEPS) {
    const step = byId.get(id);
    expect(step, `expected the journey to record "${id}"`).toBeDefined();
    expect(step?.passed, `"${id}" should pass: ${step?.observed}`).toBe(true);
  }

  for (const id of DEFECT_STEPS) {
    const step = byId.get(id);
    expect(step, `expected the journey to record "${id}"`).toBeDefined();
    expect(step?.passed, `"${id}" should fail against the planted defect`).toBe(false);
  }

  expect(verdictFromAssertions(outcome.assertions)).toBe("failed");

  // Evidence must be a real file on disk, not just a name.
  expect(outcome.screenshot).toBeTruthy();
  const evidence = await stat(path.join(EVIDENCE_DIR, outcome.screenshot ?? ""));
  expect(evidence.size).toBeGreaterThan(1_000);
});

/** Creates a workflow and drives it to the state a verdict is recorded from. */
async function pendingWorkflow(request: APIRequestContext): Promise<string> {
  const created = await request.post("/api/workflows", {
    data: { feature: "Add due dates to tasks and highlight the overdue ones", fixture: true },
  });
  expect(created.status()).toBe(201);
  const workflowId = (await created.json()).workflow.id as string;

  expect((await request.post(`/api/workflows/${workflowId}/approve`, { data: {} })).status()).toBe(200);
  expect(
    (await request.post(`/api/workflows/${workflowId}/proposal`, { data: { fixture: true } })).status(),
  ).toBe(200);

  return workflowId;
}

test("the verify endpoint records the verdict through the workflow API", async ({ request }) => {
  const workflowId = await pendingWorkflow(request);

  const verified = await request.post(`/api/workflows/${workflowId}/verify`, { data: {} });
  expect(verified.status()).toBe(200);

  const workflow = (await verified.json()).workflow;
  expect(workflow.status).toBe("failed");
  expect(workflow.verification.verdict).toBe("failed");
  expect(workflow.failure.code).toBe("verification_failed");
  expect(workflow.verification.steps.filter((step: { passed: boolean }) => !step.passed)).toHaveLength(
    3,
  );
  expect(
    workflow.verification.steps
      .filter((step: { passed: boolean }) => !step.passed)
      .map((step: { id: string }) => step.id),
  ).toEqual(expect.arrayContaining(DEFECT_STEPS));

  // The evidence route serves the recorded screenshot.
  const shot = await request.get(`/api/workflows/${workflowId}/evidence`);
  expect(shot.status()).toBe(200);
  expect(shot.headers()["content-type"]).toBe("image/png");
  expect((await shot.body()).byteLength).toBeGreaterThan(1_000);

  // The workflow is terminal, and code approval was never granted.
  expect((await request.post(`/api/workflows/${workflowId}/verify`, { data: {} })).status()).toBe(409);
  expect(
    (await request.post(`/api/workflows/${workflowId}/code/approve`, { data: { confirm: true } })).status(),
  ).not.toBe(200);
});

test("verification is local-only", async ({ request }) => {
  const crossOrigin = await request.post("/api/workflows/wf_missing/verify", {
    headers: { origin: "https://example.com" },
    data: {},
  });
  expect(crossOrigin.status()).toBe(403);
  expect((await crossOrigin.json()).localOnly).toBe(true);

  const evidence = await request.get("/api/workflows/wf_missing/evidence", {
    headers: { origin: "https://example.com" },
  });
  expect(evidence.status()).toBe(403);

  // An unknown workflow is a 404, and no record is created by the attempt.
  expect((await request.post("/api/workflows/wf_missing/verify", { data: {} })).status()).toBe(404);
});

test("the review UI renders the verdict and the evidence screenshot", async ({ page, request }) => {
  const workflowId = await pendingWorkflow(request);
  expect((await request.post(`/api/workflows/${workflowId}/verify`, { data: {} })).status()).toBe(200);

  await page.goto("/workflow");

  // Open the workflow that was just verified (the stored list is newest first).
  const open = page.getByRole("button", { name: "Open" }).first();
  await expect(open).toBeVisible();
  await open.click();

  await expect(page.getByText("Verification verdict")).toBeVisible();
  await expect(page.getByText(/Verification steps/)).toBeVisible();
  await expect(page.getByText("Expected", { exact: true })).toBeVisible();
  await expect(page.getByText("Observed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Renaming a completed task keeps it complete", { exact: true }),
  ).toBeVisible();

  // The evidence image must actually load: a real PNG served by a real route.
  const shot = page.getByRole("img", { name: "Browser screenshot captured by the verification run" });
  await expect(shot).toBeVisible();
  await expect
    .poll(async () => shot.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
});