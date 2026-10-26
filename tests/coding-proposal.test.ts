import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  BLOCKED_SEGMENTS,
  PERMITTED_SOURCE_FILES,
  checkRelativePath,
  isPermittedSourceFile,
} from "../lib/coding-paths.ts";
import {
  FIXTURE_NOTICE,
  buildFixtureProposal,
  diffHeaderPaths,
  isStoredProposal,
  looksLikeUnifiedDiff,
  validateProposal,
} from "../lib/coding-proposal.ts";
import { createWorkflowStore } from "../lib/workflow-store.ts";
import {
  approveWorkflowPlan,
  requestCodeProposal,
  startWorkflow,
} from "../lib/workflow-service.ts";
import { approvePlan, createWorkflow, transition } from "../lib/workflow.ts";

async function withTempStore<T>(
  run: (store: ReturnType<typeof createWorkflowStore>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "statesleuth-proposal-"));
  const store = createWorkflowStore(dir);
  try {
    return await run(store);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function samplePlan() {
  return {
    featureSummary: { title: "Due dates", description: "Tasks can carry a due date." },
    implementationSteps: [{ title: "Store the date", detail: "Add a field." }],
    acceptanceCriteria: ["A task can carry a due date."],
    browserVerificationSteps: ["Open the demo."],
    expectedResults: ["The date survives a reload."],
    edgeCases: ["A date in the past."],
  };
}

/** A workflow sitting in the `coding` state, as approval would leave it. */
function codingWorkflow() {
  const created = createWorkflow({
    id: "wf_coding",
    featureRequest: "Add due dates to tasks and highlight the overdue ones.",
    now: 1_000,
  });
  if (!created.ok) throw new Error("setup failed");

  const planned = transition(created.value, "awaiting_plan_approval", {
    actor: "planning_agent",
    at: 2_000,
    plan: {
      id: "plan_1",
      mode: "demo" as const,
      generatedAt: 2_000,
      plan: samplePlan(),
    },
  });
  if (!planned.ok) throw new Error("setup failed");

  const coding = approvePlan(planned.value, { at: 3_000 });
  if (!coding.ok) throw new Error("setup failed");
  return coding.value;
}

describe("path restrictions", () => {
  it("accepts a permitted source file", () => {
    const check = checkRelativePath("lib/tasks.ts");
    assert.equal(check.ok, true);
    assert.equal(isPermittedSourceFile("lib/tasks.ts"), true);
  });

  it("rejects environment files", () => {
    for (const candidate of [".env", ".env.local", ".env.production", "config/.env.local"]) {
      const check = checkRelativePath(candidate);
      assert.equal(check.ok, false, `${candidate} should be rejected`);
      if (!check.ok) assert.equal(check.reason, "blocked_file");
    }
  });

  it("rejects version control, dependencies and build output", () => {
    const cases = [
      ".git/config",
      ".git/hooks/pre-commit",
      "node_modules/next/package.json",
      ".next/server/app/page.js",
      "out/index.html",
      "build/main.js",
      "dist/bundle.js",
      "coverage/lcov.info",
      ".data/workflows/wf_1.json",
    ];
    for (const candidate of cases) {
      const check = checkRelativePath(candidate);
      assert.equal(check.ok, false, `${candidate} should be rejected`);
      if (!check.ok) assert.equal(check.reason, "blocked_segment");
    }
  });

  it("rejects paths that leave the project root", () => {
    for (const candidate of ["../secrets.txt", "lib/../../etc/passwd", "/etc/passwd", "C:/Windows/system32"]) {
      const check = checkRelativePath(candidate);
      assert.equal(check.ok, false, `${candidate} should be rejected`);
    }
  });

  it("rejects backslashes, empty paths and non-strings", () => {
    assert.equal(checkRelativePath("lib\\tasks.ts").ok, false);
    assert.equal(checkRelativePath("").ok, false);
    assert.equal(checkRelativePath("   ").ok, false);
    assert.equal(checkRelativePath(42).ok, false);
    assert.equal(checkRelativePath(null).ok, false);
    assert.equal(checkRelativePath("../x\0y").ok, false);
  });

  it("rejects a safe but unlisted file", () => {
    const check = checkRelativePath("some/other/file.ts");
    assert.equal(check.ok, true, "the path itself is safe");
    assert.equal(isPermittedSourceFile("some/other/file.ts"), false);
  });

  it("never lists a sensitive path in the allowlist", () => {
    for (const allowed of PERMITTED_SOURCE_FILES) {
      assert.equal(isPermittedSourceFile(allowed), true, `${allowed} should be permitted`);
      assert.ok(!allowed.includes("node_modules"));
      assert.ok(!allowed.includes(".env"));
      assert.ok(!allowed.startsWith(".git"));
    }
  });

  it("keeps the blocked segment list explicit", () => {
    for (const segment of [".git", "node_modules", ".next", "build", "out", "dist"]) {
      assert.ok(BLOCKED_SEGMENTS.has(segment), `${segment} should be blocked`);
    }
  });
});

describe("proposal validation", () => {
  const good = {
    explanation: "Add a due date field and render it in the row.",
    files: [{ path: "lib/tasks.ts", change: "modify", summary: "Add the field." }],
    diff: "--- a/lib/tasks.ts\n+++ b/lib/tasks.ts\n@@ -1,2 +1,3 @@\n+  dueDate?: string;\n",
  };

  it("accepts a well formed proposal", () => {
    const result = validateProposal(good, {
      source: "live",
      model: "test-model",
      id: "prop_1",
      createdAt: 1,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.proposal.source, "live");
    assert.equal(result.proposal.model, "test-model");
    assert.equal(result.proposal.files.length, 1);
    assert.equal(result.proposal.files[0]?.path, "lib/tasks.ts");
  });

  it("rejects a proposal that touches a blocked path", () => {
    const result = validateProposal(
      {
        ...good,
        files: [{ path: ".env.local", change: "modify", summary: "Add the key." }],
      },
      { source: "live", id: "prop_2", createdAt: 1 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.issues.join(" "), /not a safe path/);
  });

  it("rejects a proposal whose diff smuggles in a blocked path", () => {
    const result = validateProposal(
      {
        ...good,
        files: [{ path: "lib/tasks.ts", change: "modify", summary: "Add the field." }],
        diff: "--- a/.env.local\n+++ b/.env.local\n@@ -1,1 +1,2 @@\n+SECRET=1\n",
      },
      { source: "live", id: "prop_3", createdAt: 1 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.issues.join(" "), /diff references/);
  });

  it("rejects a diff that is not a unified diff", () => {
    const result = validateProposal(
      { ...good, diff: "just some prose about the change" },
      { source: "live", id: "prop_4", createdAt: 1 },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.issues.join(" "), /unified diff/);
  });

  it("rejects a missing explanation, empty file list and non-object input", () => {
    const noExplanation = validateProposal(
      { ...good, explanation: "" },
      { source: "live", id: "prop_5", createdAt: 1 },
    );
    assert.equal(noExplanation.ok, false);

    const noFiles = validateProposal(
      { ...good, files: [] },
      { source: "live", id: "prop_6", createdAt: 1 },
    );
    assert.equal(noFiles.ok, false);

    const notObject = validateProposal("nope", {
      source: "live",
      id: "prop_7",
      createdAt: 1,
    });
    assert.equal(notObject.ok, false);
  });

  it("extracts diff header paths and detects unified diffs", () => {
    assert.deepEqual(
      diffHeaderPaths("--- a/lib/tasks.ts\n+++ b/lib/tasks.ts\n@@ -1 +1 @@\n"),
      ["lib/tasks.ts"],
    );
    assert.equal(looksLikeUnifiedDiff("--- a/x\n+++ b/x\n@@ -1 +1 @@\n"), true);
    assert.equal(looksLikeUnifiedDiff("nope"), false);
  });
});

describe("fixture labelling", () => {
  it("is labelled as a fixture and never claims to be a model result", () => {
    const proposal = buildFixtureProposal({
      id: "prop_fixture",
      createdAt: 1_000,
      featureRequest: "Add due dates to tasks",
    });

    assert.equal(proposal.source, "fixture");
    assert.equal(proposal.model, undefined, "a fixture must not name a model");
    assert.equal(proposal.notice, FIXTURE_NOTICE);
    assert.match(proposal.notice, /not by an AI model/i);
    assert.match(proposal.explanation, /not produced by a model/i);
  });

  it("is deterministic", () => {
    const options = {
      id: "prop_fixture",
      createdAt: 1_000,
      featureRequest: "Add due dates to tasks",
    };
    assert.deepEqual(buildFixtureProposal(options), buildFixtureProposal(options));
  });

  it("only touches permitted files", () => {
    const proposal = buildFixtureProposal({
      id: "prop_fixture",
      createdAt: 1_000,
      featureRequest: "Add due dates to tasks",
    });
    for (const file of proposal.files) {
      assert.equal(isPermittedSourceFile(file.path), true);
    }
    for (const path_ of diffHeaderPaths(proposal.diff)) {
      assert.equal(isPermittedSourceFile(path_), true);
    }
  });
});

describe("proposal generation", () => {
  it("produces a proposal for a workflow in the coding state and stores it", async () => {
    await withTempStore(async (store) => {
      const workflow = codingWorkflow();
      await store.save(workflow);

      const result = await requestCodeProposal({
        id: workflow.id,
        store,
        useFixture: true,
        now: 4_000,
      });

      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.status, "awaiting_code_approval");
      assert.ok(result.value.proposal, "the proposal should be attached");
      assert.equal(result.value.proposal?.source, "fixture");
      assert.equal(result.value.history.at(-1)?.actor, "coding_agent");

      const stored = await store.get(workflow.id);
      assert.ok(stored?.proposal, "the proposal should be persisted");
      assert.equal(stored?.proposal?.source, "fixture");
      assert.equal(stored?.status, "awaiting_code_approval");
    });
  });

  it("does not modify any source file while producing a proposal", async () => {
    await withTempStore(async (store) => {
      const workflow = codingWorkflow();
      await store.save(workflow);

      const before = await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(process.cwd(), "lib", "tasks.ts"), "utf8"),
      );

      const result = await requestCodeProposal({
        id: workflow.id,
        store,
        useFixture: true,
        now: 4_000,
      });
      assert.equal(result.ok, true);

      const after = await import("node:fs/promises").then((fs) =>
        fs.readFile(path.join(process.cwd(), "lib", "tasks.ts"), "utf8"),
      );
      assert.equal(after, before, "lib/tasks.ts must be untouched");
    });
  });

  it("refuses a proposal request when the workflow is not in the coding state", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      assert.equal(created.ok, true);
      if (!created.ok) return;

      // Still awaiting_plan_approval.
      const result = await requestCodeProposal({
        id: created.value.id,
        store,
        useFixture: true,
      });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 409);
        assert.match(result.error, /coding state/);
      }
    });
  });

  it("refuses a second proposal request once the workflow left the coding state", async () => {
    await withTempStore(async (store) => {
      const workflow = codingWorkflow();
      await store.save(workflow);

      const first = await requestCodeProposal({
        id: workflow.id,
        store,
        useFixture: true,
      });
      assert.equal(first.ok, true);

      const second = await requestCodeProposal({
        id: workflow.id,
        store,
        useFixture: true,
      });
      assert.equal(second.ok, false);
      if (!second.ok) assert.equal(second.status, 409);
    });
  });

  it("refuses a proposal request for an unknown workflow", async () => {
    await withTempStore(async (store) => {
      const result = await requestCodeProposal({
        id: "wf_missing",
        store,
        useFixture: true,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.status, 404);
    });
  });

  it("keeps the plan attached to the workflow after a proposal", async () => {
    await withTempStore(async (store) => {
      const workflow = codingWorkflow();
      await store.save(workflow);

      const result = await requestCodeProposal({
        id: workflow.id,
        store,
        useFixture: true,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.plan?.id, "plan_1");
    });
  });

  it("rejects the code approval gate when no proposal exists", () => {
    const workflow = codingWorkflow();
    const result = transition(workflow, "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_required");
  });

  it("permits the code approval gate when a valid proposal is attached", () => {
    const workflow = codingWorkflow();
    const proposal = buildFixtureProposal({
      id: "prop_valid",
      createdAt: 4_000,
      featureRequest: "Add due dates",
    });
    const result = transition(workflow, "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "awaiting_code_approval");
    assert.equal(result.value.proposal?.id, "prop_valid");
  });

  it("refuses to attach a proposal outside the code approval gate", () => {
    const proposal = buildFixtureProposal({
      id: "prop_x",
      createdAt: 4_000,
      featureRequest: "Add due dates",
    });
    const waiting = transition(codingWorkflow(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal,
    });
    if (!waiting.ok) throw new Error("setup failed");

    const result = transition(waiting.value, "verifying", {
      actor: "human",
      at: 5_000,
      proposal,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_not_permitted");
  });

  it("leaves the approved plan and approval flow working", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      const approved = await approveWorkflowPlan({ id: created.value.id, store });
      assert.equal(approved.ok, true);
      if (!approved.ok) return;
      assert.equal(approved.value.status, "coding");
      assert.equal(approved.value.proposal, undefined);
    });
  });
});

