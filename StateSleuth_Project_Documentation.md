# StateSleuth --- Detailed Project Documentation

**Project:** StateSleuth\
**Context:** Openfire hackathon\
**Repository:** https://github.com/jaikishan1234/StateSleuth\
**Demo video:**
https://drive.google.com/file/d/1Ow4wopgkxQNd48ifVd7oKjh_zXB_yGJR/view?usp=drive_link\
**Document purpose:** Detailed technical and product record of the
prototype, its architecture, current capabilities, safety boundaries,
test strategy, known defect, and remaining work.

------------------------------------------------------------------------

## 1. Executive Summary

StateSleuth is a standalone Next.js application that explores a
practical question in AI-assisted software development: how can a
developer verify that an AI-assisted change works in the running
application rather than merely trusting the generated code or a
successful build?

The prototype combines four ideas:

1.  Structured AI-assisted planning.
2.  Human review before consequential workflow transitions.
3.  A coding-proposal stage that produces a diff for review rather than
    silently editing code.
4.  Independent Playwright browser verification with a recorded verdict
    and screenshot evidence.

The demo centers on a deliberately planted task-board regression:
renaming a completed task resets its completion status. A browser
journey reproduces the behavior and reports the failure. This provides a
concrete demonstration of the distinction between "the app runs" and
"the app behaves correctly."

The project has meaningful implemented foundations, but it should not be
described as a fully autonomous coding-and-repair system. Live model
requests may fail due to provider availability, rate limits, timeouts,
or malformed/truncated output. The complete live loop---AI proposal,
human approval, patch application, independent verification, automated
repair, and retest---has not been demonstrated reliably end to end.

## 2. Product Intent and Problem Statement

### 2.1 The problem

AI coding tools can generate code that looks plausible and may compile
while violating an important behavioral requirement. The risk increases
when the coding system also chooses the tests used to judge its own
work: its assumptions can be reflected in both the implementation and
the test.

Examples of behavior that a build alone cannot establish include:

-   Whether a completed task stays complete after being renamed.
-   Whether state persists after reload.
-   Whether counters match the visible records.
-   Whether cancellation and error paths preserve the intended state.
-   Whether an operation has side effects beyond its visible UI change.

StateSleuth emphasizes independent observation of the running
application and evidence that helps a developer reproduce the failure.

### 2.2 Product principle

**A change should not be treated as verified until the running
application demonstrates the requested behavior.**

A verification result should communicate:

-   What behavior was expected.
-   What action the browser performed.
-   What was observed.
-   Which assertion passed or failed.
-   What evidence was captured.
-   Whether the final verdict passed or failed.

### 2.3 Intended audience

The prototype is aimed at developers experimenting with AI-assisted
implementation workflows who want an explicit review boundary and a
browser-based check of behavior. It is not positioned as a
production-ready autonomous engineering system.

## 3. Demo and Repository

-   **Demo video:**
    https://drive.google.com/file/d/1Ow4wopgkxQNd48ifVd7oKjh_zXB_yGJR/view?usp=drive_link
-   **GitHub repository:** https://github.com/jaikishan1234/StateSleuth

The demo video should be used to understand the demonstrated product
journey. The repository and its current source code remain the authority
for implementation details.

## 4. User Journey and Workflow

### 4.1 High-level sequence

1.  A user describes a feature request or bug.
2.  The planner produces a structured plan.
3.  The user approves or rejects the plan.
4.  The coding agent proposes a unified diff.
5.  The user separately approves or rejects the code proposal.
6.  The workflow enters verification.
7.  Playwright drives the supported browser journey.
8.  The verifier records a verdict and available screenshot evidence.
9.  A developer reviews the evidence and decides what to do next.

### 4.2 Human-in-the-loop boundaries

Plan approval and code approval are separate decisions. A plan being
approved does not mean its proposed code is approved. A generated diff
is not automatically applied simply because it was generated. The
workflow has explicit states and transition guards so that consequential
steps require the intended human decision.

### 4.3 Current end-to-end limitation

