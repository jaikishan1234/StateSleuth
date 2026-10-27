"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertIcon,
  CheckIcon,
  CrossIcon,
  CursorIcon,
  LayersIcon,
  ShieldIcon,
  SparklesIcon,
  TerminalIcon,
} from "@/components/icons";
import { PlanResult } from "@/components/planner/plan-result";
import type { PlanResponse } from "@/lib/planner";
import type { WorkflowStatus } from "@/lib/workflow";

export type ProposalView = {
  id: string;
  source: "live" | "fixture";
  model?: string;
  explanation: string;
  files: { path: string; change: "add" | "modify" | "delete"; summary: string }[];
  diff: string;
  createdAt: number;
  notice?: string;
};

export type VerificationView = {
  verdict: "passed" | "failed";
  expected: string;
  observed: string;
  steps: {
    id: string;
    label: string;
    expected: string;
    observed: string;
    passed: boolean;
    detail?: string;
  }[];
  url: string;
  checkedAt: number;
  durationMs: number;
  screenshot?: string;
};

export type WorkflowView = {
  id: string;
  featureRequest: string;
  status: WorkflowStatus;
  plan?: {
    id: string;
    mode: "live" | "demo" | "fixture";
    generatedAt: number;
    plan: PlanResponse["plan"];
  };
  proposal?: ProposalView;
  verification?: VerificationView;
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

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg border border-hairline bg-canvas/80 p-3 font-mono text-[0.7rem] leading-relaxed">
      <code>
        {diff.split("\n").map((line, index) => {
          const tone = line.startsWith("+++") || line.startsWith("---")
            ? "text-muted"
            : line.startsWith("@@")
              ? "text-[#7dd3fc]"
              : line.startsWith("+")
                ? "text-verified"
                : line.startsWith("-")
                  ? "text-red-300"
                  : "text-ink/70";
          return (
            <span key={index} className={`block whitespace-pre ${tone}`}>
              {line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}

function ProposalPanel({ proposal, diffOpen = true }: { proposal: ProposalView; diffOpen?: boolean }) {
  const isFixture = proposal.source === "fixture";

  return (
    <section className="hairline-card rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <TerminalIcon className="size-4 text-verified" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Code proposal
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-widest ${
            isFixture
              ? "border-attention/30 bg-attention/10 text-attention"
              : "border-verified/30 bg-verified/10 text-verified"
          }`}
        >
          <span className={`size-1.5 rounded-full ${isFixture ? "bg-attention" : "bg-verified"}`} />
          {isFixture ? "Deterministic fixture" : `Live model${proposal.model ? ` · ${proposal.model}` : ""}`}
        </span>
      </div>

      {proposal.notice && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-attention/25 bg-attention/[0.07] px-3 py-2.5 text-xs leading-relaxed text-attention">
          <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{proposal.notice}</span>
        </p>
      )}

      <p className="mt-4 text-sm leading-relaxed text-ink/90">{proposal.explanation}</p>

      <h3 className="mt-5 font-mono text-[0.65rem] uppercase tracking-widest text-muted">
        Affected files ({proposal.files.length})
      </h3>
      <ul className="mt-2 space-y-1.5">
        {proposal.files.map((file) => (
          <li
            key={file.path}
            className="flex flex-col gap-1 rounded-lg border border-hairline bg-canvas/50 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between"
          >
            <code className="font-mono text-[0.72rem] text-ink">{file.path}</code>
            <span className="text-[0.7rem] text-muted">
              {file.change} · {file.summary}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 font-mono text-[0.65rem] uppercase tracking-widest text-muted">
        Proposed diff
      </h3>
      <div className="mt-2">
        {diffOpen ? (
          <DiffView diff={proposal.diff} />
        ) : (
          <p className="rounded-lg border border-hairline bg-canvas/60 px-3 py-4 text-xs text-muted">
            Diff hidden. Use “Review diff” below to show it.
          </p>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
        <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>
          This diff has <strong className="text-ink">not</strong> been applied. No file was written
          and no command was run. Code approval arrives in the next batch.
        </span>
      </p>
    </section>
  );
}

function VerificationPanel({
  verification,
  workflowId,
}: {
  verification: VerificationView;
  workflowId: string;
}) {
  const failed = verification.verdict === "failed";
  const failedCount = verification.steps.filter((step) => !step.passed).length;

  return (
    <section className="hairline-card rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <CursorIcon className="size-4 text-verified" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Verification verdict
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-widest ${
            failed
              ? "border-red-500/30 bg-red-500/10 text-red-300"
              : "border-verified/30 bg-verified/10 text-verified"
          }`}
        >
          <span className={`size-1.5 rounded-full ${failed ? "bg-red-400" : "bg-verified"}`} />
          {failed
            ? `Failed · ${failedCount} of ${verification.steps.length} checks`
            : `Passed · ${verification.steps.length} checks`}
        </span>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-ink/90">
        Driven in a real browser at{" "}
        <code className="font-mono text-[0.72rem]">{verification.url}</code>, {formatTime(verification.checkedAt)}{" "}
        ({Math.round(verification.durationMs / 100) / 10}s). Read-only: no code was applied and no
        source file was written.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline bg-canvas/50 p-3">
          <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted">Expected</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink/90">{verification.expected}</p>
        </div>
        <div
          className={`rounded-lg border p-3 ${
            failed ? "border-red-500/30 bg-red-500/[0.06]" : "border-verified/25 bg-verified/[0.05]"
          }`}
        >
          <p className="font-mono text-[0.6rem] uppercase tracking-widest text-muted">Observed</p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink/90">{verification.observed}</p>
        </div>
      </div>

      <h3 className="mt-5 font-mono text-[0.65rem] uppercase tracking-widest text-muted">
        Verification steps ({verification.steps.length})
      </h3>
      <ol className="mt-2 space-y-2">
        {verification.steps.map((step) => (
          <li
            key={step.id}
            className={`rounded-lg border px-3 py-2.5 ${
              step.passed ? "border-hairline bg-canvas/40" : "border-red-500/30 bg-red-500/[0.06]"
            }`}
          >
            <div className="flex items-start gap-2">
              {step.passed ? (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-verified" />
              ) : (
                <CrossIcon className="mt-0.5 size-3.5 shrink-0 text-red-400" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{step.label}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  <span className="uppercase tracking-wide text-muted/70">expected </span>
                  {step.expected}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink/90">
                  <span className="uppercase tracking-wide text-muted/70">observed </span>
                  {step.observed}
                </p>
                {step.detail && (
                  <p className="mt-1 break-all rounded border border-hairline bg-canvas/60 px-2 py-1 font-mono text-[0.62rem] leading-relaxed text-muted">
                    {step.detail}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {verification.screenshot ? (
        <>
          <h3 className="mt-5 font-mono text-[0.65rem] uppercase tracking-widest text-muted">
            Evidence screenshot
          </h3>
          <div className="mt-2 overflow-hidden rounded-lg border border-hairline bg-canvas/60">
            {/* Local-only route; the file name comes from the stored record. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/workflows/${workflowId}/evidence?v=${verification.checkedAt}`}
              alt="Browser screenshot captured by the verification run"
              className="w-full"
            />
          </div>
          <p className="mt-1.5 font-mono text-[0.65rem] text-muted">{verification.screenshot}</p>
        </>
      ) : (
        <p className="mt-5 rounded-lg border border-hairline bg-canvas/60 px-3 py-3 text-xs text-muted">
          No screenshot was captured for this run.
        </p>
      )}
    </section>
  );
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
  const [pending, setPending] = useState<
    "create" | "approve" | "reject" | "proposal" | "code-approve" | "code-reject" | "verify" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [diffOpen, setDiffOpen] = useState(true);
  const [confirmApply, setConfirmApply] = useState(false);
  const [filesChanged, setFilesChanged] = useState<string[] | null>(null);
  const [codeReason, setCodeReason] = useState("");
  const [showCodeReject, setShowCodeReject] = useState(false);

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

  async function handleCreate(useFixture: boolean) {
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
        body: JSON.stringify({ feature: feature.trim(), fixture: useFixture }),
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
      setConfirmApply(false);
      setShowCodeReject(false);
      setCodeReason("");
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

  async function handleRequestProposal(useFixture: boolean) {
    if (!workflow || pending) return;

    setPending("proposal");
    setError(null);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixture: useFixture }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(readError(payload, "The coding proposal could not be generated."));
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

  async function handleVerify() {
    if (!workflow || pending) return;

    setPending("verify");
    setError(null);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readError(payload, "The verification run could not be completed."));
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

  async function handleApproveCode() {
    if (!workflow || pending) return;
    if (!confirmApply) {
      setError("Confirm that you understand the patch will be written to source files.");
      return;
    }

    setPending("code-approve");
    setError(null);
    setFilesChanged(null);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/code/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const detail = (payload ?? {}) as { applied?: unknown; filesChanged?: unknown };
        const changed = Array.isArray(detail.applied)
          ? detail.applied.filter((entry): entry is string => typeof entry === "string")
          : [];

        if (detail.filesChanged === true) {
          setFilesChanged(changed);
        }

        setError(readError(payload, "The code could not be approved."));

        // The server may have changed state; show what it actually recorded.
        try {
          const refreshed = await fetch(`/api/workflows/${workflow.id}`, { cache: "no-store" });
          if (refreshed.ok) {
            const fresh = (await refreshed.json()) as { workflow?: WorkflowView };
            if (fresh.workflow) setWorkflow(fresh.workflow);
          }
        } catch {
          // The error above is the important part.
        }

        await refreshList();
        return;
      }

      const updated = (payload as { workflow?: WorkflowView }).workflow;
      if (updated) setWorkflow(updated);
      setConfirmApply(false);
      await refreshList();
    } catch {
      setError("Could not reach the workflow API. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function handleRejectCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workflow || pending) return;
    if (codeReason.trim().length < 3) {
      setError("Give a rejection reason of at least 3 characters.");
      return;
    }

    setPending("code-reject");
    setError(null);

    try {
      const response = await fetch(`/api/workflows/${workflow.id}/code/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: codeReason.trim() }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(readError(payload, "The code could not be rejected."));
        return;
      }

      const updated = (payload as { workflow?: WorkflowView }).workflow;
      if (updated) setWorkflow(updated);
      setCodeReason("");
      setShowCodeReject(false);
      await refreshList();
    } catch {
      setError("Could not reach the workflow API. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  const approvable = workflow?.status === "awaiting_plan_approval";
  const canRequestProposal = workflow?.status === "coding";
  const canVerify =
    workflow?.status === "awaiting_code_approval" || workflow?.status === "verifying";
  const awaitingCode = workflow?.status === "awaiting_code_approval";
  const appliedNote =
    workflow?.status === "verifying"
      ? [...workflow.history].reverse().find((entry) => entry.note?.startsWith("Applied "))?.note
      : undefined;
  const busy = pending !== null;

  return (
    <div className="space-y-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate(false);
        }}
        className="hairline-card rounded-2xl p-4 sm:p-6"
      >
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
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => void handleCreate(true)}
            disabled={busy}
            title="Create a workflow with a deterministic test plan instead of calling the model"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-attention/30 bg-attention/10 px-4 text-sm font-medium text-attention transition-colors hover:bg-attention/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AlertIcon className="size-4" />
            Use test fixture
          </button>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/40"
          >
            <SparklesIcon className="size-4" />
            {pending === "create" ? "Planning…" : "Create workflow"}
          </button>
        </div>
        <p className="mt-2 text-right text-[0.7rem] leading-relaxed text-muted">
          “Use test fixture” skips the model and builds a deterministic test plan, labelled as a
          fixture. Nothing is generated by AI in that mode.
        </p>
      </form>

      {filesChanged && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/[0.1] p-4">
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-200">
                Source files may already have changed
              </p>
              <p className="mt-1 text-sm leading-relaxed text-red-200/80">
                The patch was written to disk but the workflow could not be updated. Inspect
                <code className="mx-1 font-mono text-[0.72rem]">git diff</code>
                before retrying or doing anything else.
              </p>
              {filesChanged.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {filesChanged.map((file) => (
                    <li key={file} className="font-mono text-[0.72rem] text-red-200/80">
                      {file}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

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

            {canRequestProposal && (
              <div className="mt-5 rounded-xl border border-hairline bg-canvas/50 p-4">
                <p className="text-sm font-semibold text-ink">Request a code proposal</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  The coding agent uses the approved plan to propose a patch. The proposal is a
                  reviewable diff only. Nothing is written to your source files.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => handleRequestProposal(false)}
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/30"
                  >
                    <TerminalIcon className="size-4" />
                    {pending === "proposal" ? "Proposing…" : "Request proposal"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRequestProposal(true)}
                    disabled={busy}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <AlertIcon className="size-4" />
                    Use test fixture
                  </button>
                </div>
              </div>
            )}

            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Approving moves the workflow to <strong className="text-ink">coding</strong> and
                records the approval. From there you can request a proposal. No file is written
                and nothing is verified in this batch.
              </span>
            </p>
          </section>

          {canVerify && (
            <section className="rounded-xl border border-verified/25 bg-verified/[0.04] p-4 sm:p-5">
              <div className="flex items-center gap-2.5">
                <CursorIcon className="size-4 text-verified" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  Browser verification
                </h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink/90">
                Opens <code className="font-mono text-[0.72rem]">/demo</code> in Chrome, drives the
                task board like a person, and records expected versus observed with a screenshot.
                The verdict decides this workflow&apos;s final state.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                This does not approve the proposal, does not apply the patch and does not write any
                source file. Running it is an alternative to applying the change, not a step after
                it.
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void handleVerify()}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/30 disabled:text-[#04110c]/50"
                >
                  <CursorIcon className="size-4" />
                  {pending === "verify" ? "Verifying in Chrome…" : "Run verification"}
                </button>
              </div>
            </section>
          )}

          {workflow.proposal && (
            <ProposalPanel proposal={workflow.proposal} diffOpen={diffOpen} />
          )}

          {workflow.verification && (
            <VerificationPanel
              verification={workflow.verification}
              workflowId={workflow.id}
            />
          )}

          {awaitingCode && workflow.proposal && (
            <section className="hairline-card rounded-2xl p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <ShieldIcon className="size-4 text-attention" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  Code approval
                </h2>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-ink/90">
                Approving <strong className="text-ink">writes these files to disk</strong>. The
                diff is revalidated immediately before it is applied, and every path must still be
                on the allowlist. Nothing runs: no shell command, no script, no verification.
              </p>

              <ul className="mt-3 space-y-1">
                {workflow.proposal.files.map((file) => (
                  <li key={file.path}>
                    <code className="font-mono text-[0.72rem] text-ink">{file.path}</code>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDiffOpen((open) => !open)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-white/20 disabled:opacity-40"
                >
                  <TerminalIcon className="size-4" />
                  {diffOpen ? "Hide diff" : "Review diff"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleApproveCode()}
                  disabled={busy || !confirmApply}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/30 disabled:text-[#04110c]/50"
                >
                  <CheckIcon className="size-4" />
                  {pending === "code-approve" ? "Applying…" : "Approve code"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowCodeReject((open) => !open)}
                  disabled={busy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-hairline bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-white/20 disabled:opacity-40"
                >
                  <CrossIcon className="size-4" />
                  Reject code
                </button>
              </div>

              <label className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-muted">
                <input
                  type="checkbox"
                  checked={confirmApply}
                  onChange={(event) => setConfirmApply(event.target.checked)}
                  disabled={busy}
                  className="mt-0.5 size-4 shrink-0 rounded border-white/20 bg-canvas/60"
                />
                <span>
                  I understand that approving writes {workflow.proposal.files.length} file(s) to
                  disk, and that this is the only change applied.
                </span>
              </label>

              {showCodeReject && (
                <form onSubmit={handleRejectCode} className="mt-4 rounded-xl border border-hairline bg-canvas/50 p-4">
                  <label htmlFor="code-reject-reason" className="text-sm font-semibold text-ink">
                    Why are you rejecting this code?
                  </label>
                  <p className="mt-1 text-xs text-muted">
                    The reason is recorded in the workflow history. No file is written.
                  </p>
                  <textarea
                    id="code-reject-reason"
                    value={codeReason}
                    onChange={(event) => setCodeReason(event.target.value)}
                    rows={3}
                    maxLength={500}
                    disabled={busy}
                    placeholder="e.g. The diff changes more than the plan asked for."
                    className="mt-3 w-full resize-y rounded-lg border border-hairline bg-canvas/80 p-3 text-sm leading-relaxed text-ink transition-colors placeholder:text-muted/50 focus:border-attention/60 focus:outline-none disabled:opacity-60"
                  />
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setShowCodeReject(false);
                        setCodeReason("");
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
                      {pending === "code-reject" ? "Rejecting…" : "Confirm rejection"}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}

          {appliedNote && (
            <section className="rounded-xl border border-verified/30 bg-verified/[0.06] p-4 sm:p-5">
              <div className="flex items-start gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-verified" />
                <div>
                  <p className="text-sm font-semibold text-verified">Code approved and applied</p>
                  <p className="mt-1 font-mono text-[0.72rem] leading-relaxed text-ink/80">
                    {appliedNote.replace(/^Applied /, "")}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    The workflow is now in <strong className="text-ink">verifying</strong>. Run
                    browser verification from this page to record a verdict.
                  </p>
                </div>
              </div>
            </section>
          )}

          {workflow.plan && (
            <PlanResult
              result={{
                mode: workflow.plan.mode,
                model: undefined,
                plan: workflow.plan.plan,
                notice:
                  workflow.plan.mode === "fixture"
                    ? "Test fixture: this plan was generated deterministically by the local fixture. No model was called, and this plan is not AI-generated."
                    : workflow.plan.mode === "demo"
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
                      setConfirmApply(false);
                      setShowCodeReject(false);
                      setCodeReason("");
                      setDiffOpen(true);
                      setFilesChanged(null);
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
