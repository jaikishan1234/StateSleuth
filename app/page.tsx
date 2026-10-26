import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRightIcon,
  BranchIcon,
  CheckIcon,
  CompassIcon,
  CrosshairIcon,
  CrossIcon,
  CursorIcon,
  DocumentIcon,
  EyeIcon,
  GavelIcon,
  LayersIcon,
  PlugIcon,
  RewindIcon,
  ShieldIcon,
  TerminalIcon,
} from "@/components/icons";
import { Logo } from "@/components/logo";

const navLinks = [
  { label: "Why verify", href: "#why" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Verdicts", href: "#verdict" },
  { label: "Roadmap", href: "#roadmap" },
];

const pillars = [
  { value: "4", label: "verification stages", note: "Plan · drive · observe · judge" },
  { value: "0", label: "self-reported passes", note: "A verdict needs evidence" },
  { value: "100%", label: "runs auditable", note: "Every step is captured" },
  { value: "Any", label: "web app surface", note: "Local dev server or preview" },
];

const selfReported = [
  "Tests written from the same misunderstanding as the code",
  "Happy paths only, edges skipped",
  "The state left behind is never inspected",
  "A green checkmark with nothing to show for it",
];

const independent = [
  "Journeys derived from the behaviour that was requested",
  "Failure paths, retries and edge cases included by default",
  "Persisted state read directly after every run",
  "Each verdict links to the evidence that produced it",
];

const steps = [
  {
    number: "01",
    title: "Understand the intent",
    icon: CompassIcon,
    body: "Read the change request and the diff, then write down what a user should be able to do — and what must never happen.",
  },
  {
    number: "02",
    title: "Drive the app",
    icon: CursorIcon,
    body: "Start the real application and behave like a person: click, type, submit, retry, abandon a flow halfway through.",
  },
  {
    number: "03",
    title: "Inspect the state",
    icon: LayersIcon,
    body: "Look past the pixels. Read the records, sessions, totals and logs the application leaves behind after the journey.",
  },
  {
    number: "04",
    title: "Issue a verdict",
    icon: GavelIcon,
    body: "Pass only when behaviour and state both match the intent. Otherwise return a failure you can reproduce in one command.",
  },
];

const capabilities = [
  {
    icon: CrosshairIcon,
    title: "Intent-first journeys",
    body: "The plan starts from the requested behaviour, not from the code that was written. That is the difference between checking and agreeing.",
  },
  {
    icon: CursorIcon,
    title: "Real interface, real input",
    body: "The agent interacts with the rendered application the way a user does, so styling bugs, dead buttons and broken submits surface.",
  },
  {
    icon: LayersIcon,
    title: "State assertions",
    body: "Observable behaviour is only half the story. StateSleuth asserts what persists after the run — including what should not have.",
  },
  {
    icon: RewindIcon,
    title: "Reproducible evidence",
    body: "Every run keeps its steps, screenshots and state snapshots, so a failure can be replayed instead of argued about.",
  },
  {
    icon: PlugIcon,
    title: "Framework agnostic",
    body: "If it runs in a browser, it can be verified. No framework-specific test suites to maintain, no fixtures to keep in sync.",
  },
  {
    icon: DocumentIcon,
    title: "A report a human can read",
    body: "Expected versus observed, in plain language, with the evidence attached. Reviewers should not need to read a test file.",
  },
];

const roadmap = [
  {
    phase: "Phase 1",
    title: "Foundation",
    status: "Shipped" as const,
    body: "The Next.js app, the landing page that frames the idea, and the project docs.",
  },
  {
    phase: "Phase 2",
    title: "Testable demo",
    status: "In progress" as const,
    body: "A real task board with create, rename, complete and delete, persisted in the browser.",
  },
  {
    phase: "Phase 3",
    title: "Model integration",
    status: "Planned" as const,
    body: "Turn a change request into a verification plan: journeys, expectations and required state.",
  },
  {
    phase: "Phase 4",
    title: "Verification engine",
    status: "Planned" as const,
    body: "Drive applications in a browser, capture evidence, and evaluate behaviour against the intent.",
  },
  {
    phase: "Phase 5",
    title: "Repair loop",
    status: "Planned" as const,
    body: "Propose a fix, re-run the same journeys, and only accept the change when the evidence holds.",
  },
];

const checks = [
  {
    label: "Checkout with an expired card",
    detail: "Rejected, cart preserved, error copy actionable",
    ok: true,
  },
  {
    label: "Session state after failed payment",
    detail: "Cart items and totals unchanged",
    ok: true,
  },
  {
    label: "Retry after updating the card",
    detail: "Order total recalculated to $0.00",
    ok: false,
  },
];

function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="mb-4 inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
      <span className="h-px w-6 bg-verified/60" aria-hidden="true" />
      {children}
    </p>
  );
}

