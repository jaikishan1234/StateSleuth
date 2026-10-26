/**
 * Workflow application service.
 *
 * Server-only. Orchestrates the planner, the workflow domain transitions and
 * the file-backed store. Every state change goes through the domain module,
 * so a client-supplied status is never trusted.
 */

import { randomUUID } from "node:crypto";
import { requestProposal } from "./coding-agent.ts";
import { isStoredProposal, type CodingProposal } from "./coding-proposal.ts";
import { applyProposal, captureProposalSnapshot } from "./patch-apply.ts";
import { generatePlan, type PlanOutcome } from "./planner-server.ts";
import { PLANNER_LIMITS, type FeaturePlan } from "./planner.ts";
import {
  approvePlan,
  createWorkflow,
  rejectWorkflow,
  sanitizeMessage,
  toSafeFailure,
  transition,
  type Workflow,
  type WorkflowFailure,
  type WorkflowPlan,
  type WorkflowResult,
} from "./workflow.ts";
import { getWorkflowStore, type WorkflowStore } from "./workflow-store.ts";

export type ServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      status: number;
      error: string;
      failure?: WorkflowFailure;
      /** Files left modified on disk when the request failed. */
      applied?: string[];
      /** True when source files may already have changed. */
      filesChanged?: boolean;
    };

export const REJECTION_REASON_MIN = 3;
export const REJECTION_REASON_MAX = 500;

/** The shape sent to the browser. Contains no credentials or stack traces. */
export type WorkflowView = {
  id: string;
  featureRequest: string;
  status: Workflow["status"];
  plan?: WorkflowPlan;
  proposal?: CodingProposal;
  failure?: WorkflowFailure;
  createdAt: number;
  updatedAt: number;
  history: Workflow["history"];
};

export function toWorkflowView(workflow: Workflow): WorkflowView {
  return {
    id: workflow.id,
    featureRequest: workflow.featureRequest,
    status: workflow.status,
    plan: workflow.plan,
    proposal: workflow.proposal,
    failure: workflow.failure,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    history: workflow.history,
  };
}

function planId(): string {
  return `plan_${randomUUID()}`;
}

export type CreateWorkflowOptions = {
  feature: string;
  store?: WorkflowStore;
  now?: number;
  /**
   * Explicit fixture mode. Must be a boolean when supplied; anything else is
   * rejected so a malformed request cannot silently look like normal mode.
   */
  fixture?: unknown;
};

/**
 * Creates a workflow and runs the planning stage.
 *
 * When the planner is in live mode and the provider call fails, the workflow
 * is recorded as failed and the failure is returned. A demo plan is never
 * substituted for a live failure.
 */
export async function startWorkflow(
  options: CreateWorkflowOptions,
): Promise<ServiceResult<WorkflowView>> {
  const store = options.store ?? getWorkflowStore();
  const now = options.now ?? Date.now();
  const feature = options.feature.trim();

  if (options.fixture !== undefined && typeof options.fixture !== "boolean") {
    return {
      ok: false,
      status: 400,
      error: "The `fixture` option must be true or false.",
    };
  }

  const useFixture = options.fixture === true;

  if (feature.length < PLANNER_LIMITS.featureMin) {
    return {
      ok: false,
      status: 400,
      error: `Describe the feature in at least ${PLANNER_LIMITS.featureMin} characters.`,
    };
  }

  if (feature.length > PLANNER_LIMITS.featureMax) {
    return {
      ok: false,
      status: 400,
      error: `Keep the description under ${PLANNER_LIMITS.featureMax} characters.`,
    };
  }

  const created = createWorkflow({ id: `wf_${randomUUID()}`, featureRequest: feature, now });
  if (!created.ok) {
    return {
      ok: false,
      status: 400,
      error: created.failure.message,
      failure: created.failure,
    };
  }

  const planning = await generatePlan(feature, { fixture: useFixture });

  if (!planning.ok) {
    const failure = toSafeFailure(
      { code: "unexpected_error", message: planning.error, at: now },
      now,
    );
    const failed = transition(created.value, "failed", {
      actor: "system",
      at: now,
      failure,
    });

    if (failed.ok) {
      await store.save(failed.value);
      return {
        ok: false,
        status: 502,
        error: planning.error,
        failure: failed.value.failure,
      };
    }

    return { ok: false, status: 502, error: planning.error };
  }

  const outcome: PlanOutcome = planning.value;
  const workflowPlan: WorkflowPlan = {
    id: planId(),
    mode: outcome.mode,
    generatedAt: now,
    plan: outcome.plan,
  };

  const moved = transition(created.value, "awaiting_plan_approval", {
    actor: "planning_agent",
    at: now,
    plan: workflowPlan,
  });

  if (!moved.ok) {
    return {
      ok: false,
      status: 500,
      error: moved.failure.message,
      failure: moved.failure,
    };
  }

  await store.save(moved.value);
  return { ok: true, value: toWorkflowView(moved.value) };
}

