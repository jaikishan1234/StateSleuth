import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFixtureProposal } from "../lib/coding-proposal.ts";
import type { FeaturePlan } from "../lib/planner.ts";
import {
  ALLOWED_TRANSITIONS,
  PLAN_REQUIRED_STATUSES,
  TERMINAL_STATUSES,
  WORKFLOW_ACTORS,
  WORKFLOW_STATUSES,
  allowedTransitions,
  approveCode,
  approvePlan,
  canTransition,
  createWorkflow,
  failWorkflow,
  isTerminalStatus,
  isWorkflowActor,
  isWorkflowStatus,
  rejectWorkflow,
  sanitizeMessage,
  toSafeFailure,
  transition,
  type Workflow,
  type WorkflowFailure,
  type WorkflowPlan,
  type WorkflowResult,
} from "../lib/workflow.ts";

const SAMPLE_PLAN: FeaturePlan = {
  featureSummary: {
    title: "Due dates on tasks",
    description: "Every task can carry a due date.",
  },
  implementationSteps: [
    { title: "Store the due date", detail: "Add a field to the task record." },
  ],
  acceptanceCriteria: ["A task can carry a due date."],
  browserVerificationSteps: ["Open the demo and add a dated task."],
  expectedResults: ["The date is still there after a reload."],
  edgeCases: ["A date in the past."],
};

const SAMPLE_WORKFLOW_PLAN: WorkflowPlan = {
  id: "plan_1",
  mode: "demo",
  generatedAt: 1_000,
  plan: SAMPLE_PLAN,
};

/** A valid proposal, required before entering awaiting_code_approval. */
const SAMPLE_PROPOSAL = buildFixtureProposal({
  id: "prop_1",
  createdAt: 4_000,
  featureRequest: "Add due dates to tasks",
});