The workflow states, approval boundaries, coding proposal handling,
guarded patch application, and browser verifier exist as implementation
components. However, provider reliability prevents every live request
from succeeding, and the complete live chain through a generated
proposal, human code approval, patch application, verification,
automatic repair, and retest has not been proven end to end. The
automatic repair loop is still a roadmap item.

## 5. Application Pages and Routes

### 5.1 Landing page --- `/`

The landing page introduces the product concept and directs users to the
task demo and planner. Its roadmap should reflect the implementation
accurately: the browser verification foundation is implemented, while
the complete repair loop remains in progress.

### 5.2 Task board --- `/demo`

The task board is the controlled environment for the verification
demonstration. It supports:

-   Creating a task.
-   Renaming a task.
-   Marking a task complete or active.
-   Deleting a task.
-   Filtering between all, active, and completed tasks.
-   Resetting the demo.
-   Persisting task data in browser `localStorage`.

The task data is local to the browser profile; this is not a server-side
multi-user task application.

### 5.3 Feature planner --- `/planner`

The planner accepts a plain-English request and returns a structured
plan with:

1.  Feature summary.
2.  Implementation steps.
3.  Acceptance criteria.
4.  Browser verification steps.
5.  Expected results.
6.  Edge cases.

The planner validates input and validates the shape of model output
before displaying a plan. The page labels live model output and
demo-mode output distinctly. When a configured provider fails or returns
invalid/truncated content, the failure is surfaced rather than silently
substituted with a fixture.

### 5.4 Workflow page --- `/workflow`

The workflow interface exposes workflow status and human decisions, and
displays verification outcomes and evidence when available. It is a
prototype workflow view, not proof that every possible
model-to-patch-to-repair path is already reliable.

### 5.5 API surface

The implementation includes API routes for planning and workflow
operations, including workflow creation, plan approval/rejection, code
proposal handling, code approval/rejection, verification, and evidence
access. Exact route schemas and current implementation should be checked
in `app/api/` before integrating an external client.

## 6. Technical Stack

-   **Next.js App Router:** page routing and server endpoints.
-   **React:** interactive client-side interfaces.
-   **TypeScript:** types for application, workflow, planner, and
    verification structures.
-   **Tailwind CSS v4:** application styling.
-   **Node.js:** server-side route and workflow services.
-   **Playwright:** browser automation and verification journey.
-   **OpenAI-compatible HTTP APIs:** model requests for supported
    providers.
-   **Browser `localStorage`:** persistence for the task-board demo.

The project uses HTTP requests compatible with chat-completions APIs; an
individual provider SDK is not required for this request path.

## 7. Architecture and Module Responsibilities

The following describes the major responsibilities of the modules.
Always check the current repository tree if files have moved since this
document was written.

### 7.1 UI and routing

-   `app/` contains application routes and API handlers.
-   `components/` contains reusable UI components.
-   `components/demo/task-board.tsx` provides the interactive task
    board.
-   Planner components handle the request form, loading/error states,
    and structured plan display.

### 7.2 Task domain

-   `lib/tasks.ts` defines task operations and state behavior.
-   The task board persists data under the browser-local storage key
    `statesleuth.tasks.v1`.
-   The intentionally planted rename regression is located in
    `renameTask`.

### 7.3 Planner and provider configuration

-   `lib/planner.ts` contains planner data structures, validation, and
    demo-plan behavior.
-   Planner configuration and server transport modules resolve the
    active provider and make server-side model requests.
-   `lib/provider-config.ts` centralizes provider configuration and
    request settings.
-   Planner and coding-agent configuration can be resolved
    independently.

### 7.4 Workflow and storage

-   `lib/workflow.ts` defines workflow states, allowed transitions, and
    related types/guards.
-   `lib/workflow-service.ts` coordinates workflow operations.
-   Workflow records are stored in the local file-backed store under the
    project's ignored `.data/` area.
-   Existing workflow records and evidence are runtime artifacts, not
    source-controlled product data.

### 7.5 Coding proposals and patch safety

