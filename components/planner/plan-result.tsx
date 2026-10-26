"use client";

import { useState } from "react";
import type { ReactElement, ReactNode, SVGProps } from "react";
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  CursorIcon,
  LayersIcon,
  ShieldIcon,
  SparklesIcon,
} from "@/components/icons";
import { planToMarkdown, type PlanResponse } from "@/lib/planner";

type CopyState = "idle" | "copied" | "failed";

function ModeChip({ mode, model }: { mode: PlanResponse["mode"]; model?: string }) {
  const live = mode === "live";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-widest ${
        live
          ? "border-verified/30 bg-verified/10 text-verified"
          : "border-attention/30 bg-attention/10 text-attention"
      }`}
    >
      <span className={`size-1.5 rounded-full ${live ? "bg-verified" : "bg-attention"}`} />
      {live ? `Live model${model ? ` · ${model}` : ""}` : "Demo plan"}
    </span>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  tone = "default",
  children,
}: {
  icon: (props: SVGProps<SVGSVGElement>) => ReactElement;
  title: string;
  count: number;
  tone?: "default" | "warn";
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-hairline bg-surface/50 p-5">
      <div className="flex items-center gap-2.5">
        <Icon className={`size-4 ${tone === "warn" ? "text-attention" : "text-verified"}`} />
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{title}</h3>
        <span className="ml-auto rounded-full border border-hairline bg-canvas/60 px-2 py-0.5 font-mono text-[0.6rem] text-muted">
          {count}
        </span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PlanResult({ result }: { result: PlanResponse }) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const { plan, mode, model, notice } = result;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(planToMarkdown(plan, { mode, model }));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2500);
  }

  return (
    <div className="space-y-5">
      <div className="hairline-card rounded-2xl p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ModeChip mode={mode} model={model} />
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-white/20 hover:text-ink"
          >
            <CopyIcon className="size-3.5" />
            {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy as Markdown"}
          </button>
        </div>

        <h2 className="mt-5 text-balance text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          {plan.featureSummary.title}
        </h2>
        <p className="mt-2.5 text-pretty text-sm leading-relaxed text-muted">
          {plan.featureSummary.description}
        </p>

        {notice && mode === "demo" && (
          <p className="mt-5 flex items-start gap-2 rounded-lg border border-attention/25 bg-attention/[0.07] px-3 py-2.5 text-xs leading-relaxed text-attention">
            <AlertIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{notice}</span>
          </p>
        )}
      </div>

      <Section icon={LayersIcon} title="Implementation steps" count={plan.implementationSteps.length}>
        <ol className="space-y-4">
          {plan.implementationSteps.map((step, index) => (
            <li key={`${index}-${step.title}`} className="flex gap-3">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-hairline bg-canvas/70 font-mono text-[0.65rem] text-verified">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section icon={CheckIcon} title="Acceptance criteria" count={plan.acceptanceCriteria.length}>
        <ul className="space-y-2.5">
          {plan.acceptanceCriteria.map((item) => (
            <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/90">
              <span className="mt-1 grid size-4 shrink-0 place-items-center rounded-[4px] border border-white/20 bg-canvas/60" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        icon={CursorIcon}
        title="Browser verification steps"
        count={plan.browserVerificationSteps.length}
      >
        <ol className="space-y-2.5">
          {plan.browserVerificationSteps.map((step, index) => (
            <li key={`${index}-${step}`} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/90">
              <span className="mt-0.5 font-mono text-[0.7rem] text-muted">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section icon={ShieldIcon} title="Expected results" count={plan.expectedResults.length}>
          <ul className="space-y-2.5">
            {plan.expectedResults.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/90">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-verified" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section icon={AlertIcon} title="Edge cases" count={plan.edgeCases.length} tone="warn">
          <ul className="space-y-2.5">
            {plan.edgeCases.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-ink/90">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-attention" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <p className="flex items-center justify-center gap-2 pt-1 text-xs text-muted">
        <SparklesIcon className="size-3.5" />
        A plan is a proposal. Nothing was executed, edited or verified by this page.
      </p>
    </div>
  );
}