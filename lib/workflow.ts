/**
 * StateSleuth workflow domain.
 *
 * This module is deliberately pure: it defines types, an explicit transition
 * table and safe failure values. It performs no I/O, holds no mutable module
 * state and provides no storage. A workflow value is a plain object that a
 * caller may keep in memory, persist elsewhere or discard — nothing in here
 * is durable, and nothing here should be presented as durable storage.
 *
 * The workflow is human-approved by design: every step that produces work
 * stops at an approval gate, and a human may reject the run at any point.
 */

import type { FeaturePlan, PlanMode } from "./planner.ts";

/** Every state a workflow can occupy. */
export const WORKFLOW_STATUSES = [
  "planning",
  "awaiting_plan_approval",
  "coding",
  "awaiting_code_approval",
  "verifying",
  "passed",
  "failed",
  "rejected",
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/** States from which no further transition is possible. */
export const TERMINAL_STATUSES = [
  "passed",
  "failed",
  "rejected",
] as const satisfies readonly WorkflowStatus[];

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

/** Who caused a transition. Approvals are always made by a human. */
export const WORKFLOW_ACTORS = [
  "human",
  "planning_agent",
  "coding_agent",
  "verification_agent",
  "system",
] as const;

export type WorkflowActor = (typeof WORKFLOW_ACTORS)[number];

/**
 * The single source of truth for allowed movement.
 *
 * Every non-terminal state may fail or be rejected. Work states additionally
 * hand over to the next human approval gate.
 */
export const ALLOWED_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  planning: ["awaiting_plan_approval", "failed", "rejected"],
  awaiting_plan_approval: ["coding", "failed", "rejected"],
  coding: ["awaiting_code_approval", "failed", "rejected"],
  awaiting_code_approval: ["verifying", "failed", "rejected"],
  verifying: ["passed", "failed", "rejected"],
  passed: [],
  failed: [],
  rejected: [],
};

/** States that may only be reached once a plan exists. */
export const PLAN_REQUIRED_STATUSES = [
  "coding",
  "awaiting_code_approval",
  "verifying",
  "passed",
] as const satisfies readonly WorkflowStatus[];

export type WorkflowId = string;

export type WorkflowFailureCode =
  | "invalid_input"
  | "invalid_transition"
  | "unknown_status"
  | "plan_required"
  | "plan_not_permitted"
  | "unexpected_error";

/**
 * A failure that is safe to show to a person and to keep in a workflow
 * record: a short machine code, a sanitised message and a timestamp. It never
 * contains a stack trace, a request body or a credential.
 */
export type WorkflowFailure = {
  code: WorkflowFailureCode;
  message: string;
  at: number;
};

/** A plan produced by the planning stage, kept with the workflow. */
export type WorkflowPlan = {
  id: string;
  mode: PlanMode;
  generatedAt: number;
  plan: FeaturePlan;
};

/** One recorded movement between states. */
export type WorkflowTransition = {
  from: WorkflowStatus | null;
  to: WorkflowStatus;
  actor: WorkflowActor;
  at: number;
  note?: string;
};

/** The workflow record. A plain value with no storage attached. */
export type Workflow = {
  id: WorkflowId;
  featureRequest: string;
  status: WorkflowStatus;
  plan?: WorkflowPlan;
  failure?: WorkflowFailure;
  createdAt: number;
  updatedAt: number;
  history: readonly WorkflowTransition[];
};

/** Result shape used by every operation that can fail with a reason. */
export type WorkflowResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: WorkflowFailure };

export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return (
    typeof value === "string" &&
    (WORKFLOW_STATUSES as readonly string[]).includes(value)
  );
}

export function isWorkflowActor(value: unknown): value is WorkflowActor {
  return (
    typeof value === "string" &&
    (WORKFLOW_ACTORS as readonly string[]).includes(value)
  );
}

export function isTerminalStatus(status: WorkflowStatus): status is TerminalStatus {
  return (TERMINAL_STATUSES as readonly WorkflowStatus[]).includes(status);
}

export function allowedTransitions(from: WorkflowStatus): readonly WorkflowStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Long, key-like substrings are redacted so they never reach a record. */
const TOKEN_LIKE = /[A-Za-z0-9_-]{24,}/g;

/** Known credential shapes, redacted even when they are shorter. */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bAIza[0-9A-Za-z_-]{10,}/g, // Google API keys
  /\bsk-[0-9A-Za-z_-]{10,}/g, // model provider style keys
  /\bAKIA[0-9A-Z]{12,}/g, // AWS access key identifiers
  /\bgh[pousr]_[0-9A-Za-z]{16,}/g, // GitHub tokens
  /\bya29\.[0-9A-Za-z_-]{10,}/g, // Google OAuth tokens
  /\bBearer\s+[0-9A-Za-z._-]{10,}/gi, // bearer header values
];