-   `lib/coding-agent.ts` generates coding proposals.
-   Diff-related modules parse and validate unified diffs.
-   Proposal targets are constrained by an allowlist.
-   Patch application checks path safety, existing-file conditions, and
    file snapshots to reduce the risk of writing to unexpected or stale
    files.
-   Patch application requires explicit human approval and is not
    equivalent to automatic execution of arbitrary shell commands.

### 7.6 Verification and evidence

-   `lib/verification.ts` contains verification result and verdict
    logic.
-   `lib/verification-browser.ts` runs the supported browser journey.
-   Verification evidence helpers constrain evidence paths.
-   The verifier records assertions, a final verdict, and screenshots
    for inspection.
-   The current browser journey is specifically designed around the
    task-board demo and planted regression.

## 8. Model Provider Configuration

### 8.1 Supported providers

The code supports OpenAI-compatible request patterns for:

-   Gemini
-   Groq
-   OpenRouter

Provider defaults, model availability, request limits, and pricing can
change; consult the current provider configuration and provider
dashboard for actual runtime status.

### 8.2 Independent agents

Planner and coding-agent settings are resolved independently. Common
environment variable families include:

-   `PLANNER_PROVIDER`, `PLANNER_MODEL`, `PLANNER_BASE_URL`,
    `PLANNER_API_KEY`
-   `CODING_PROVIDER`, `CODING_MODEL`, `CODING_BASE_URL`,
    `CODING_API_KEY`
-   Shared fallbacks such as `MODEL_PROVIDER` and `MODEL_API_KEY`
-   Provider-specific keys such as `GEMINI_API_KEY`, `GROQ_API_KEY`, and
    `OPENROUTER_API_KEY`

Exact precedence and defaults are defined in `lib/provider-config.ts`
and `.env.example`. Do not rely on this document instead of checking the
current source when changing provider settings.

### 8.3 Output budgets and timeouts

The implementation has separate output budgets for planning and coding
proposals, plus a planner-specific request timeout. The planner output
budget is smaller than the coding budget because a plan is expected to
be concise, while a unified diff needs more room. Values are validated
before provider calls.

An output-token limit can cause a model response to be truncated before
the required structure is complete. The application should surface that
failure rather than accept a partial plan or silently substitute a
fixture.

### 8.4 Live versus fixture behavior

-   If no model credentials are configured, the application may offer
    clearly labelled demo/fixture behavior where implemented.
-   If a provider is explicitly configured but fails, the request
    reports the provider error.
-   Fixture output must not be presented as if it came from a live
    model.
-   A successful model call does not imply that a coding proposal is
    valid; proposals still need to pass schema and diff validation.

## 9. Verification Design

### 9.1 Goal

The verifier is designed to check observable application behavior rather
than merely whether a source file exists or a build succeeds.

### 9.2 Supported journey

The current task-board journey checks the relevant stages of the demo,
including:

-   The board is ready after client hydration.
-   A task can be created.
-   The task can be marked complete.
-   The task can be renamed.
-   Completion state and counter behavior are checked after rename.
-   Persistence after reload is checked.

### 9.3 Verdict semantics

The verifier reports failure when the observed behavior contradicts an
expected assertion. In the planted-bug scenario, the task loses
completion status after rename, so the completion-preservation checks
fail. A failed verdict is the correct outcome for this intentionally
defective scenario.

### 9.4 Screenshot evidence

The verification journey captures screenshots to help a reviewer inspect
the actual UI state at the point of failure. Evidence supplements the
assertion result; it does not automatically explain every root cause or
prove behavior outside the tested journey.

### 9.5 Scope boundary

The verifier currently targets the included task-board journey. It is
not yet a general-purpose browser agent that automatically converts
arbitrary plans into complete, reliable browser tests for any website.

## 10. Deliberately Planted Defect

**Defect:** renaming a completed task clears its completion state.

-   **Location:** `lib/tasks.ts`, function `renameTask`.
-   **Expected behavior:** a rename changes the title but preserves the
    task's completion state and original creation timestamp.
-   **Observed behavior:** the task becomes active, its checkbox is
    unchecked, and the completion counter drops.
-   **Persistence:** because the updated state is saved to local
    storage, the reset remains after reload.
