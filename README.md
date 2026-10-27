# StateSleuth

**A coding-verification prototype: don't just trust the code. Verify
that it works.**

StateSleuth is a standalone Next.js application built for the Openfire
hackathon. It explores a safer development workflow in which AI can help
plan and propose code changes, humans approve consequential decisions,
and an independent browser verifier checks what the running application
actually does.

> StateSleuth is a standalone web application, not an Openfire plugin.

## Demo

-   **Demo video:**
    <https://drive.google.com/file/d/1Ow4wopgkxQNd48ifVd7oKjh_zXB_yGJR/view?usp=drive_link>
-   **GitHub repository:**
    <https://github.com/jaikishan1234/StateSleuth>

## The problem

AI-generated code can look convincing and still introduce behavioral
regressions. A successful build does not prove that a feature works
correctly in the running application. A test that merely repeats the
coding agent's assumptions can miss the same bug the agent introduced.

StateSleuth focuses on observable behavior: drive the real interface,
check expected outcomes, inspect resulting state, and attach evidence to
the verdict.

## What is implemented

-   **Interactive task board** at `/demo`, including create, rename,
    complete, delete, filtering, reset, and browser-local persistence.
-   **AI-assisted feature planner** at `/planner`, which converts a
    plain-English request into a structured plan with implementation
    steps, acceptance criteria, browser checks, expected results, and
    edge cases.
-   **Multiple model providers** through OpenAI-compatible HTTP
    requests: Gemini, Groq, and OpenRouter, with planner and
    coding-agent configuration resolved independently.
-   **Human approval gates** for workflow plans and proposed code
    changes.
-   **Coding-proposal workflow** that validates proposed unified diffs
    before they can be considered for application.
-   **Guarded patch application** with path allowlisting, stale-file
    checks, and rollback-oriented safeguards.
-   **Playwright verification** that drives the task-board journey,
    evaluates expected behavior, records a verdict, and captures
    screenshot evidence.
-   **Explicit live-versus-fixture labeling**. A failed configured
    provider request is reported as an error rather than silently
    replaced by demo output.

## The demo bug

The task board contains one deliberately planted regression for the
verifier to detect:

1.  Create a task.
2.  Mark it complete.
3.  Rename it.
4.  Observe that the completed state resets and the completion counter
    changes.

The Playwright verification journey reproduces the issue, records a
failed verdict, and captures screenshot evidence. This defect is
intentional for the hackathon demonstration; do not fix it before
recording the intended verification demo.

## Workflow concept

1.  A developer describes a feature or bug.
2.  The planner proposes an implementation plan and verification
    criteria.
3.  A human approves or rejects the plan.
4.  The coding agent proposes a diff.
5.  A human separately approves or rejects the code proposal.
6.  The verifier runs browser checks against the application.
7.  StateSleuth records the verdict and available evidence.

**Honest status:** the workflow and verification foundation are
implemented, and live AI planning has worked. Provider availability and
malformed or truncated model output can still affect live requests. The
complete end-to-end live path from generated code through approval,
application, verification, and automatic repair has not yet been
demonstrated reliably. The automatic repair-and-retest loop remains in
progress.

## Technology stack

-   Next.js App Router
-   React
-   TypeScript
-   Tailwind CSS v4
-   Node.js server routes and workflow services
-   Playwright for browser verification
-   OpenAI-compatible model-provider APIs

## Project routes

  -----------------------------------------------------------------------
  Route                               Purpose
  ----------------------------------- -----------------------------------
  `/`                                 Landing page and project overview

  `/demo`                             Interactive task board with
                                      browser-local persistence

  `/planner`                          Feature planner (live model or
                                      explicitly labelled demo mode)

  `/workflow`                         Human-approved workflow and
                                      verification results
  -----------------------------------------------------------------------

## Local setup

### Prerequisites

-   Node.js 20.9 or newer (the project has been developed on Node 24)
-   npm 10 or newer
-   Google Chrome for the configured browser-verification tests
-   Optional: an API key for a supported model provider

### Install and run

``` bash
npm install
npm run dev:local
```

Use the local URL printed by Next.js. The local-only script is intended
to bind the development server to `127.0.0.1`.

The app can run without model credentials in clearly labelled
demo/fixture modes. For live planning or code proposals, configure the
relevant provider credentials.

## Environment configuration

Start from `.env.example` and put local secrets in `.env.local`. Never
commit provider keys or expose them through `NEXT_PUBLIC_*` variables.