export async function readWorkflow(
  id: string,
  store: WorkflowStore = getWorkflowStore(),
): Promise<ServiceResult<WorkflowView>> {
  const workflow = await store.get(id);
  if (!workflow) {
    return { ok: false, status: 404, error: "No workflow with that id." };
  }
  return { ok: true, value: toWorkflowView(workflow) };
}

export async function listWorkflows(
  store: WorkflowStore = getWorkflowStore(),
): Promise<WorkflowView[]> {
  const workflows = await store.list();
  return workflows.map(toWorkflowView);
}

export type ApproveOptions = {
  id: string;
  store?: WorkflowStore;
  now?: number;
};

/** Human approval of the plan. Moves the workflow to `coding`. */
export async function approveWorkflowPlan(
  options: ApproveOptions,
): Promise<ServiceResult<WorkflowView>> {
  const store = options.store ?? getWorkflowStore();
  const now = options.now ?? Date.now();

  const workflow = await store.get(options.id);
  if (!workflow) {
    return { ok: false, status: 404, error: "No workflow with that id." };
  }

  const result: WorkflowResult<Workflow> = approvePlan(workflow, { at: now });
  if (!result.ok) {
    return {
      ok: false,
      status: result.failure.code === "invalid_transition" ? 409 : 400,
      error: result.failure.message,
      failure: result.failure,
    };
  }

  await store.save(result.value);
  return { ok: true, value: toWorkflowView(result.value) };
}

export type RequestProposalOptions = {
  id: string;
  store?: WorkflowStore;
  now?: number;
  /** Forces the deterministic fixture. Used by tests and the demo. */
  useFixture?: boolean;
  /** Project root used to snapshot target files. */
  projectRoot?: string;
};

/**
 * Asks the coding agent for a proposal.
 *
 * Only a workflow in the `coding` state may request one. The proposal is
 * stored with the workflow and the workflow moves to `awaiting_code_approval`,
 * where a human reviews it. The patch is NOT applied: no source file is
 * written, no shell command is run.
 */
export async function requestCodeProposal(
  options: RequestProposalOptions,
): Promise<ServiceResult<WorkflowView>> {
  const store = options.store ?? getWorkflowStore();
  const now = options.now ?? Date.now();

  const workflow = await store.get(options.id);
  if (!workflow) {
    return { ok: false, status: 404, error: "No workflow with that id." };
  }

  if (workflow.status !== "coding") {
    return {
      ok: false,
      status: 409,
      error: `A coding proposal can only be requested while the workflow is in the coding state. This one is ${workflow.status}.`,
    };
  }

  if (!workflow.plan) {
    return {
      ok: false,
      status: 409,
      error: "This workflow has no approved plan, so there is nothing to implement.",
    };
  }

  const proposalId = `prop_${randomUUID()}`;

  const result = await requestProposal({
    featureRequest: workflow.featureRequest,
    plan: workflow.plan.plan,
    id: proposalId,
    createdAt: now,
    useFixture: options.useFixture,
  });

  if (!result.ok) {
    return {
      ok: false,
      status: 502,
      error: result.error,
      failure: {
        code: "unexpected_error",
        message: result.error,
        at: now,
      },
    };
  }

  // Record the current content hashes so a later approval can detect a stale
  // proposal instead of overwriting newer work.
  const withSnapshot = await captureProposalSnapshot(
    options.projectRoot ?? process.cwd(),
    result.proposal,
  );

  // Defence in depth: the domain refuses an invalid proposal too, but the
  // service should never hand one over in the first place.
  if (!isStoredProposal(withSnapshot)) {
    return {
      ok: false,
      status: 500,
      error: "The generated proposal was not valid, so it was not attached.",
    };
  }

  const moved = transition(workflow, "awaiting_code_approval", {
    actor: "coding_agent",
    at: now,
    proposal: withSnapshot,
  });

  if (!moved.ok) {
    return {
      ok: false,
      status: 409,
      error: moved.failure.message,
      failure: moved.failure,
    };
  }

  await store.save(moved.value);
  return { ok: true, value: toWorkflowView(moved.value) };
}

