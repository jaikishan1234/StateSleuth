import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildFixtureProposal } from "../lib/coding-proposal.ts";
import { sha256 } from "../lib/patch-apply.ts";
import { buildFixturePlan } from "../lib/planner.ts";
import {
  VerificationError,
  countFailedAssertions,
  isStoredVerification,
  loopbackBaseUrl,
  verdictFromAssertions,
  type VerificationAssertion,
  type VerificationResult,
} from "../lib/verification.ts";
import { evidencePath } from "../lib/verification-evidence.ts";
import type { JourneyOutcome, VerificationRunner } from "../lib/verification-browser.ts";
import { approveCode, createWorkflow, transition, type Workflow } from "../lib/workflow.ts";
import { createWorkflowStore } from "../lib/workflow-store.ts";
import {
  approveWorkflowPlan,
  requestCodeProposal,
  runWorkflowVerification,
  startWorkflow,
} from "../lib/workflow-service.ts";

const LOCAL_ORIGIN = "http://127.0.0.1:3000";
const FEATURE = "Add due dates to tasks and highlight the ones that are overdue";

/** A minimal lib/tasks.ts; the real file is never used by these tests. */
const TASKS_TEMPLATE = [
  "export type Task = {",
  "  id: string;",
  "  title: string;",
  "  completed: boolean;",
  "  createdAt: number;",
  "  updatedAt: number;",
  "};",
  "",
].join("\n");

function assertion(
  id: string,
  passed: boolean,
  overrides: Partial<VerificationAssertion> = {},
): VerificationAssertion {
  return {
    id,
    label: `Check ${id}`,
    expected: `expected ${id}`,
    observed: `observed ${id}`,
    passed,
    ...overrides,
  };
}

function passingJourney(): JourneyOutcome {
  return {
    expected: "the rename keeps the task complete",
    observed: "Every check matched (2 of 2).",
    assertions: [assertion("board-ready", true), assertion("rename-keeps-completion", true)],
    url: `${LOCAL_ORIGIN}/demo`,
    durationMs: 1_200,
    screenshot: "verify_stub.png",
  };
}

function failingJourney(): JourneyOutcome {
  return {
    expected: "the rename keeps the task complete",
    observed: "1 of 2 checks did not match: rename-keeps-completion.",
    assertions: [
      assertion("board-ready", true),
      assertion("rename-keeps-completion", false, { observed: "the checkbox is unchecked" }),
    ],
    url: `${LOCAL_ORIGIN}/demo`,
    durationMs: 900,
    screenshot: "verify_stub.png",
  };
}

function runnerReturning(outcome: JourneyOutcome): VerificationRunner {
  return async () => outcome;
}