Common configuration keys include:

  -----------------------------------------------------------------------
  Setting                             Purpose
  ----------------------------------- -----------------------------------
  `PLANNER_PROVIDER` /                Select providers independently for
  `CODING_PROVIDER`                   each agent

  `PLANNER_MODEL` / `CODING_MODEL`    Model identifier for each agent

  `PLANNER_BASE_URL` /                Optional OpenAI-compatible API base
  `CODING_BASE_URL`                   URL

  `PLANNER_API_KEY` /                 Optional agent-specific credentials
  `CODING_API_KEY`                    

  `GEMINI_API_KEY`                    Gemini provider credential

  `GROQ_API_KEY`                      Groq provider credential

  `OPENROUTER_API_KEY`                OpenRouter provider credential

  `MODEL_PROVIDER`                    Shared provider fallback

  `MODEL_API_KEY`                     Shared API-key fallback

  `PLANNER_MAX_OUTPUT_TOKENS`         Planner output budget

  `CODING_MAX_OUTPUT_TOKENS`          Coding-agent output budget

  `PLANNER_TIMEOUT_MS`                Planner request timeout
  -----------------------------------------------------------------------

Agent-specific settings take precedence over shared fallbacks. Use the
exact variable names and supported values in `.env.example` and
`lib/provider-config.ts`. A configured provider failure is surfaced as
an error; it is not silently converted to a fixture result.

## Useful commands

  Command                  Purpose
  ------------------------ ------------------------------------------------
  `npm run dev`            Start the development server
  `npm run dev:local`      Start the development server bound to loopback
  `npm run build`          Create a production build
  `npm run start`          Serve the production build
  `npm run start:local`    Serve production on loopback
  `npm run typecheck`      Run TypeScript checks
  `npm test`               Run the test suite
  `npm run test:browser`   Run browser-verification tests

Check `package.json` for the exact scripts in the current checkout.

## Verification example

The current Playwright journey targets the included task board. It
checks that the board is ready, a task can be created and completed,
renaming preserves completion, the counter stays correct, and completion
persists after reload. The planted bug causes the
completion-preservation assertions to fail. A failure is the expected
outcome for this deliberately defective demo scenario.

This verifies the verifier's ability to detect the known regression; it
does not mean every arbitrary feature request can already be translated
into a fully autonomous browser journey.

## Safety principles

-   Plan approval and code approval are separate human decisions.
-   Proposed diffs are checked before application.
-   Patch application is restricted to permitted project paths and uses
    checks intended to prevent unsafe paths and stale-file overwrites.
-   Local-only endpoints have loopback checks, but these checks are
    safeguards, not authentication.
-   Bind the development server to loopback for this single-user local
    prototype; do not expose it directly to a network.
-   Provider failures and fixture output are labelled distinctly.
-   Keep credentials, local workflow records, and generated evidence out
    of public commits unless intentionally sanitized for publication.

## Current limitations

-   Model providers can be slow, rate-limited, unavailable, or return
    malformed/truncated output.
-   Live code-proposal generation is not reliable on every attempt.
-   Browser verification currently focuses on the included task-board
    journey rather than automatically deriving executable journeys for
    every possible plan.
-   The complete live patch-application and automatic repair-and-retest
    loop is not yet demonstrated end to end.
-   This is a hackathon prototype, not a production-ready autonomous
    coding system.

## Roadmap

-   Improve reliability and validation of structured plans and code
    proposals.
-   Expand verification journeys and connect them more directly to
    acceptance criteria.
-   Complete a safe repair-and-retest loop with explicit human approval.
-   Improve diagnostics and evidence presentation.

## Known defect (for the demo)

**Defect:** renaming a completed task clears its completion state.

-   **Location:** `lib/tasks.ts`, in `renameTask`.
-   **Expected:** renaming preserves the task's completion state and
    original creation timestamp.
-   **Actual:** the task becomes active after rename; the unchecked
    state persists after reload.
-   **Cause:** the rename operation rebuilds the task using the creation
    helper, which defaults `completed` to `false`.
-   **Scope:** the rename path; other task-board operations are not
    intended to be defective.

Reproduce it by completing a task, renaming it, and observing the
checkbox and completion counter.

## Project links

-   **Demo video:**
    <https://drive.google.com/file/d/1Ow4wopgkxQNd48ifVd7oKjh_zXB_yGJR/view?usp=drive_link>
-   **Repository:** <https://github.com/jaikishan1234/StateSleuth>