export type RejectOptions = {
  id: string;
  reason: string;
  store?: WorkflowStore;
  now?: number;
};

/** Human rejection. Requires a reason and moves the workflow to `rejected`. */
export async function rejectWorkflowPlan(
  options: RejectOptions,
): Promise<ServiceResult<WorkflowView>> {
  const store = options.store ?? getWorkflowStore();
  const now = options.now ?? Date.now();
  const reason = options.reason.trim();

  if (reason.length < REJECTION_REASON_MIN) {
    return {
      ok: false,
      status: 400,
      error: `Give a rejection reason of at least ${REJECTION_REASON_MIN} characters.`,
    };
  }

  if (reason.length > REJECTION_REASON_MAX) {
    return {
      ok: false,
      status: 400,
      error: `Keep the rejection reason under ${REJECTION_REASON_MAX} characters.`,
    };
  }

  const workflow = await store.get(options.id);
  if (!workflow) {
    return { ok: false, status: 404, error: "No workflow with that id." };
  }

  const result = rejectWorkflow(workflow, reason, { at: now });
  if (!result.ok) {
    return {
      ok: false,
      status: result.failure.code === "invalid_transition" ? 409 : 400,
      error: result.failure.message,
      failure: result.failure,
    };
  }

  await store.save(result.value);
  return { ok: true, value: toWorkflowView(result.value) };
}

export const CODE_REJECTION_REASON_MIN = 3;
export const CODE_REJECTION_REASON_MAX = 500;

function applyFailureStatus(code: string): number {
  if (code === "stale" || code === "conflict" || code === "missing_snapshot" || code === "invalid_proposal") {
    return 409;
  }
  if (code === "io_error") return 500;
  return 400;
}

export type ApproveCodeOptions = {
  id: string;
  store?: WorkflowStore;
  now?: number;
  projectRoot?: string;
  /**
   * Must be exactly `true`. The client has to confirm that source files will be
   * written; anything else is refused.
   */
  confirm?: unknown;
  /** Test seam: lets tests simulate application outcomes. */
  applyImpl?: typeof applyProposal;
};

/**
 * Human approval of the code proposal, which applies the patch.
 *
 * The stored proposal is revalidated and re-hashed immediately before use. The
 * client never supplies paths, diff contents, a status or an actor.
 */
