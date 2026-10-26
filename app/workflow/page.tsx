import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, ArrowLeftIcon, ShieldIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { WorkflowReview } from "@/components/workflow/workflow-review";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workflow review — StateSleuth",
  description:
    "Create a workflow from a feature request, review the generated plan, and approve or reject it. Approval advances the workflow; it does not execute code.",
};

const notes = [
  {
    icon: ShieldIcon,
    title: "Server decides the state",
    body: "Every status change is computed on the server from the stored workflow. A client cannot ask for a status it likes.",
  },
  {
    icon: AlertIcon,
    title: "Honest failures",
    body: "If the model provider fails, the workflow records the failure. No demo plan is quietly substituted for a live failure.",
  },
];

export default function WorkflowPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-canvas/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center justify-between px-5 sm:px-8">
          <Logo />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink sm:text-sm"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to overview
          </Link>
        </div>
      </header>

      <main className="relative flex-1">
        <div
          className="absolute inset-x-0 top-0 h-[26rem] hero-glow opacity-60"
          aria-hidden="true"
        />
        <div className="relative mx-auto w-full max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
          <p className="mb-4 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
            <span className="h-px w-6 bg-verified/60" aria-hidden="true" />
            Phase 4 · workflow review
          </p>

          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            A human approves every step.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-muted">
            Describe a feature, review the plan the planner produced, then approve it or reject it
            with a reason. The workflow keeps a record of every decision.
          </p>

          <div className="mt-10">
            <WorkflowReview />
          </div>

          <div className="mt-12 grid gap-6 border-t border-white/5 pt-8 sm:grid-cols-2">
            {notes.map((note) => (
              <div key={note.title}>
                <note.icon className="size-4 text-verified" />
                <h2 className="mt-3 text-sm font-semibold text-ink">{note.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{note.body}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-5 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>StateSleuth · workflow review</span>
          <span className="font-mono text-[0.7rem] text-muted/70">
            approval only · no code execution · no keys in the browser
          </span>
        </div>
      </footer>
    </div>
  );
}