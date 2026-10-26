import type { Metadata } from "next";
import Link from "next/link";
import { AlertIcon, ArrowLeftIcon, LayersIcon, ShieldIcon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { PlannerWorkspace } from "@/components/planner/planner-workspace";
import { getPlannerConfig } from "@/lib/planner-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Feature planner — StateSleuth",
  description:
    "Describe a feature in plain English and get a structured plan: implementation steps, acceptance criteria, browser verification steps, expected results and edge cases.",
};

const notes = [
  {
    icon: ShieldIcon,
    title: "Server-side only",
    body: "Any model call happens in a route handler. The key is read from the server environment and never reaches the browser.",
  },
  {
    icon: LayersIcon,
    title: "Validated structure",
    body: "The response is parsed and checked against the plan schema before it is shown. A malformed answer is an error, not a plan.",
  },
  {
    icon: AlertIcon,
    title: "Nothing is executed",
    body: "This phase produces plans only. No files are edited, no shell runs, and no fix is applied.",
  },
];

export default function PlannerPage() {
  const config = getPlannerConfig();

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
            Phase 3 · feature planner
          </p>

          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            A plan you can verify, not just read.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-muted">
            Describe a feature in plain English. The planner turns it into implementation
            steps, acceptance criteria, browser verification steps, expected results and edge
            cases — the shape the verification agent will work from.
          </p>

          <div className="mt-10">
            <PlannerWorkspace
              configured={config.configured}
              model={config.configured ? config.model : undefined}
              configError={config.configError}
            />
          </div>

          <div className="mt-12 grid gap-6 border-t border-white/5 pt-8 sm:grid-cols-3">
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
          <span>StateSleuth · feature planner</span>
          <span className="font-mono text-[0.7rem] text-muted/70">
            plans only · no execution · no keys in the browser
          </span>
        </div>
      </footer>
    </div>
  );
}