"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertIcon,
  CheckIcon,
  CrossIcon,
  LayersIcon,
  ShieldIcon,
  SparklesIcon,
} from "@/components/icons";
import { PlanResult } from "@/components/planner/plan-result";
import type { PlanResponse } from "@/lib/planner";
import type { WorkflowStatus } from "@/lib/workflow";

export type WorkflowView = {
  id: string;
  featureRequest: string;
  status: WorkflowStatus;
  plan?: {
    id: string;
    mode: "live" | "demo";
    generatedAt: number;
    plan: PlanResponse["plan"];
  };
  failure?: { code: string; message: string; at: number };
  createdAt: number;
  updatedAt: number;
  history: readonly {
    from: WorkflowStatus | null;
    to: WorkflowStatus;
    actor: string;
    at: number;
    note?: string;
  }[];
};

const statusLabels: Record<WorkflowStatus, string> = {
  planning: "Planning",
  awaiting_plan_approval: "Awaiting plan approval",
  coding: "Coding",
  awaiting_code_approval: "Awaiting code approval",
  verifying: "Verifying",
  passed: "Passed",
  failed: "Failed",
  rejected: "Rejected",
};

const statusTone: Record<WorkflowStatus, string> = {
  planning: "border-hairline bg-canvas/60 text-muted",
  awaiting_plan_approval: "border-attention/30 bg-attention/10 text-attention",
  coding: "border-verified/30 bg-verified/10 text-verified",
  awaiting_code_approval: "border-attention/30 bg-attention/10 text-attention",
  verifying: "border-verified/30 bg-verified/10 text-verified",
  passed: "border-verified/30 bg-verified/10 text-verified",
  failed: "border-red-500/30 bg-red-500/10 text-red-300",
  rejected: "border-white/15 bg-white/5 text-muted",
};

const historyActorLabels: Record<string, string> = {
  human: "Human",
  planning_agent: "Planning agent",
  coding_agent: "Coding agent",
  verification_agent: "Verification agent",
  system: "System",
};

function StatusChip({ status }: { status: WorkflowStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-widest ${statusTone[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {statusLabels[status]}
    </span>
  );
}

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return String(at);
  }
}

function readError(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null) return fallback;
  const record = payload as Record<string, unknown>;
  return typeof record.error === "string" && record.error.trim().length > 0
    ? record.error
    : fallback;
}