export function sanitizeMessage(message: string, maxLength = 240): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  let redacted = collapsed;
  for (const pattern of CREDENTIAL_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  redacted = redacted.replace(TOKEN_LIKE, "[redacted]");
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, maxLength - 1)}…`;
}

export function isWorkflowFailure(value: unknown): value is WorkflowFailure {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.at === "number"
  );
}

/** Converts an arbitrary thrown value into a record-safe failure. */
export function toSafeFailure(
  error: unknown,
  at: number = Date.now(),
): WorkflowFailure {
  if (isWorkflowFailure(error)) return error;
  if (error instanceof Error) {
    return {
      code: "unexpected_error",
      message: sanitizeMessage(error.message) || "Unexpected workflow error.",
      at,
    };
  }
  if (typeof error === "string") {
    return {
      code: "unexpected_error",
      message: sanitizeMessage(error) || "Unexpected workflow error.",
      at,
    };
  }
  return { code: "unexpected_error", message: "Unexpected workflow error.", at };
}

export type CreateWorkflowInput = {
  id: WorkflowId;
  featureRequest: string;
  now?: number;
};

/**
 * Starts a workflow in the planning state.
 *
 * The result is a value, not a stored record: persist it yourself if you need
 * it to survive the process.
 */
export function createWorkflow(
  input: CreateWorkflowInput,
): WorkflowResult<Workflow> {
  const now = input.now ?? Date.now();
  const featureRequest = input.featureRequest.trim();

  if (input.id.trim().length === 0) {
    return {
      ok: false,
      failure: { code: "invalid_input", message: "A workflow id is required.", at: now },
    };
  }

  if (featureRequest.length === 0) {
    return {
      ok: false,
      failure: {
        code: "invalid_input",
        message: "A feature request is required.",
        at: now,
      },
    };
  }

  return {
    ok: true,
    value: {
      id: input.id,
      featureRequest,
      status: "planning",
      createdAt: now,
      updatedAt: now,
      history: [{ from: null, to: "planning", actor: "system", at: now }],
    },
  };
}

export type TransitionOptions = {
  actor: WorkflowActor;
  at?: number;
  note?: string;
  /** May only be supplied when moving to `awaiting_plan_approval`. */
  plan?: WorkflowPlan;
  /** May only be supplied when moving to `failed`. */
  failure?: WorkflowFailure;
};

/**
 * Moves a workflow to a new state, or explains why it may not.
 *
 * The input workflow is never mutated; a new value is returned.
 */
export function transition(
  workflow: Workflow,
  to: WorkflowStatus,
  options: TransitionOptions,
): WorkflowResult<Workflow> {
  const at = options.at ?? Date.now();

  if (!isWorkflowStatus(to)) {
    return {
      ok: false,
      failure: {
        code: "unknown_status",
        message: `Unknown workflow status: ${String(to)}.`,
        at,
      },
    };
  }

  if (!isWorkflowActor(options.actor)) {
    return {
      ok: false,
      failure: {
        code: "invalid_input",
        message: `Unknown workflow actor: ${String(options.actor)}.`,
        at,
      },
    };
  }

  if (!canTransition(workflow.status, to)) {
    return {
      ok: false,
      failure: {
        code: "invalid_transition",
        message: `Cannot move from ${workflow.status} to ${to}.`,
        at,
      },
    };
  }

  if (options.plan && to !== "awaiting_plan_approval") {
    return {
      ok: false,
      failure: {
        code: "plan_not_permitted",
        message: `A plan may only be attached when moving to awaiting_plan_approval, not ${to}.`,
        at,
      },
    };
  }

  if (options.failure && to !== "failed") {
    return {
      ok: false,
      failure: {
        code: "invalid_input",
        message: `A failure may only be recorded when moving to failed, not ${to}.`,
        at,
      },
    };
  }

  const plan = options.plan ?? workflow.plan;

  if ((PLAN_REQUIRED_STATUSES as readonly WorkflowStatus[]).includes(to) && !plan) {
    return {
      ok: false,
      failure: {
        code: "plan_required",
        message: `Moving to ${to} requires an approved plan.`,
        at,
      },
    };
  }

  const failure =
    to === "failed"
      ? (options.failure ?? {
          code: "unexpected_error" as const,
          message: "The workflow failed.",
          at,
        })
      : undefined;

  const next: Workflow = {
    ...workflow,
    status: to,
    plan,
    failure,
    updatedAt: at,
    history: [
      ...workflow.history,
      {
        from: workflow.status,
        to,
        actor: options.actor,
        at,
        ...(options.note ? { note: options.note } : {}),
      },
    ],
  };

  return { ok: true, value: next };
}

/** Human approval of a plan, which starts the coding stage. */
export function approvePlan(
  workflow: Workflow,
  options: { at?: number; note?: string } = {},
): WorkflowResult<Workflow> {
  return transition(workflow, "coding", {
    actor: "human",
    ...options,
  });
}

/** Human approval of the code, which starts verification. */
export function approveCode(
  workflow: Workflow,
  options: { at?: number; note?: string } = {},
): WorkflowResult<Workflow> {
  return transition(workflow, "verifying", {
    actor: "human",
    ...options,
  });
}

/** Records a failure. Only valid from a non-terminal state. */
export function failWorkflow(
  workflow: Workflow,
  failure: WorkflowFailure,
  options: { at?: number; actor?: WorkflowActor } = {},
): WorkflowResult<Workflow> {
  return transition(workflow, "failed", {
    actor: options.actor ?? "system",
    ...options,
    failure,
  });
}

/** Human rejection. The reason is stored in the transition history. */
export function rejectWorkflow(
  workflow: Workflow,
  reason: string,
  options: { at?: number; actor?: WorkflowActor } = {},
): WorkflowResult<Workflow> {
  const at = options.at ?? Date.now();
  const trimmed = reason.trim();

  if (trimmed.length === 0) {
    return {
      ok: false,
      failure: {
        code: "invalid_input",
        message: "A rejection reason is required.",
        at,
      },
    };
  }

  return transition(workflow, "rejected", {
    actor: options.actor ?? "human",
    at,
    note: sanitizeMessage(trimmed),
  });
}