-   **Root cause:** the rename path rebuilds the record using the
    task-creation helper, which defaults `completed` to `false` and may
    restamp creation time.
-   **Intended scope:** the rename path is deliberately defective for
    the demo; the other task-board operations are intended to behave
    normally.

### Reproduction steps

1.  Open `/demo`.
2.  Create a task.
3.  Mark it complete.
4.  Confirm the completion counter reflects one completed task.
5.  Rename the task and save.
6.  Observe the unchecked checkbox and changed counter.
7.  Reload and observe that the completion state remains lost.

**Do not fix this defect before the intended demo recording.** It is the
concrete failure the verifier is meant to detect. A passing result for
the same scenario would warrant investigation.

## 11. Safety Model and Boundaries

### 11.1 Human approval

Plan approval and code approval are separate gates. Generated code is
not automatically trusted or applied simply because a model returned it.

### 11.2 Diff validation and allowlisting

The code-proposal path uses a constrained set of target files and
validates unified-diff structure. Invalid or truncated diffs should be
rejected rather than repaired silently by weakening the parser.

### 11.3 File safety

Patch application includes protections intended to constrain paths,
avoid unsafe destinations, detect stale snapshots, and prevent writes
outside the intended project scope. These controls reduce risk but do
not replace source control, backups, or human review.

### 11.4 Local-only operation

The application is designed as a single-user local demo. Local endpoint
checks are safeguards, not authentication. Binding the server to
`127.0.0.1` is the main boundary against network exposure. Do not expose
the app directly to an untrusted network.

### 11.5 Secrets and local data

-   Keep `.env.local` out of version control.
-   Do not use `NEXT_PUBLIC_` for model-provider secrets.
-   Keep workflow data and generated evidence in ignored local runtime
    directories unless intentionally sanitized.
-   Do not paste API keys into screenshots, README content, issue
    reports, or public commits.

## 12. Setup and Developer Workflow

### 12.1 Prerequisites

-   Node.js 20.9 or newer.
-   npm 10 or newer.
-   Google Chrome for the configured browser test path.
-   Optional model-provider credentials for live planning and coding
    proposals.

### 12.2 Installation

``` bash
npm install
```

### 12.3 Environment

Copy `.env.example` to `.env.local`, then configure only the providers
you intend to use. Keep secrets private. Restart the development server
after changing environment values.

### 12.4 Start locally

``` bash
npm run dev:local
```

Use the local address shown by the framework. For a production build,
the project also defines local-only start behavior.

### 12.5 Checks

``` bash
npm test
npm run typecheck
npm run build
npm run test:browser
```

Check `package.json` for the exact current script names and any
environment requirements. Browser tests rely on the configured
Playwright setup and installed Chrome channel.

## 13. Test Strategy

The test suite covers core domain logic, workflow transitions and
safeguards, provider configuration and failure classification, diff
validation, patch application protections, verification verdicts, and
API behavior. Browser tests exercise the verifier journey in Chrome.

Test results from a particular development run are point-in-time
evidence, not a guarantee that every future provider request will work.
Provider-backed tests can be affected by rate limits and availability;
deterministic unit and browser tests should remain reproducible
independently of live model availability where designed that way.

## 14. Current Status Matrix

  -----------------------------------------------------------------------
  Capability              Status                  Notes
  ----------------------- ----------------------- -----------------------
  Landing page            Implemented             Product framing and
                                                  navigation

  Interactive task board  Implemented             Browser-local state

  Feature planner         Implemented             Live provider calls can
                                                  fail; demo mode is
                                                  labelled

  Provider configuration  Implemented             Gemini, Groq,
                                                  OpenRouter through
                                                  compatible HTTP calls

  Workflow state machine  Implemented             Explicit states and
                                                  guarded transitions

  Human plan/code         Implemented             Separate decisions
  approval                                        

  Coding proposal         Implemented             Live output can be
  generation                                      malformed, truncated,
                                                  or rate-limited

  Strict diff validation  Implemented             Invalid hunk counts and
                                                  malformed diffs are
                                                  rejected

  Guarded patch           Implemented             Requires explicit
  application                                     approval; safety checks
                                                  apply

  Playwright verifier     Implemented             Focused on task-board
                                                  journey

  Screenshot evidence     Implemented             Stored evidence
                                                  supports failure review

  General plan-derived    In progress             Current journey is
  browser automation                              targeted, not universal

  Reliable live           Not yet demonstrated    Provider reliability
  patch-apply-verify      end to end              remains a limitation
  chain                                           

  Automated               Planned / in progress   Do not claim it is
  repair-and-retest loop                          complete
  -----------------------------------------------------------------------