function ReportCard() {
  return (
    <div className="hairline-card relative rounded-2xl p-4 sm:p-5">
      <div
        className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-verified/20 to-transparent opacity-40 blur"
        aria-hidden="true"
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-3 border-b border-hairline/80 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="live-dot size-2 rounded-full bg-verified" aria-hidden="true" />
            <span className="font-mono text-xs tracking-tight text-muted">
              run_7f2c · checkout
            </span>
          </div>
          <span className="rounded-full border border-attention/30 bg-attention/10 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-attention">
            Needs review
          </span>
        </div>

        <ul className="divide-y divide-hairline/60">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-3 py-3.5">
              <span
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border ${
                  check.ok
                    ? "border-verified/30 bg-verified/10 text-verified"
                    : "border-attention/30 bg-attention/10 text-attention"
                }`}
              >
                {check.ok ? (
                  <CheckIcon className="size-3.5" />
                ) : (
                  <CrossIcon className="size-3.5" />
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{check.label}</span>
                <span className="mt-0.5 block truncate text-xs text-muted">{check.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-hairline/80 pt-4">
          <p className="text-xs text-muted">
            <span className="text-ink">1 of 3 checks failed</span> · evidence attached
          </p>
          <span className="font-mono text-[0.7rem] text-muted">2.4s</span>
        </div>
      </div>
    </div>
  );
}

function TerminalStrip() {
  return (
    <div className="hairline-card overflow-hidden rounded-xl">
      <div className="flex items-center gap-1.5 border-b border-hairline/70 px-4 py-2.5">
        <span className="size-2 rounded-full bg-white/10" aria-hidden="true" />
        <span className="size-2 rounded-full bg-white/10" aria-hidden="true" />
        <span className="size-2 rounded-full bg-white/10" aria-hidden="true" />
        <span className="ml-2 font-mono text-[0.7rem] text-muted">verification.log</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[0.72rem] leading-relaxed text-muted sm:text-xs">
        <code>
          <span className="text-verified">$</span>{" "}
          <span className="text-ink">statesleuth verify</span>{" "}
          <span>&quot;expired card must not charge&quot;</span>
          {"\n"}
          <span className="text-verified">›</span> plan     3 journeys derived from intent{"\n"}
          <span className="text-verified">›</span> execute  driving /checkout in a real browser{"\n"}
          <span className="text-verified">›</span> observe  order rejected · cart intact · toast shown{"\n"}
          <span className="text-attention">✗</span> verdict  failed — total recalculated to $0.00
        </code>
      </pre>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-canvas/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
          <Link
            href="/demo"
            className="text-sm text-muted transition-colors hover:text-ink"
          >
            Live demo
          </Link>
        </nav>
        <a
          href="#how-it-works"
          className="inline-flex items-center gap-1.5 rounded-full border border-verified/30 bg-verified/10 px-3.5 py-1.5 text-xs font-medium text-verified transition-colors hover:bg-verified/15 sm:text-sm"
        >
          See how it verifies
          <ArrowRightIcon className="size-3.5" />
        </a>
      </div>
    </header>
  );
}

export default function Home() {
  return (
    <div id="top">
      <Header />

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 grid-backdrop" aria-hidden="true" />
          <div className="absolute inset-x-0 top-0 h-[38rem] hero-glow" aria-hidden="true" />

          <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-16 sm:px-8 sm:pt-24">
            <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
              <div className="rise">
                <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-elevated/70 px-3 py-1 text-[0.7rem] font-medium uppercase tracking-[0.14em] text-muted">
                  <span className="live-dot size-1.5 rounded-full bg-verified" aria-hidden="true" />
                  Built for the Openfire hackathon
                </span>

                <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[3.6rem]">
                  Ship code that can
                  <span className="bg-gradient-to-r from-verified to-[#7dd3fc] bg-clip-text text-transparent">
                    {" "}
                    prove it works
                  </span>
                  .
                </h1>

                <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
                  StateSleuth is a coding agent that independently verifies application
                  behaviour. It drives your app the way a real user would, inspects the state
                  it leaves behind, and refuses to call a task done until the evidence matches
                  the intent.
                </p>

                <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link
                    href="/demo"
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-verified px-5 py-3 text-sm font-semibold text-[#04110c] transition-transform hover:-translate-y-0.5 hover:bg-[#4ade80]"
                  >
                    Open the live demo
                    <ArrowRightIcon className="size-4" />
                  </Link>
                  <a
                    href="#how-it-works"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-hairline bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-white/20 hover:bg-elevated"
                  >
                    See how it verifies
                  </a>
                </div>

                <p className="mt-6 text-xs text-muted/80">
                  Phase 2 · a real task board, deliberately imperfect.
                </p>
              </div>

              <div className="rise lg:pl-4" style={{ animationDelay: "120ms" }}>
                <ReportCard />
              </div>
            </div>
          </div>
        </section>

        {/* Pillars */}
        <section aria-label="Principles" className="border-y border-white/5 bg-surface/40">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-6 gap-y-8 px-5 py-10 sm:px-8 lg:grid-cols-4">
            {pillars.map((pillar) => (
              <div key={pillar.label}>
                <p className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
                  {pillar.value}
                </p>
                <p className="mt-1 text-sm font-medium text-ink/90">{pillar.label}</p>
                <p className="mt-0.5 text-xs text-muted">{pillar.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Why verify */}
        <section id="why" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="max-w-2xl">
            <Kicker>The problem</Kicker>
            <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              An agent grading its own homework is not verification.
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted">
              Autonomous coding fails in a predictable place: the agent decides the work is
              done. It writes a test around its own assumptions, watches it pass, and moves on.
              The application and the belief about the application drift apart quietly.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border border-hairline bg-surface/60 p-6 sm:p-7">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-muted">
                  <EyeIcon className="size-4" />
                </span>
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted">
                  Self-reported testing
                </h3>
              </div>
              <ul className="mt-6 space-y-3.5">
                {selfReported.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-muted">
                    <CrossIcon className="mt-0.5 size-4 shrink-0 text-white/25" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-verified/25 bg-gradient-to-b from-verified/[0.07] to-transparent p-6 sm:p-7">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg border border-verified/30 bg-verified/10 text-verified">
                  <ShieldIcon className="size-4" />
                </span>
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-verified">
                  Independent verification
                </h3>
              </div>
              <ul className="mt-6 space-y-3.5">
                {independent.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-ink/90">
                    <CheckIcon className="mt-0.5 size-4 shrink-0 text-verified" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section
          id="how-it-works"
          className="border-y border-white/5 bg-surface/30"
        >
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div className="max-w-2xl">
                <Kicker>The loop</Kicker>
                <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                  Four stages. One honest answer.
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-muted">
                StateSleuth does not trust the change it is reviewing — including the change it
                wrote itself.
              </p>
            </div>

            <ol className="mt-12 grid gap-1 sm:grid-cols-2 lg:grid-cols-4 lg:gap-0">
              {steps.map((step, index) => (
                <li
                  key={step.number}
                  className={`relative border-hairline py-6 lg:px-6 lg:py-0 ${
                    index === 0 ? "lg:pl-0" : ""
                  } ${index === steps.length - 1 ? "lg:pr-0" : ""} ${
                    index > 0 ? "border-t lg:border-l lg:border-t-0" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 lg:block">
                    <step.icon className="size-5 text-verified" />
                    <span className="font-mono text-xs text-muted lg:mt-5 lg:block">
                      {step.number}
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-ink lg:mt-2">{step.title}</h3>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{step.body}</p>
                </li>
              ))}
            </ol>

            <div className="mt-14 grid items-start gap-8 lg:grid-cols-[0.85fr_1.15fr]">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted">
                  <TerminalIcon className="size-4" />
                  One command
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  A run is a single, repeatable command. The same journeys can be replayed by a
                  reviewer, on CI, or by the agent after it attempts a fix.
                </p>
              </div>
              <TerminalStrip />
            </div>
          </div>
        </section>

        {/* Verdict */}
        <section id="verdict" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <div>
              <Kicker>The output</Kicker>
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                The verdict is the product.
              </h2>
              <p className="mt-4 text-pretty leading-relaxed text-muted">
                A verdict is not a status badge. It is a claim about intended behaviour, paired
                with the evidence that supports or contradicts it. If it cannot be argued with,
                it is not a verdict.
              </p>

              <dl className="mt-8 space-y-5">
                {[
                  {
                    term: "Expected",
                    detail: "What a user should be able to do, restated in plain language.",
                  },
                  {
                    term: "Observed",
                    detail: "What actually happened when the app was driven for real.",
                  },
                  {
                    term: "State",
                    detail: "What persisted afterwards — and anything that should not have.",
                  },
                  {
                    term: "Reproduce",
                    detail: "The steps and inputs needed to see it again, first try.",
                  },
                ].map((item) => (
                  <div key={item.term} className="border-l border-hairline pl-4">
                    <dt className="text-sm font-semibold text-ink">{item.term}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted">{item.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="lg:pt-10">
              <div className="hairline-card rounded-2xl p-5 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-full border border-attention/30 bg-attention/10 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-attention">
                    <CrossIcon className="size-3" />
                    Failed
                  </span>
                  <span className="font-mono text-[0.7rem] text-muted">intent_3 · retry flow</span>
                </div>

                <h3 className="mt-5 text-lg font-semibold leading-snug text-ink">
                  Retrying payment after a declined card must charge the correct amount.
                </h3>

                <div className="mt-6 space-y-4 text-sm">
                  <div>
                    <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
                      expected
                    </p>
                    <p className="mt-1.5 text-ink/90">
                      Order total stays $48.00 and the retry succeeds.
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
                      observed
                    </p>
                    <p className="mt-1.5 text-ink/90">
                      Retry succeeded, but the total was recalculated to $0.00.
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
                      state
                    </p>
                    <div className="mt-2 overflow-hidden rounded-lg border border-hairline">
                      <p className="flex items-center justify-between gap-3 border-b border-hairline/70 bg-canvas/60 px-3 py-2 font-mono text-[0.72rem]">
                        <span className="text-muted">order.total</span>
                        <span className="text-attention">0.00 ≠ 48.00</span>
                      </p>
                      <p className="flex items-center justify-between gap-3 bg-canvas/60 px-3 py-2 font-mono text-[0.72rem]">
                        <span className="text-muted">payment.captured</span>
                        <span className="text-verified">true</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 border-t border-hairline/80 pt-4 text-xs text-muted">
                  <BranchIcon className="size-3.5" />
                  <span className="font-mono">statesleuth replay run_7f2c</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section className="border-y border-white/5 bg-surface/30">
          <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
            <div className="max-w-2xl">
              <Kicker>Principles</Kicker>
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                What verification means here.
              </h2>
            </div>

            <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {capabilities.map((capability) => (
                <div key={capability.title}>
                  <capability.icon className="size-5 text-verified" />
                  <h3 className="mt-4 text-base font-semibold text-ink">{capability.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{capability.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Roadmap */}
        <section id="roadmap" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Kicker>Roadmap</Kicker>
              <h2 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
                Built deliberately, one phase at a time.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-muted">
              A roadmap is a promise, not a changelog. Only the phases marked shipped or in
              progress exist in this repository today.
            </p>
          </div>

          <ol className="mt-12 space-y-3">
            {roadmap.map((item) => {
              const live = item.status !== "Planned";
              return (
                <li
                  key={item.phase}
                  className={`flex flex-col gap-3 rounded-xl border px-5 py-5 sm:flex-row sm:items-center sm:gap-6 ${
                    live
                      ? "border-verified/25 bg-verified/[0.04]"
                      : "border-hairline bg-surface/50"
                  }`}
                >
                  <span
                    className={`w-20 shrink-0 font-mono text-xs uppercase tracking-widest ${
                      live ? "text-verified" : "text-muted/70"
                    }`}
                  >
                    {item.phase}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{item.body}</p>
                  </div>
                  <span
                    className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-widest ${
                      live
                        ? "border-verified/30 bg-verified/10 text-verified"
                        : "border-hairline bg-canvas/60 text-muted"
                    }`}
                  >
                    {item.status === "Shipped" ? (
                      <CheckIcon className="size-3" />
                    ) : (
                      <span
                        className={`size-1.5 rounded-full bg-current ${
                          live ? "" : "opacity-60"
                        }`}
                      />
                    )}
                    {item.status}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Closing */}
        <section className="relative overflow-hidden border-t border-white/5">
          <div className="absolute inset-x-0 bottom-0 h-64 hero-glow opacity-70" aria-hidden="true" />
          <div className="relative mx-auto w-full max-w-6xl px-5 py-20 text-center sm:px-8 sm:py-24">
            <h2 className="mx-auto max-w-2xl text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Trust the evidence, not the checkmark.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty leading-relaxed text-muted">
              StateSleuth is being built in the open for the Openfire hackathon. There is a real
              task board to drive today; the verification engine comes next.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/demo"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-verified px-5 py-3 text-sm font-semibold text-[#04110c] transition-transform hover:-translate-y-0.5 hover:bg-[#4ade80]"
              >
                Open the live demo
                <ArrowRightIcon className="size-4" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-hairline bg-surface px-5 py-3 text-sm font-medium text-ink transition-colors hover:border-white/20 hover:bg-elevated"
              >
                Explore the verification loop
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/5 bg-canvas">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="text-xs text-muted">
              A coding agent that independently verifies application behaviour.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
            <span>Openfire hackathon · 2026</span>
            <span className="hidden text-white/15 sm:inline" aria-hidden="true">
              /
            </span>
            <span>Phase 2 · testable demo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}