async function withWorkspace<T>(
  run: (workspace: {
    root: string;
    store: ReturnType<typeof createWorkflowStore>;
    evidenceDir: string;
  }) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), "statesleuth-verify-"));
  try {
    await mkdir(path.join(root, "lib"), { recursive: true });
    await writeFile(path.join(root, "lib", "tasks.ts"), TASKS_TEMPLATE, "utf8");
    return await run({
      root,
      store: createWorkflowStore(path.join(root, "workflows")),
      evidenceDir: path.join(root, "evidence"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Drives the service to the state a verification run may start from. */
async function workflowAwaitingCodeApproval(
  workspace: { root: string; store: ReturnType<typeof createWorkflowStore> },
): Promise<string> {
  const created = await startWorkflow({ feature: FEATURE, store: workspace.store, now: 1_000, fixture: true });
  if (!created.ok) throw new Error(created.error);
  const id = created.value.id;

  const approved = await approveWorkflowPlan({ id, store: workspace.store, now: 1_001 });
  if (!approved.ok) throw new Error(approved.error);

  const proposed = await requestCodeProposal({
    id,
    store: workspace.store,
    now: 1_002,
    useFixture: true,
    projectRoot: workspace.root,
  });
  if (!proposed.ok) throw new Error(proposed.error);

  assert.equal(proposed.value.status, "awaiting_code_approval");
  return id;
}

/** A pending workflow built purely through the domain, with no storage. */
function pendingWorkflow(): Workflow {
  const created = createWorkflow({ id: "wf_domain", featureRequest: FEATURE, now: 1 });
  if (!created.ok) throw new Error("setup: create");
  const planned = transition(created.value, "awaiting_plan_approval", {
    actor: "planning_agent",
    at: 2,
    plan: { id: "plan_1", mode: "fixture", generatedAt: 2, plan: buildFixturePlan(FEATURE) },
  });
  if (!planned.ok) throw new Error("setup: plan");
  const coding = transition(planned.value, "coding", { actor: "human", at: 3 });
  if (!coding.ok) throw new Error("setup: coding");
  const proposed = transition(coding.value, "awaiting_code_approval", {
    actor: "coding_agent",
    at: 4,
    proposal: buildFixtureProposal({ id: "prop_1", createdAt: 4, featureRequest: FEATURE }),
  });
  if (!proposed.ok) throw new Error("setup: proposal");
  return proposed.value;
}

/** The state a verdict is recorded from, once code approval started. */
function verifyingWorkflow(): Workflow {
  const verifying = approveCode(pendingWorkflow(), { at: 5 });
  if (!verifying.ok) throw new Error("setup: verifying");
  return verifying.value;
}

function verificationResult(verdict: "passed" | "failed"): VerificationResult {
  return {
    verdict,
    expected: "expected",
    observed: "observed",
    steps: [assertion("a", verdict === "passed"), assertion("b", verdict === "passed")],
    url: `${LOCAL_ORIGIN}/demo`,
    checkedAt: 10,
    durationMs: 100,
  };
}

describe("verdict rule", () => {
  it("fails a run with no checks", () => {
    assert.equal(verdictFromAssertions([]), "failed");
  });

  it("passes only when every check passed", () => {
    assert.equal(verdictFromAssertions([assertion("a", true), assertion("b", true)]), "passed");
    assert.equal(verdictFromAssertions([assertion("a", true), assertion("b", false)]), "failed");
    assert.equal(verdictFromAssertions([assertion("a", false)]), "failed");
  });

  it("counts the failing checks", () => {
    assert.equal(countFailedAssertions([assertion("a", true), assertion("b", false)]), 1);
    assert.equal(countFailedAssertions([]), 0);
  });
});

describe("loopback-only base URL", () => {
  it("accepts loopback origins and discards any path", () => {
    assert.equal(loopbackBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
    assert.equal(loopbackBaseUrl("http://localhost:3100"), "http://localhost:3100");
    assert.equal(
      loopbackBaseUrl("https://127.0.0.1/anything?x=1#frag"),
      "https://127.0.0.1",
    );
  });

  it("refuses a non-loopback host", () => {
    assert.throws(
      () => loopbackBaseUrl("https://example.com"),
      (error: unknown) => error instanceof VerificationError && error.code === "not_local",
    );
  });

  it("refuses a scheme other than http or https", () => {
    assert.throws(
      () => loopbackBaseUrl("file:///etc/passwd"),
      (error: unknown) => error instanceof VerificationError && error.code === "invalid_url",
    );
  });

  it("refuses a value that is not a URL", () => {
    assert.throws(
      () => loopbackBaseUrl("not a url"),
      (error: unknown) => error instanceof VerificationError && error.code === "invalid_url",
    );
  });
});

describe("stored verification validation", () => {
  it("accepts a well-formed result", () => {
    assert.equal(isStoredVerification(verificationResult("failed")), true);
    assert.equal(isStoredVerification(verificationResult("passed")), true);
  });

  it("refuses a pass whose own steps did not all pass", () => {
    const tampered = {
      ...verificationResult("passed"),
      steps: [assertion("a", true), assertion("b", false)],
    };
    assert.equal(isStoredVerification(tampered), false);
  });

  it("refuses a result with no steps or an unknown verdict", () => {
    assert.equal(isStoredVerification({ ...verificationResult("failed"), steps: [] }), false);
    assert.equal(isStoredVerification({ ...verificationResult("failed"), verdict: "maybe" }), false);
  });

  it("refuses an evidence name that is not a plain png", () => {
    assert.equal(
      isStoredVerification({ ...verificationResult("failed"), screenshot: "../../secrets.png" }),
      false,
    );
    assert.equal(
      isStoredVerification({ ...verificationResult("failed"), screenshot: "verify_1.png" }),
      true,
    );
  });
});

describe("evidence paths stay inside the evidence directory", () => {
  it("accepts a generated file name", () => {
    assert.equal(typeof evidencePath("verify_abc-123.png"), "string");
  });

  it("refuses traversal and other file types", () => {
    assert.equal(evidencePath("../workflows/wf_1.json"), null);
    assert.equal(evidencePath("sub/dir.png"), null);
    assert.equal(evidencePath("verify.png.exe"), null);
    assert.equal(evidencePath(42), null);
  });
});

describe("workflow verdict transitions", () => {
  it("leaves a pass with no verdict exactly as it was before this feature", () => {
    const result = transition(verifyingWorkflow(), "passed", {
      actor: "verification_agent",
      at: 6,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "passed");
    assert.equal(result.value.verification, undefined);
  });

  it("refuses a pass when the supplied verdict did not pass", () => {
    const result = transition(verifyingWorkflow(), "passed", {
      actor: "verification_agent",
      at: 6,
      verification: verificationResult("failed"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "verification_required");
  });

  it("refuses a pass whose verdict claims a pass over a failing check", () => {
    const tampered = {
      ...verificationResult("passed"),
      steps: [assertion("a", true), assertion("b", false)],
    };
    const result = transition(verifyingWorkflow(), "passed", {
      actor: "verification_agent",
      at: 6,
      verification: tampered,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    // The shape validator refuses the value before the target rule is reached.
    assert.equal(result.failure.code, "verification_invalid");
  });

  it("records a pass when every check passed", () => {
    const result = transition(verifyingWorkflow(), "passed", {
      actor: "verification_agent",
      at: 6,
      verification: verificationResult("passed"),
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "passed");
    assert.equal(result.value.verification?.verdict, "passed");
    assert.equal(result.value.history.at(-1)?.actor, "verification_agent");
  });

  it("records a failed verdict with the failure code", () => {
    const result = transition(verifyingWorkflow(), "failed", {
      actor: "verification_agent",
      at: 6,
      verification: verificationResult("failed"),
      failure: { code: "verification_failed", message: "One check did not match.", at: 6 },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "failed");
    assert.equal(result.value.verification?.verdict, "failed");
    assert.equal(result.value.failure?.code, "verification_failed");
  });

  it("refuses a verification result on any other target", () => {
    const result = transition(pendingWorkflow(), "verifying", {
      actor: "verification_agent",
      at: 5,
      verification: verificationResult("passed"),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "verification_not_permitted");
  });

  it("refuses a malformed verification result", () => {
    const result = transition(verifyingWorkflow(), "failed", {
      actor: "verification_agent",
      at: 6,
      verification: { verdict: "failed" } as unknown as VerificationResult,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "verification_invalid");
  });
});

describe("verification service", () => {
  it("records a failed verdict with evidence and never applies the proposal", async () => {
    await withWorkspace(async (workspace) => {
      const id = await workflowAwaitingCodeApproval(workspace);
      const before = await workspace.store.get(id);
      const realTasks = await readFile(path.join(process.cwd(), "lib", "tasks.ts"), "utf8");

      const result = await runWorkflowVerification({
        id,
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: runnerReturning(failingJourney()),
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.status, "failed");
      assert.equal(result.value.verification?.verdict, "failed");
      assert.equal(result.value.verification?.steps.length, 2);
      assert.equal(result.value.verification?.screenshot, "verify_stub.png");
      assert.equal(result.value.verification?.url, `${LOCAL_ORIGIN}/demo`);
      assert.equal(result.value.failure?.code, "verification_failed");

      // The workflow moved verification_agent -> verifying -> failed, and the
      // proposal it was holding is untouched: no approval happened here.
      assert.deepEqual(
        result.value.history.slice(-2).map((entry) => [entry.from, entry.to, entry.actor]),
        [
          ["awaiting_code_approval", "verifying", "verification_agent"],
          ["verifying", "failed", "verification_agent"],
        ],
      );
      assert.equal(result.value.proposal?.id, before?.proposal?.id);
      assert.equal(result.value.plan?.id, before?.plan?.id);

      // The planted-bug file is never written by a verification run.
      assert.equal(
        sha256(await readFile(path.join(process.cwd(), "lib", "tasks.ts"), "utf8")),
        sha256(realTasks),
      );
      assert.equal(
        sha256(await readFile(path.join(workspace.root, "lib", "tasks.ts"), "utf8")),
        sha256(TASKS_TEMPLATE),
      );
    });
  });

  it("records a pass only from a fully passing journey", async () => {
    await withWorkspace(async (workspace) => {
      const id = await workflowAwaitingCodeApproval(workspace);
      const result = await runWorkflowVerification({
        id,
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: runnerReturning(passingJourney()),
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.status, "passed");
      assert.equal(result.value.verification?.verdict, "passed");
    });
  });

  it("runs from an already verifying workflow", async () => {
    await withWorkspace(async (workspace) => {
      const id = await workflowAwaitingCodeApproval(workspace);
      const stored = await workspace.store.get(id);
      if (!stored) throw new Error("setup: stored workflow");
      const verifying = approveCode(stored, { at: 1_500 });
      if (!verifying.ok) throw new Error("setup: verifying");
      await workspace.store.save(verifying.value);

      const result = await runWorkflowVerification({
        id,
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: runnerReturning(failingJourney()),
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.status, "failed");
      assert.equal(
        result.value.history.at(-2)?.to,
        "verifying",
        "no extra verifying hop is added",
      );
    });
  });

  it("refuses a workflow that is not awaiting code approval", async () => {
    await withWorkspace(async (workspace) => {
      const created = await startWorkflow({
        feature: FEATURE,
        store: workspace.store,
        now: 1_000,
        fixture: true,
      });
      if (!created.ok) throw new Error(created.error);

      const result = await runWorkflowVerification({
        id: created.value.id,
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: runnerReturning(passingJourney()),
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 409);
      assert.equal((await workspace.store.get(created.value.id))?.status, "awaiting_plan_approval");
    });
  });

  it("records no verdict when the browser cannot run", async () => {
    await withWorkspace(async (workspace) => {
      const id = await workflowAwaitingCodeApproval(workspace);
      const result = await runWorkflowVerification({
        id,
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: async () => {
          throw new VerificationError("browser_unavailable", "The verification browser could not be started.");
        },
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 502);
      const stored = await workspace.store.get(id);
      assert.equal(stored?.status, "awaiting_code_approval");
      assert.equal(stored?.verification, undefined);
    });
  });

  it("refuses a non-loopback origin before running anything", async () => {
    await withWorkspace(async (workspace) => {
      const id = await workflowAwaitingCodeApproval(workspace);
      let called = false;
      const result = await runWorkflowVerification({
        id,
        baseUrl: "https://example.com",
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: async (options) => {
          called = true;
          assert.equal(options.baseUrl, LOCAL_ORIGIN);
          return passingJourney();
        },
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 400);
      assert.equal(called, false, "the runner is never reached");
      assert.equal((await workspace.store.get(id))?.status, "awaiting_code_approval");
    });
  });

  it("records no verdict when the journey observed nothing", async () => {
    await withWorkspace(async (workspace) => {
      const id = await workflowAwaitingCodeApproval(workspace);
      const result = await runWorkflowVerification({
        id,
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: runnerReturning({ ...passingJourney(), assertions: [] }),
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 502);
      assert.equal((await workspace.store.get(id))?.status, "awaiting_code_approval");
    });
  });

  it("reports a missing workflow as 404", async () => {
    await withWorkspace(async (workspace) => {
      const result = await runWorkflowVerification({
        id: "wf_missing",
        baseUrl: LOCAL_ORIGIN,
        store: workspace.store,
        now: 2_000,
        evidenceDir: workspace.evidenceDir,
        runner: runnerReturning(passingJourney()),
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.status, 404);
    });
  });
});