describe("client input cannot bypass the proposal gate", () => {
  it("ignores a forged status and actor on plan approval", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");

      const forged = {
        id: created.value.id,
        store,
        now: 5_000,
        status: "awaiting_code_approval",
        actor: "system",
      } as unknown as Parameters<typeof approveWorkflowPlan>[0];

      const approved = await approveWorkflowPlan(forged);
      assert.equal(approved.ok, true);
      if (!approved.ok) return;

      assert.equal(approved.value.status, "coding", "must land in coding, not skip a gate");
      assert.equal(approved.value.history.at(-1)?.actor, "human");
      assert.equal(approved.value.proposal, undefined);
    });
  });

  it("ignores a forged proposal and status on a proposal request", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");
      const approved = await approveWorkflowPlan({ id: created.value.id, store });
      if (!approved.ok) throw new Error("setup failed");

      const forged = {
        id: created.value.id,
        store,
        useFixture: true,
        now: 6_000,
        status: "passed",
        actor: "system",
        proposal: { id: "prop_forged", source: "live", diff: "--- a/.env" },
      } as unknown as Parameters<typeof requestCodeProposal>[0];

      const result = await requestCodeProposal(forged);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.status, "awaiting_code_approval");
      assert.notEqual(result.value.proposal?.id, "prop_forged", "server must own the proposal");
      assert.match(result.value.proposal?.id ?? "", /^prop_/);
      assert.equal(result.value.proposal?.source, "fixture");
      assert.match(result.value.proposal?.diff ?? "", /^--- a\//);
      assert.equal(result.value.history.at(-1)?.actor, "coding_agent");
    });
  });

  it("cannot verify a record that skipped the gate without a proposal", async () => {
    await withTempStore(async (store) => {
      const created = await startWorkflow({
        feature: "Add due dates to tasks and highlight the overdue ones.",
        store,
      });
      if (!created.ok) throw new Error("setup failed");
      const approved = await approveWorkflowPlan({ id: created.value.id, store });
      if (!approved.ok) throw new Error("setup failed");

      // Simulate a hand-written or legacy record that skipped the gate.
      await store.save({ ...approved.value, status: "awaiting_code_approval" } as never);

      const stored = await store.get(created.value.id);
      assert.equal(stored?.status, "awaiting_code_approval");
      assert.equal(stored?.proposal, undefined);
      assert.equal(isStoredProposal(stored?.proposal), false);
      if (!stored) throw new Error("setup failed");

      const moved = transition(stored, "verifying", { actor: "human", at: 7_000 });
      assert.equal(moved.ok, false);
      if (!moved.ok) assert.equal(moved.failure.code, "proposal_required");
    });
  });

  it("rejects a malformed stored proposal at the verification gate", () => {
    const valid = buildFixtureProposal({
      id: "prop_valid",
      createdAt: 4_000,
      featureRequest: "Add due dates",
    });
    const waiting = transition(codingWorkflow(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal: valid,
    });
    if (!waiting.ok) throw new Error("setup failed");

    const malformed = {
      ...waiting.value,
      proposal: { id: "prop_bad" },
    } as unknown as typeof waiting.value;

    const moved = transition(malformed, "verifying", { actor: "human", at: 5_000 });
    assert.equal(moved.ok, false);
    if (!moved.ok) assert.equal(moved.failure.code, "proposal_invalid");
  });

  it("keeps fixture proposals labelled as fixtures through the service", async () => {
    await withTempStore(async (store) => {
      const workflow = codingWorkflow();
      await store.save(workflow);

      const result = await requestCodeProposal({
        id: workflow.id,
        store,
        useFixture: true,
        now: 8_000,
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;

      assert.equal(result.value.proposal?.source, "fixture");
      assert.equal(result.value.proposal?.model, undefined);
      assert.match(result.value.proposal?.notice ?? "", /not by an AI model/i);
    });
  });
});
