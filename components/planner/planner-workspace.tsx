"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  AlertIcon,
  CheckIcon,
  ClipboardIcon,
  CursorIcon,
  LayersIcon,
  ShieldIcon,
  SparklesIcon,
} from "@/components/icons";
import { PlanResult } from "@/components/planner/plan-result";
import { PLANNER_LIMITS, isPlanResponse, type PlanResponse } from "@/lib/planner";

type Status = "idle" | "loading" | "ready" | "error";
type ApiError = { message: string; detail?: string[] };

const examples = [
  {
    label: "Due dates",
    prompt:
      "Add due dates to tasks, highlight the ones that are overdue, and let me filter tasks by due date.",
  },
  {
    label: "Drag to reorder",
    prompt:
      "Let me reorder tasks by dragging them, and keep that order after the page reloads.",
  },
  {
    label: "Search by title",
    prompt: "Add a search box that filters tasks by title as I type, and clears back to the full list.",
  },
];

const sections = [
  { icon: ClipboardIcon, title: "Feature summary", hint: "What is being built, in two sentences." },
  { icon: LayersIcon, title: "Implementation steps", hint: "The build order, smallest useful slice first." },
  { icon: CheckIcon, title: "Acceptance criteria", hint: "Conditions that must be true when it works." },
  { icon: CursorIcon, title: "Browser verification", hint: "Actions an agent can take in a real browser." },
  { icon: ShieldIcon, title: "Expected results", hint: "What should be seen, and what should persist." },
  { icon: AlertIcon, title: "Edge cases", hint: "The inputs most likely to break the feature." },
];

function readApiError(payload: unknown): ApiError | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.error !== "string" || record.error.trim().length === 0) return null;

  const rawDetail = record.detail;
  const detail = Array.isArray(rawDetail)
    ? rawDetail.filter((entry): entry is string => typeof entry === "string")
    : typeof rawDetail === "string"
      ? [rawDetail]
      : undefined;

  return { message: record.error, detail };
}