## 15. Known Limitations and Failure Modes

1.  **Provider availability:** model endpoints can return rate limits,
    outages, authentication errors, timeouts, or unknown-model errors.
2.  **Output truncation:** a response can hit its output-token limit
    before the required structure or diff is complete.
3.  **Diff format errors:** models can produce incorrect unified-diff
    hunk counts or invalid patch structure; strict validation rejects
    these cases.
4.  **Coding proposal reliability:** a live request may fail even when
    the model/provider configuration is valid.
5.  **Narrow verification scope:** the current Playwright journey checks
    the known task-board behavior rather than arbitrary websites.
6.  **No completed automatic repair loop:** the verifier can detect the
    planted bug, but StateSleuth should not be described as reliably
    fixing and retesting every failure automatically.
7.  **Local prototype constraints:** the app is not designed for
    multi-user deployment or exposure to an untrusted network.

## 16. Roadmap

### Near term

-   Improve stability of structured planner responses and clearer
    handling of output limits.
-   Improve reliability of unified-diff generation without weakening
    validation.
-   Improve the workflow demo so a reviewer can follow the approval and
    evidence stages easily.
-   Keep the landing-page roadmap aligned with actual implementation
    status.

### Later

-   Derive browser journeys more directly from acceptance criteria.
-   Expand verification to more workflows and state checks.
-   Complete a repair-and-retest loop with explicit human approval and
    independent verification.
-   Improve evidence comparison and failure summaries.
-   Evaluate the safety and reliability of any future automation before
    enabling it by default.

## 17. Demo Presentation Guidance

For a concise demo:

1.  Show the task board.
2.  Create or select a task and mark it complete.
3.  Rename the task and show the unexpected reset.
4.  Show the recorded Playwright failed verdict and screenshot evidence.
5.  Show the planner or workflow interface only when it supports the
    story and does not show an unrelated failed provider request as a
    successful result.
6.  Be explicit that the complete automatic repair loop remains
    unfinished.

The core claim is the verification foundation: the application can
behave incorrectly even while it is running, and a browser verifier can
catch that behavior and preserve evidence.

## 18. Terminology

-   **Plan:** structured model-generated or demo-generated
    implementation guidance.
-   **Live result:** output actually returned by the configured
    provider.
-   **Fixture/demo result:** explicitly labelled local sample output.
-   **Coding proposal:** a candidate diff; it is not yet applied.
-   **Human approval:** an explicit decision to advance the relevant
    workflow stage.
-   **Verification journey:** a defined set of browser actions and
    assertions.
-   **Verdict:** the result of evaluating those assertions against
    observed behavior.
-   **Evidence:** screenshots and recorded assertion information
    associated with a verification run.
-   **Repair loop:** the future cycle of proposing a fix, applying it
    only after approval, rerunning verification, and evaluating the
    result.

## 19. Final Project Statement

StateSleuth is a hackathon prototype exploring a more evidence-driven
way to use AI in software development. It combines structured planning,
human review, guarded code proposals, and browser-based verification
around a real, reproducible regression.

Its most defensible current claim is not that AI can autonomously repair
every bug. It is that **generated code should be checked against real
behavior, and a verification failure should come with evidence a
developer can inspect.**

------------------------------------------------------------------------

**Project repository:** https://github.com/jaikishan1234/StateSleuth\
**Demo video:**
https://drive.google.com/file/d/1Ow4wopgkxQNd48ifVd7oKjh_zXB_yGJR/view?usp=drive_link