export async function approveCodeProposal(
  options: ApproveCodeOptions,
): Promise<ServiceResult<WorkflowView>> {
  const store = options.store ?? getWorkflowStore();
  const now = options.now ?? Date.now();

  if (options.confirm !== true) {
    return {
      ok: false,
      status: 400,
      error: "Confirm that the proposed changes should be written to source files.",
    };
  }

  const workflow = await store.get(options.id);
  if (!workflow) {
    return { ok: false, status: 404, error: "No workflow with that id." };
  }

  if (workflow.status !== "awaiting_code_approval") {
    return {
      ok: false,
      status: 409,
      error: `Code can only be approved while the workflow is awaiting code approval. This one is ${workflow.status}.`,
    };
  }

  if (!workflow.proposal) {
    return {
      ok: false,
      status: 409,
      error: "This workflow has no coding proposal to approve.",
    };
  }

  if (!isStoredProposal(workflow.proposal)) {
    return {
      ok: false,
      status: 409,
      error: "The stored coding proposal is not valid.",
    };
  }

const apply = options.applyImpl ?? applyProposal;
  const applied = await apply({
    projectRoot: options.projectRoot ?? process.cwd(),
    proposal: workflow.proposal,
  });

  if (!applied.ok) {
    const message = applied.failure.message;

    // Files are still modified on disk: this is the only case that is not
    // recoverable, because the working tree no longer matches the snapshot.
    if (applied.applied.length > 0) {
      const failure = toSafeFailure({ code: "unexpected_error", message, at: now }, now);
      const failed = transition(workflow, "failed", {
        actor: "system",
        at: now,
        failure,
        note: sanitizeMessage(
          `Apply failed; these files were changed and not restored: ${applied.applied.join(", ")}`,
        ),
      });

      if (failed.ok) {
        try {
          await store.save(failed.value);
        } catch {
          console.error("[workflow] could not persist the failed state after a partial apply");
        }
      }

      return {
        ok: false,
        status: 500,
        error: `${message} The workflow was marked failed.`,
        failure,
        applied: applied.applied,
        filesChanged: true,
      };
    }

    // Nothing remains modified. A rolled-back write failure leaves the
    // workflow where it was so the same proposal can be retried safely.
    const retryable = applied.failure.code === "io_error" && applied.rolledBack;
    return {
      ok: false,
      status: retryable ? 500 : applyFailureStatus(applied.failure.code),
      error: retryable
        ? `${message} No source file was changed, so you can retry the approval.`
        : message,
      failure: {
        code: applied.failure.code === "stale" ? "invalid_transition" : "unexpected_error",
        message,
        at: now,
      },
      applied: [],
      filesChanged: false,
    };
  }

  const moved = transition(workflow, "verifying", {
    actor: "human",
    at: now,
    note: sanitizeMessage(`Applied ${applied.applied.length} file(s): ${applied.applied.join(", ")}`),
  });

  if (!moved.ok) {
    return {
      ok: false,
      status: 409,
      error: moved.failure.message,
      failure: moved.failure,
    };
  }

  // The files are already written. If persistence fails, say so explicitly:
  // the user must not be told the workflow is merely awaiting approval when
  // the working tree has changed.
  let persisted = true;
  try {
    await store.save(moved.value);
  } catch {
    try {
      await store.save(moved.value);
      persisted = true;
    } catch {
      persisted = false;
    }
  }

  if (!persisted) {
    console.error("[workflow] source files were written but the workflow could not be saved");
    return {
      ok: false,
      status: 500,
      error:
        "The patch was written to disk, but the workflow could not be saved. Source files have already changed — inspect `git diff` before continuing.",
      failure: {
        code: "unexpected_error",
        message: "The workflow state could not be persisted after the patch was applied.",
        at: now,
      },
      applied: applied.applied,
      filesChanged: true,
    };
  }

  return { ok: true, value: toWorkflowView(moved.value) };
}

export type RejectCodeOptions = {
  id: string;
  reason: string;
  store?: WorkflowStore;
  now?: number;
};

/** Human rejection of the code proposal. A reason is required. */
export async function rejectCodeProposal(
  options: RejectCodeOptions,
): Promise<ServiceResult<WorkflowView>> {
  const store = options.store ?? getWorkflowStore();
  const now = options.now ?? Date.now();
  const reason = options.reason.trim();

  if (reason.length < CODE_REJECTION_REASON_MIN) {
    return {
      ok: false,
      status: 400,
      error: `Give a rejection reason of at least ${CODE_REJECTION_REASON_MIN} characters.`,
    };
  }

  if (reason.length > CODE_REJECTION_REASON_MAX) {
    return {
      ok: false,
      status: 400,
      error: `Keep the rejection reason under ${CODE_REJECTION_REASON_MAX} characters.`,
    };
  }

  const workflow = await store.get(options.id);
  if (!workflow) {
    return { ok: false, status: 404, error: "No workflow with that id." };
  }

  if (workflow.status !== "awaiting_code_approval") {
    return {
      ok: false,
      status: 409,
      error: `Code can only be rejected while the workflow is awaiting code approval. This one is ${workflow.status}.`,
    };
  }

  const result = rejectWorkflow(workflow, reason, { at: now });
  if (!result.ok) {
    return {
      ok: false,
      status: result.failure.code === "invalid_transition" ? 409 : 400,
      error: result.failure.message,
      failure: result.failure,
    };
  }

  await store.save(result.value);
  return { ok: true, value: toWorkflowView(result.value) };
}