export function WorkflowReview() {
  const [workflow, setWorkflow] = useState<WorkflowView | null>(null);
  const [list, setList] = useState<WorkflowView[]>([]);
  const [feature, setFeature] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<"create" | "approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);

  const refreshList = useCallback(async () => {
    try {
      const response = await fetch("/api/workflows", { cache: "no-store" });
      if (!response.ok) return;
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null) return;
      const workflows = (payload as { workflows?: unknown }).workflows;
      if (Array.isArray(workflows)) setList(workflows as WorkflowView[]);
    } catch {
      // The list is a convenience; a failure here must not break the screen.
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (feature.trim().length < 12) {
      setError("Describe the feature in at least 12 characters.");
      return;
    }

    setPending("create");
    setError(null);

    try {
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: feature.trim() }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(readError(payload, "The workflow could not be created."));
        return;
      }

      const created = (payload as { workflow?: WorkflowView }).workflow;
      if (!created) {
        setError("The server did not return a workflow.");
        return;
      }

      setWorkflow(created);
      setFeature("");
      setReason("");
      setShowReject(false);
      await refreshList();
    } catch {
      setError("Could not reach the workflow API. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleApprove() {
    if (!workflow || pending) return;

    setPending("approve");
    setError(null);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(readError(payload, "The plan could not be approved."));
        return;
      }

      const updated = (payload as { workflow?: WorkflowView }).workflow;
      if (updated) setWorkflow(updated);
      await refreshList();
    } catch {
      setError("Could not reach the workflow API. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleReject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workflow || pending) return;

    if (reason.trim().length < 3) {
      setError("Give a rejection reason of at least 3 characters.");
      return;
    }

    setPending("reject");
    setError(null);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(readError(payload, "The plan could not be rejected."));
        return;
      }

      const updated = (payload as { workflow?: WorkflowView }).workflow;
      if (updated) setWorkflow(updated);
      setReason("");
      setShowReject(false);
      await refreshList();
    } catch {
      setError("Could not reach the workflow API. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  const approvable = workflow?.status === "awaiting_plan_approval";
  const busy = pending !== null;

  return (
    <div className="space-y-5">
      <form onSubmit={handleCreate} className="hairline-card rounded-2xl p-4 sm:p-6">
        <label htmlFor="workflow-feature" className="text-sm font-semibold text-ink">
          Start a workflow
        </label>
        <p className="mt-1 text-xs text-muted">
          The request is planned, then held for your approval. Nothing is coded in this batch.
        </p>
        <textarea
          id="workflow-feature"
          value={feature}
          onChange={(event) => setFeature(event.target.value)}
          rows={4}
          maxLength={2000}
          disabled={busy}
          placeholder="e.g. Add due dates to tasks, highlight the overdue ones, and let me filter by them."
          className="mt-4 w-full resize-y rounded-xl border border-hairline bg-canvas/70 p-3.5 text-sm leading-relaxed text-ink transition-colors placeholder:text-muted/50 hover:border-white/15 focus:border-verified/50 focus:outline-none disabled:opacity-60"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/40"
          >
            <SparklesIcon className="size-4" />
            {pending === "create" ? "Planning…" : "Create workflow"}
          </button>
        </div>
      </form>

      {error && (
        <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-4">
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
            <p className="text-sm leading-relaxed text-red-200">{error}</p>
          </div>
        </div>
      )}

      {workflow ? (
        <div className="space-y-5">
          <section className="hairline-card rounded-2xl p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <StatusChip status={workflow.status} />
              <span className="font-mono text-[0.7rem] text-muted">
                {workflow.id}
              </span>
            </div>

            <h2 className="mt-4 text-sm font-semibold uppercase tracking-[0.14em] text-muted">
              Feature request
            </h2>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-ink">
              {workflow.featureRequest}
            </p>

            {workflow.failure && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/25 bg-red-500/[0.06] px-3 py-2.5">
                <AlertIcon className="mt-0.5 size-3.5 shrink-0 text-red-400" />
                <p className="text-xs leading-relaxed text-red-200">
                  {workflow.failure.message}
                </p>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-3 border-t border-hairline/80 pt-5 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={handleApprove}
                disabled={!approvable || busy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/30 disabled:text-[#04110c]/50"
              >
                <CheckIcon className="size-4" />
                {pending === "approve" ? "Approving…" : "Approve plan"}
              </button>

              <button
                type="button"
                onClick={() => setShowReject((value) => !value)}
                disabled={!approvable || busy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CrossIcon className="size-4" />
                Reject plan
              </button>

              {!approvable && (
                <p className="text-xs text-muted sm:ml-1">
                  {workflow.status === "rejected" || workflow.status === "failed"
                    ? "This workflow has ended, so it can no longer be approved or rejected."
                    : "Only a workflow awaiting plan approval can be approved or rejected."}
                </p>
              )}
            </div>

            {showReject && approvable && (
              <form onSubmit={handleReject} className="mt-4 rounded-xl border border-hairline bg-canvas/50 p-4">
                <label htmlFor="reject-reason" className="text-sm font-semibold text-ink">
                  Why are you rejecting this plan?
                </label>
                <p className="mt-1 text-xs text-muted">A reason is required and is kept in the workflow history.</p>
                <textarea
                  id="reject-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  disabled={busy}
                  placeholder="e.g. The plan does not cover what happens to a task that is already overdue."
                  className="mt-3 w-full resize-y rounded-lg border border-hairline bg-canvas/80 p-3 text-sm leading-relaxed text-ink transition-colors placeholder:text-muted/50 focus:border-attention/60 focus:outline-none disabled:opacity-60"
                />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowReject(false);
                      setReason("");
                    }}
                    disabled={busy}
                    className="h-9 rounded-lg border border-hairline px-3 text-xs text-muted transition-colors hover:text-ink disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-40"
                  >
                    <CrossIcon className="size-3.5" />
                    {pending === "reject" ? "Rejecting…" : "Confirm rejection"}
                  </button>
                </div>
              </form>
            )}

            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Approving moves the workflow to <strong className="text-ink">coding</strong> and
                records the approval. It does not run a coding agent, edit any files or verify
                anything in this batch.
              </span>
            </p>
          </section>

          {workflow.plan && (
            <PlanResult
              result={{
                mode: workflow.plan.mode,
                model: undefined,
                plan: workflow.plan.plan,
                notice:
                  workflow.plan.mode === "demo"
                    ? "This workflow was planned in demo mode: no model credentials are configured, so the plan was generated locally from a sample template. No model was called."
                    : undefined,
              }}
            />
          )}

          <section className="rounded-xl border border-hairline bg-surface/50 p-5">
            <div className="flex items-center gap-2.5">
              <LayersIcon className="size-4 text-verified" />
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                History
              </h3>
              <span className="ml-auto rounded-full border border-hairline bg-canvas/60 px-2 py-0.5 font-mono text-[0.6rem] text-muted">
                {workflow.history.length}
              </span>
            </div>
            <ol className="mt-4 space-y-3">
              {workflow.history.map((entry, index) => (
                <li key={`${entry.to}-${index}`} className="flex gap-3">
                  <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-hairline bg-canvas/70 font-mono text-[0.65rem] text-verified">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {entry.from ? `${statusLabels[entry.from]} → ` : "Created as "}
                      {statusLabels[entry.to]}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {historyActorLabels[entry.actor] ?? entry.actor} · {formatTime(entry.at)}
                    </p>
                    {entry.note && (
                      <p className="mt-1 rounded-lg border border-hairline bg-canvas/60 px-2.5 py-1.5 text-xs leading-relaxed text-muted">
                        {entry.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : (
        <div className="rounded-xl border border-hairline bg-surface/40 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            No workflow selected
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Create a workflow above to plan a feature and approve or reject the result. Previous
            workflows are listed below.
          </p>
        </div>
      )}

      {list.length > 0 && (
        <section className="rounded-xl border border-hairline bg-surface/50 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Stored workflows
          </h3>
          <ul className="mt-4 space-y-2">
            {list.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-hairline bg-canvas/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0 truncate text-sm text-ink">{item.featureRequest}</span>
                <span className="flex items-center gap-2">
                  <StatusChip status={item.status} />
                  <button
                    type="button"
                    onClick={() => {
                      setWorkflow(item);
                      setError(null);
                      setShowReject(false);
                    }}
                    disabled={busy}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:text-ink disabled:opacity-40"
                  >
                    Open
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
