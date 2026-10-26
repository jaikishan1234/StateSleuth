/**
 * Workflow application service.
 *
 * Server-only. Orchestrates the planner, the workflow domain transitions and
 * the file-backed store. Every state change goes through the domain module,
 * so a client-supplied status is never trusted.
 */

import { randomUUID } from "node:crypto";
import { generatePlan, type PlanOutcome } from "./planner-server.ts";
import { PLANNER_LIMITS, type FeaturePlan } from "./planner.ts";
import {
  approvePlan,
  createWorkflow,
  rejectWorkflow,
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
  | { ok: false; status: number; error: string; failure?: WorkflowFailure };

export const REJECTION_REASON_MIN = 3;
export const REJECTION_REASON_MAX = 500;

/** The shape sent to the browser. Contains no credentials or stack traces. */
export type WorkflowView = {
  id: string;
  featureRequest: string;
  status: Workflow["status"];
  plan?: WorkflowPlan;
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

  const planning = await generatePlan(feature);

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