function unwrap<T>(result: WorkflowResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful result, got ${result.failure.code}`);
  }
  return result.value;
}

function failureOf<T>(result: WorkflowResult<T>): WorkflowFailure {
  if (result.ok) {
    throw new Error("expected a failure result, got a success");
  }
  return result.failure;
}

function newWorkflow(): Workflow {
  return unwrap(
    createWorkflow({
      id: "wf_1",
      featureRequest: "Add due dates to tasks and highlight overdue ones.",
      now: 1_000,
    }),
  );
}

/** A workflow parked at the plan approval gate, carrying a plan. */
function workflowWithPlan(): Workflow {
  return unwrap(
    transition(newWorkflow(), "awaiting_plan_approval", {
      actor: "planning_agent",
      at: 2_000,
      plan: SAMPLE_WORKFLOW_PLAN,
    }),
  );
}

describe("workflow status vocabulary", () => {
  it("defines exactly the eight expected statuses", () => {
    assert.deepEqual([...WORKFLOW_STATUSES], [
      "planning",
      "awaiting_plan_approval",
      "coding",
      "awaiting_code_approval",
      "verifying",
      "passed",
      "failed",
      "rejected",
    ]);
  });

  it("has a transition entry for every status", () => {
    for (const status of WORKFLOW_STATUSES) {
      assert.ok(Array.isArray(ALLOWED_TRANSITIONS[status]), `missing ${status}`);
    }
    assert.equal(Object.keys(ALLOWED_TRANSITIONS).length, WORKFLOW_STATUSES.length);
  });

  it("recognises valid statuses and rejects unknown ones", () => {
    for (const status of WORKFLOW_STATUSES) {
      assert.equal(isWorkflowStatus(status), true);
    }
    for (const value of ["unknown", "", "PLANNING", 42, null, undefined, {}]) {
      assert.equal(isWorkflowStatus(value), false);
    }
  });

  it("recognises valid actors and rejects unknown ones", () => {
    for (const actor of WORKFLOW_ACTORS) {
      assert.equal(isWorkflowActor(actor), true);
    }
    assert.equal(isWorkflowActor("robot"), false);
  });

  it("marks exactly three statuses as terminal", () => {
    assert.deepEqual([...TERMINAL_STATUSES], ["passed", "failed", "rejected"]);
    for (const status of TERMINAL_STATUSES) {
      assert.equal(isTerminalStatus(status), true);
      assert.deepEqual(allowedTransitions(status), []);
    }
    for (const status of WORKFLOW_STATUSES) {
      if (!isTerminalStatus(status)) {
        assert.equal(isTerminalStatus(status), false);
      }
    }
  });

  it("requires a plan only for the work states", () => {
    assert.deepEqual([...PLAN_REQUIRED_STATUSES], [
      "coding",
      "awaiting_code_approval",
      "verifying",
      "passed",
    ]);
  });
});

describe("valid transitions", () => {
  it("walks the full approved path to passed", () => {
    let workflow = newWorkflow();
    assert.equal(workflow.status, "planning");

    workflow = unwrap(
      transition(workflow, "awaiting_plan_approval", {
        actor: "planning_agent",
        at: 2_000,
        plan: SAMPLE_WORKFLOW_PLAN,
      }),
    );
    assert.equal(workflow.status, "awaiting_plan_approval");
    assert.equal(workflow.plan?.id, "plan_1");

    workflow = unwrap(approvePlan(workflow, { at: 3_000 }));
    assert.equal(workflow.status, "coding");

    workflow = unwrap(
      transition(workflow, "awaiting_code_approval", {
        actor: "coding_agent",
        at: 4_000,
        proposal: SAMPLE_PROPOSAL,
      }),
    );
    assert.equal(workflow.status, "awaiting_code_approval");

    workflow = unwrap(approveCode(workflow, { at: 5_000 }));
    assert.equal(workflow.status, "verifying");

    workflow = unwrap(
      transition(workflow, "passed", { actor: "verification_agent", at: 6_000 }),
    );
    assert.equal(workflow.status, "passed");
    assert.equal(isTerminalStatus(workflow.status), true);
  });

  it("records every transition in the history", () => {
    let workflow = newWorkflow();
    workflow = unwrap(
      transition(workflow, "awaiting_plan_approval", {
        actor: "planning_agent",
        at: 2_000,
        plan: SAMPLE_WORKFLOW_PLAN,
      }),
    );
    workflow = unwrap(approvePlan(workflow, { at: 3_000 }));

    assert.equal(workflow.history.length, 3);
    assert.deepEqual(
      workflow.history.map((entry) => `${entry.from ?? "none"}->${entry.to}`),
      ["none->planning", "planning->awaiting_plan_approval", "awaiting_plan_approval->coding"],
    );
    assert.equal(workflow.history[0]?.actor, "system");
    assert.equal(workflow.history[2]?.actor, "human");
  });

  it("keeps the plan attached across later transitions", () => {
    let workflow = workflowWithPlan();
    workflow = unwrap(approvePlan(workflow, { at: 3_000 }));
    workflow = unwrap(
      transition(workflow, "awaiting_code_approval", {
        actor: "coding_agent",
        at: 4_000,
        proposal: SAMPLE_PROPOSAL,
      }),
    );
    assert.equal(workflow.plan?.id, "plan_1");
    assert.equal(workflow.plan?.plan.featureSummary.title, "Due dates on tasks");
  });

  it("does not mutate the workflow it was given", () => {
    const original = workflowWithPlan();
    const snapshot = JSON.stringify(original);
    const next = unwrap(transition(original, "coding", { actor: "human", at: 3_000 }));

    assert.notEqual(next, original);
    assert.equal(original.status, "awaiting_plan_approval");
    assert.equal(original.history.length, 2);
    assert.equal(JSON.stringify(original), snapshot);
  });

  it("reports allowed transitions per status", () => {
    assert.equal(canTransition("planning", "awaiting_plan_approval"), true);
    assert.equal(canTransition("planning", "rejected"), true);
    assert.equal(canTransition("passed", "planning"), false);
    assert.deepEqual(allowedTransitions("planning"), [
      "awaiting_plan_approval",
      "failed",
      "rejected",
    ]);
  });
});

describe("invalid transitions", () => {
  it("refuses to skip the plan approval gate", () => {
    const result = transition(newWorkflow(), "coding", { actor: "human", at: 2_000 });
    const failure = failureOf(result);
    assert.equal(failure.code, "invalid_transition");
    assert.match(failure.message, /planning to coding/);
  });

  it("refuses to skip the code approval gate", () => {
    const workflow = workflowWithPlan();
    const result = transition(workflow, "verifying", { actor: "human", at: 3_000 });
    assert.equal(failureOf(result).code, "invalid_transition");
  });

  it("refuses a self transition", () => {
    const result = transition(newWorkflow(), "planning", { actor: "system", at: 2_000 });
    assert.equal(failureOf(result).code, "invalid_transition");
  });

  it("refuses any transition out of a terminal state", () => {
    const passed = unwrap(
      transition(workflowWithPlan(), "coding", { actor: "human", at: 3_000 }),
    );
    const terminal = unwrap(
      transition(
        unwrap(
          transition(passed, "awaiting_code_approval", {
            actor: "coding_agent",
            at: 4_000,
            proposal: SAMPLE_PROPOSAL,
          }),
        ),
        "verifying",
        { actor: "human", at: 5_000 },
      ),
    );
    const result = transition(
      unwrap(transition(terminal, "passed", { actor: "verification_agent", at: 6_000 })),
      "coding",
      { actor: "human", at: 7_000 },
    );
    assert.equal(failureOf(result).code, "invalid_transition");
  });

  it("rejects an unknown target status", () => {
    const result = transition(newWorkflow(), "teleporting" as never, {
      actor: "system",
      at: 2_000,
    });
    assert.equal(failureOf(result).code, "unknown_status");
  });

  it("rejects an unknown actor", () => {
    const result = transition(newWorkflow(), "awaiting_plan_approval", {
      actor: "robot" as never,
      at: 2_000,
    });
    assert.equal(failureOf(result).code, "invalid_input");
  });

  it("refuses to attach a plan outside the approval gate", () => {
    const workflow = workflowWithPlan();
    const result = transition(workflow, "coding", {
      actor: "human",
      at: 3_000,
      plan: SAMPLE_WORKFLOW_PLAN,
    });
    assert.equal(failureOf(result).code, "plan_not_permitted");
  });

  it("refuses to start coding without a plan", () => {
    const noPlan = unwrap(
      transition(newWorkflow(), "awaiting_plan_approval", {
        actor: "planning_agent",
        at: 2_000,
      }),
    );
    const result = approvePlan(noPlan, { at: 3_000 });
    const failure = failureOf(result);
    assert.equal(failure.code, "plan_required");
    assert.match(failure.message, /requires an approved plan/);
  });

  it("refuses to record a failure on a non-failure transition", () => {
    const result = transition(newWorkflow(), "rejected", {
      actor: "human",
      at: 2_000,
      failure: { code: "unexpected_error", message: "nope", at: 2_000 },
    });
    assert.equal(failureOf(result).code, "invalid_input");
  });

  it("refuses a workflow without a feature request or id", () => {
    assert.equal(
      failureOf(createWorkflow({ id: "wf_1", featureRequest: "   ", now: 1 })).code,
      "invalid_input",
    );
    assert.equal(
      failureOf(createWorkflow({ id: "  ", featureRequest: "real request", now: 1 })).code,
      "invalid_input",
    );
  });
});

describe("rejection paths", () => {
  it("rejects from planning and becomes terminal", () => {
    const result = rejectWorkflow(newWorkflow(), "Scope is too large for this batch", {
      at: 2_000,
    });
    const workflow = unwrap(result);
    assert.equal(workflow.status, "rejected");
    assert.equal(isTerminalStatus(workflow.status), true);
    assert.equal(workflow.history.at(-1)?.actor, "human");
    assert.equal(workflow.history.at(-1)?.note, "Scope is too large for this batch");
  });

  it("rejects at the plan approval gate", () => {
    const workflow = workflowWithPlan();
    const result = rejectWorkflow(workflow, "The plan misses the empty-state case", {
      at: 3_000,
    });
    const rejected = unwrap(result);
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.plan?.id, "plan_1");
  });

  it("rejects at the code approval gate and during verification", () => {
    let workflow = workflowWithPlan();
    workflow = unwrap(approvePlan(workflow, { at: 3_000 }));
    workflow = unwrap(
      transition(workflow, "awaiting_code_approval", {
        actor: "coding_agent",
        at: 4_000,
        proposal: SAMPLE_PROPOSAL,
      }),
    );
    const rejected = unwrap(
      rejectWorkflow(workflow, "The patch does not touch the persistence layer", {
        at: 5_000,
      }),
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(isTerminalStatus(rejected.status), true);
  });

  it("refuses to move a rejected workflow any further", () => {
    const rejected = unwrap(
      rejectWorkflow(newWorkflow(), "Not now", { at: 2_000 }),
    );
    const result = transition(rejected, "coding", { actor: "human", at: 3_000 });
    assert.equal(failureOf(result).code, "invalid_transition");
  });

  it("requires a rejection reason", () => {
    const result = rejectWorkflow(newWorkflow(), "   ", { at: 2_000 });
    const failure = failureOf(result);
    assert.equal(failure.code, "invalid_input");
    assert.match(failure.message, /reason is required/);
  });

  it("records a failure as a terminal state with safe details", () => {
    const workflow = workflowWithPlan();
    const failure: WorkflowFailure = {
      code: "unexpected_error",
      message: "Verification could not reach the application under test",
      at: 9_000,
    };
    const failed = unwrap(failWorkflow(workflow, failure, { at: 9_000 }));
    assert.equal(failed.status, "failed");
    assert.equal(isTerminalStatus(failed.status), true);
    assert.equal(failed.failure?.code, "unexpected_error");
    assert.equal(failed.failure?.message, failure.message);
    assert.equal(failed.failure?.at, 9_000);
  });
});

describe("code approval gate requires a valid proposal", () => {
  function atCoding(): Workflow {
    let workflow = workflowWithPlan();
    workflow = unwrap(approvePlan(workflow, { at: 3_000 }));
    return workflow;
  }

  it("rejects the transition when no proposal exists", () => {
    const result = transition(atCoding(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_required");
  });

  it("rejects a malformed proposal supplied with the transition", () => {
    const result = transition(atCoding(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal: { id: "prop_bad", source: "fixture" } as unknown as typeof SAMPLE_PROPOSAL,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_invalid");
  });

  it("rejects a malformed proposal already stored on the workflow", () => {
    const workflow = {
      ...atCoding(),
      proposal: { id: "prop_bad" },
    } as unknown as Workflow;
    const result = transition(workflow, "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_invalid");
  });

  it("rejects a proposal whose diff names a blocked path", () => {
    const sneaky = {
      ...SAMPLE_PROPOSAL,
      diff: "--- a/.env.local\n+++ b/.env.local\n@@ -1 +1 @@\n+SECRET=1\n",
    };
    const result = transition(atCoding(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal: sneaky,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_invalid");
  });

  it("rejects a proposal whose file list is not on the allowlist", () => {
    const sneaky = {
      ...SAMPLE_PROPOSAL,
      files: [{ path: "secrets/keys.ts", change: "add", summary: "Add keys." }],
    } as unknown as typeof SAMPLE_PROPOSAL;
    const result = transition(atCoding(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal: sneaky,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "proposal_invalid");
  });

  it("accepts a valid proposal and attaches it to the workflow", () => {
    const result = transition(atCoding(), "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
      proposal: SAMPLE_PROPOSAL,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.status, "awaiting_code_approval");
    assert.equal(result.value.proposal?.id, "prop_1");
    assert.equal(result.value.proposal?.source, "fixture");
  });

  it("accepts a valid proposal already stored on the workflow", () => {
    const workflow = { ...atCoding(), proposal: SAMPLE_PROPOSAL };
    const result = transition(workflow, "awaiting_code_approval", {
      actor: "coding_agent",
      at: 4_000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.proposal?.id, "prop_1");
  });
});

describe("safe failure information", () => {
  it("redacts long key-like substrings", () => {
    const message = sanitizeMessage("failed with key AIzaSyDkR7eVvQ2mZp9LxTn4BhW6yUc0");
    assert.ok(!message.includes("AIzaSyDkR7eVvQ2mZp9LxTn4BhW6yUc0"));
    assert.match(message, /\[redacted\]/);
    assert.equal(sanitizeMessage("x".repeat(500)), "[redacted]");
  });

  it("collapses whitespace and truncates long messages", () => {
    assert.equal(sanitizeMessage("  too   many\nspaces  "), "too many spaces");
    const long = sanitizeMessage("word ".repeat(200), 40);
    assert.equal(long.length, 40);
    assert.ok(long.endsWith("…"));
  });

  it("keeps ordinary status names readable", () => {
    const message = sanitizeMessage("Cannot move from awaiting_plan_approval to coding.");
    assert.match(message, /awaiting_plan_approval/);
  });

  it("converts an unknown error into a safe failure", () => {
    const failure = toSafeFailure(new Error("Boom AKIAIOSFODNN7EXAMPLE"), 5_000);
    assert.equal(failure.code, "unexpected_error");
    assert.equal(failure.at, 5_000);
    assert.ok(!failure.message.includes("AKIAIOSFODNN7EXAMPLE"));
  });

  it("converts a string error into a safe failure", () => {
    const failure = toSafeFailure("something broke", 5_000);
    assert.equal(failure.code, "unexpected_error");
    assert.equal(failure.message, "something broke");
  });

  it("falls back for a non-error value", () => {
    const failure = toSafeFailure(42, 5_000);
    assert.equal(failure.code, "unexpected_error");
    assert.equal(failure.message, "Unexpected workflow error.");
  });

  it("passes an existing failure through unchanged", () => {
    const original: WorkflowFailure = {
      code: "invalid_transition",
      message: "Cannot move from planning to coding.",
      at: 1_000,
    };
    assert.deepEqual(toSafeFailure(original, 9_000), original);
  });
});