export function PlannerWorkspace({
  configured,
  model,
  configError,
}: {
  configured: boolean;
  configError?: string;
  model?: string;
}) {
  const [feature, setFeature] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const length = feature.trim().length;
  const tooShort = length < PLANNER_LIMITS.featureMin;
  const loading = status === "loading";

  function useExample(prompt: string) {
    setFeature(prompt);
    setStatus("idle");
    setError(null);
    setResult(null);
    textareaRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    if (tooShort) {
      setError({
        message: `Describe the feature in at least ${PLANNER_LIMITS.featureMin} characters.`,
      });
      setStatus("error");
      setResult(null);
      return;
    }

    setStatus("loading");
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: feature.trim() }),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          readApiError(payload) ?? {
            message: `The planner request failed (HTTP ${response.status}).`,
          },
        );
        setStatus("error");
        return;
      }

      if (!isPlanResponse(payload)) {
        setError({
          message: "The server returned a plan that did not match the expected structure.",
        });
        setStatus("error");
        return;
      }

      setResult(payload);
      setStatus("ready");
    } catch {
      setError({
        message: "Could not reach the planner. Check your connection and try again.",
      });
      setStatus("error");
    }
  }

  return (
    <div className="space-y-5">
      <div
        className={`rounded-xl border p-4 sm:p-5 ${
          configError
            ? "border-red-500/30 bg-red-500/[0.07]"
            : configured
              ? "border-verified/25 bg-verified/[0.05]"
              : "border-attention/30 bg-attention/[0.06]"
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border ${
              configured
                ? "border-verified/30 bg-verified/10 text-verified"
                : "border-attention/30 bg-attention/10 text-attention"
            }`}
          >
            {configured ? <ShieldIcon className="size-4" /> : <AlertIcon className="size-4" />}
          </span>
          <div>
            <p
              className={`text-sm font-semibold ${
                configured ? "text-verified" : "text-attention"
              }`}
            >
              {configError ? "Provider configuration error" : configured ? "Live model configured" : "Demo mode"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted sm:text-sm">
              {configError
                ? configError
                : configured
                  ? `Requests are sent server-side to ${
                      model ?? "the configured model"
                    }. The API key stays on the server and is never sent to this page.`
                  : "No model credentials are configured on this server. Plans are generated locally from a sample template and labelled as demo output. No model call is made."}
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="hairline-card rounded-2xl p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="feature-request" className="text-sm font-semibold text-ink">
            Describe a feature
          </label>
          <span className="font-mono text-[0.65rem] text-muted">
            {length}/{PLANNER_LIMITS.featureMax}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          Plain English. What should the app do, and what must stay true?
        </p>

        <textarea
          id="feature-request"
          ref={textareaRef}
          value={feature}
          onChange={(event) => setFeature(event.target.value)}
          rows={7}
          maxLength={PLANNER_LIMITS.featureMax}
          disabled={loading}
          placeholder="e.g. Add due dates to tasks, highlight overdue ones, and let me filter by them."
          className="mt-4 w-full resize-y rounded-xl border border-hairline bg-canvas/70 p-3.5 text-sm leading-relaxed text-ink transition-colors placeholder:text-muted/50 hover:border-white/15 focus:border-verified/50 focus:outline-none disabled:opacity-60"
        />

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[0.7rem] text-muted">Try:</span>
            {examples.map((example) => (
              <button
                key={example.label}
                type="button"
                onClick={() => useExample(example.prompt)}
                disabled={loading}
                className="rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-verified/40 hover:text-ink disabled:opacity-50"
              >
                {example.label}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading || tooShort}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-verified px-4 text-sm font-semibold text-[#04110c] transition-colors hover:bg-[#4ade80] disabled:cursor-not-allowed disabled:bg-verified/40 disabled:text-[#04110c]/60"
          >
            <SparklesIcon className="size-4" />
            {loading ? "Generatingâ€¦" : "Generate plan"}
          </button>
        </div>
      </form>

      <p role="status" className="sr-only">
        {status === "loading"
          ? "Generating plan"
          : status === "ready"
            ? "Plan ready"
            : status === "error"
              ? "Plan generation failed"
              : ""}
      </p>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/[0.07] p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <AlertIcon className="mt-0.5 size-4 shrink-0 text-red-400" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-red-200">Could not generate a plan</p>
              <p className="mt-1 text-sm leading-relaxed text-red-200/80">{error.message}</p>
              {error.detail && error.detail.length > 0 && (
                <ul className="mt-2 space-y-1 font-mono text-[0.7rem] text-red-200/60">
                  {error.detail.map((item) => (
                    <li key={item}>â€” {item}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-4" aria-busy="true">
          <div className="hairline-card rounded-2xl p-5 sm:p-6">
            <div className="h-4 w-28 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
            <div className="mt-4 h-6 w-2/3 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
            <div className="mt-3 h-3 w-full animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
            <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
          </div>
          {[0, 1].map((row) => (
            <div key={row} className="rounded-xl border border-hairline bg-surface/50 p-5">
              <div className="h-3 w-40 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
              <div className="mt-4 space-y-2">
                <div className="h-3 w-full animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
                <div className="h-3 w-11/12 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-white/5 motion-reduce:animate-none" />
              </div>
            </div>
          ))}
          <p className="text-center text-xs text-muted">
            {configured
              ? "Waiting for the model. This can take a few seconds."
              : "Assembling the demo planâ€¦"}
          </p>
        </div>
      )}

      {result && status === "ready" && <PlanResult result={result} />}

      {status === "idle" && !result && (
        <div className="rounded-xl border border-hairline bg-surface/40 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            What you will get
          </p>
          <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {sections.map((section) => (
              <div key={section.title} className="flex items-start gap-2.5">
                <section.icon className="mt-0.5 size-4 shrink-0 text-verified" />
                <div>
                  <p className="text-sm font-medium text-ink">{section.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{section.hint}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}