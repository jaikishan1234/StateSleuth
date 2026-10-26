import type { Metadata } from "next";
import Link from "next/link";
import { TaskBoard } from "@/components/demo/task-board";
import { ArrowLeftIcon, CheckIcon, PlugIcon, RewindIcon } from "@/components/icons";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Task board demo — StateSleuth",
  description:
    "A small task board with create, rename, complete and delete, persisted in the browser. Built as the practice surface for the StateSleuth verification agent.",
};

const notes = [
  {
    icon: PlugIcon,
    title: "Local only",
    body: "Tasks are saved in this browser's localStorage. No accounts, database or API keys.",
  },
  {
    icon: RewindIcon,
    title: "Resettable",
    body: "Reset demo clears the board so a verification run can start from a known state.",
  },
  {
    icon: CheckIcon,
    title: "Built to be driven",
    body: "Every control has an accessible name, so a future agent can find and operate it like a user.",
  },
];

export default function DemoPage() {
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
            Phase 2 · testable demo
          </p>

          <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            A task board worth verifying.
          </h1>
          <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-muted">
            Four workflows live here: create a task, rename it, mark it complete, delete it.
            Nothing is mocked, and nothing is saved to a server. This is the surface the
            verification agent will learn to drive.
          </p>

          <div className="mt-10">
            <TaskBoard />
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
          <span>StateSleuth · task board demo</span>
          <span className="font-mono text-[0.7rem] text-muted/70">
            no model calls · no backend · no keys
          </span>
        </div>
      </footer>
    </div>
  );
}