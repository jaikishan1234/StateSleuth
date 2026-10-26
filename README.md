# StateSleuth

A coding agent that independently verifies application behaviour.

StateSleuth is built for the Openfire hackathon. It is a standalone Next.js web
application, not an Openfire plugin.

## Vision

Autonomous coding agents usually grade their own homework. They write a test
around their own assumptions, watch it pass, and report the task as done. When
the test shares the agent's blind spot, nothing was actually verified.

StateSleuth takes the opposite position: a change is not done until the running
application proves it. The agent derives journeys from the behaviour that was
requested, drives the real interface, inspects the state left behind, and issues
a verdict backed by evidence it can replay.

The loop has four stages:

1. **Understand the intent** — restate what a user should be able to do, and
   what must never happen.
2. **Drive the app** — interact with the real application as a user would,
   including retries, cancellations and failure paths.
3. **Inspect the state** — read what actually persisted: records, sessions,
   totals, queues and logs.
4. **Issue a verdict** — pass only when behaviour and state both match the
   intent. Otherwise return a reproducible failure.

The verdict is the product: expected versus observed, in plain language, with
evidence attached.

## Status

Phase 3. The repository contains the landing page that frames the idea, a real
task board at `/demo`, and a feature planner at `/planner`.

Implemented:

- Next.js App Router application with TypeScript and Tailwind CSS
- Responsive landing page describing the verification model
- Task board demo: create, rename, complete, delete, filter, reset
- Browser-local persistence via `localStorage`
- Feature planner: plain-English request to a structured, validated plan
- Server-side model call behind an OpenAI-compatible endpoint, with a clearly
  labelled demo mode when no credentials are configured
- Project documentation, including one documented defect (see
  [Known defect](#known-defect-developers-only))

Deliberately not implemented yet:

- Browser automation and Playwright
- Any form of code or shell execution
- Autonomous repair loop
- Database or server-side persistence

## Prerequisites

- Node.js 20.9 or newer (developed on Node 24)
- npm 10 or newer
- Optional: an API key for an OpenAI-compatible model endpoint

## Local setup

```bash
npm install
npm run dev
```

| Route     | What it is                                      |
| --------- | ----------------------------------------------- |
| `/`       | Landing page                                    |
| `/planner`| Feature planner (live model or demo mode)        |
| `/demo`   | Task board demo                                 |

The application runs with no configuration. Without model credentials,
`/planner` uses demo mode and says so.

## Feature planner

`/planner` takes a plain-English feature request and returns a structured plan
with six sections:

1. Feature summary
2. Implementation steps
3. Acceptance criteria
4. Browser verification steps
5. Expected results
6. Edge cases

The plan can be copied as Markdown. Requests are validated on both sides and
limited to 6 per minute per client.

### Demo mode vs live mode

| | Demo mode | Live mode |
| --- | --- | --- |
| Trigger | No API key configured | `PLANNER_API_KEY` or `OPENAI_API_KEY` set |
| Source of the plan | Locally built sample template, seeded by your request | Model response, parsed and validated |
| Labelling | Amber "Demo mode" banner and "Demo plan" badge | "Live model" badge with the model name |
| Failure behaviour | Not applicable | Errors are shown as errors; the app never substitutes a demo plan |

The page tells you which mode is active before you submit, and every result is
badged with the mode that actually produced it. Demo output is never presented
as model output.

### Enabling live mode

Any provider that speaks the OpenAI chat completions API works: OpenAI,
OpenRouter, Groq, Together, a self-hosted gateway, or Ollama's compatible
endpoint.

1. Copy `.env.example` to `.env.local`.
2. Set `PLANNER_API_KEY`.
3. Adjust `PLANNER_BASE_URL` and `PLANNER_MODEL` for your provider.
4. Restart `npm run dev`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PLANNER_API_KEY` | Yes, for live mode | — | Bearer token, read only on the server |
| `OPENAI_API_KEY` | Alternative | — | Used when `PLANNER_API_KEY` is absent |
| `PLANNER_BASE_URL` | No | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `PLANNER_MODEL` | No | `gpt-4o-mini` | Model identifier sent to the provider |

Keys are read in `lib/planner-config.ts`, which is imported only by server code
(`app/planner/page.tsx` and `app/api/plan/route.ts`). The browser receives a
boolean and a model name, never the key. Do not prefix these variables with
`NEXT_PUBLIC_`.

### API contract

`POST /api/plan` with `{ "feature": string }` (12–2000 characters).

- `200` live: `{ "mode": "live", "model": string, "plan": Plan }`
- `200` demo: `{ "mode": "demo", "notice": string, "plan": Plan }`
- `400` invalid or missing description
- `429` rate limit exceeded (`Retry-After` header set)
- `502` upstream failure or a model response that fails schema validation

```ts
type Plan = {
  featureSummary: { title: string; description: string };
  implementationSteps: { title: string; detail: string }[];
  acceptanceCriteria: string[];
  browserVerificationSteps: string[];
  expectedResults: string[];
  edgeCases: string[];
};
```

Every field is required and non-empty, arrays are capped, and strings are
length-limited. Validation lives in `lib/planner.ts`; model output is stripped
of markdown fences before parsing. A response that fails validation returns an
error instead of a partially rendered plan.

This phase produces plans only. It does not edit files, run shell commands,
drive a browser or apply fixes.

## Task board demo

The landing page links to `/demo` from the header, the hero, and the closing
call to action.

| Action           | How                                                              |
| ---------------- | ---------------------------------------------------------------- |
| Create a task    | Type a title and submit, or press Enter                          |
| Rename a task    | Pencil button, edit the title, then Save (Enter) or Cancel (Esc) |
| Complete a task  | Click the checkbox on the left of the row                        |
| Reopen a task    | Click the checkbox again                                          |
| Delete a task    | Trash button on the right of the row                              |
| Filter the board | All / Active / Completed tabs                                     |
| Clear everything | `Reset demo` in the board header                                  |

Tasks are stored in `localStorage` under `statesleuth.tasks.v1`. They survive a
page reload and are scoped to the browser profile, so a different browser or a
cleared storage state starts from an empty board. No database, external service
or API key is involved.

A short manual pass, useful before any verification work:

1. Open `/demo` and add three tasks.
2. Reload the page; the tasks are still there.
3. Mark one task complete, reload, and confirm it is still complete.
4. Rename an active task; it stays active (expected).
5. Rename the completed task. See the [known defect](#known-defect-developers-only).
6. Delete a task and reload; it stays deleted.

## Scripts

| Command             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `npm run dev`       | Start the development server with hot reload   |
| `npm run build`     | Create an optimised production build           |
| `npm run start`     | Serve the production build                     |
| `npm run typecheck` | Type-check the project without emitting output |

## Project structure

```
.
├── app/
│   ├── api/
│   │   └── plan/
│   │       └── route.ts    # POST /api/plan: validation, live call, demo fallback
│   ├── demo/
│   │   └── page.tsx        # /demo route: task board demo
│   ├── planner/
│   │   └── page.tsx        # /planner route: feature planner
│   ├── globals.css         # Tailwind entry point, theme tokens, backdrop effects
│   ├── icon.svg            # Favicon
│   ├── layout.tsx          # Root layout and metadata
│   └── page.tsx            # StateSleuth landing page
├── components/
│   ├── demo/
│   │   └── task-board.tsx  # Client-side board: state, forms, rows
│   ├── planner/
│   │   ├── planner-workspace.tsx  # Request form, loading and error states
│   │   └── plan-result.tsx        # Plan rendering and Markdown copy
│   ├── icons.tsx           # Inline SVG icon set (no icon dependency)
│   └── logo.tsx            # Shared wordmark
├── lib/
│   ├── planner.ts          # Plan types, schema validation, demo builder
│   ├── planner-config.ts   # Server-only environment configuration
│   └── tasks.ts            # Task types, pure operations, storage helpers
├── .env.example
├── next.config.ts
├── postcss.config.mjs
└── tsconfig.json
```

Tailwind CSS v4 is configured entirely through `app/globals.css`, so there is no
`tailwind.config.ts` to maintain.

## Roadmap

| Phase | Scope                                                                                  |
| ----- | -------------------------------------------------------------------------------------- |
| 1     | Foundation: scaffold, landing page, docs                                                |
| 2     | Testable demo: task board with browser-local persistence                                 |
| 3     | Feature planner: structured, validated plans from plain-English requests                  |
| 4     | Verification engine: drive apps in a browser, capture evidence, evaluate behaviour        |
| 5     | Repair loop: propose a fix, re-run the same journeys, accept only verified changes        |

## Known defect (developers only)

This section is documentation for developers. The demo UI does not mention the
defect; it is only discoverable by driving the board.

The task board contains **exactly one deliberately introduced defect**. It
exists so the StateSleuth verification engine has a real, reproducible failure
to find. Every other workflow on the board behaves correctly. Do not fix it: the
defect is required by the demo, and a passing verification run on it means the
verifier is broken.

**Defect: renaming a completed task clears its completion state.**

- **Where:** `lib/tasks.ts`, in `renameTask`.
- **Expected:** renaming a task preserves its completion state. A completed task
  stays completed, an active task stays active.
- **Actual:** renaming a task resets it to active, even when it was completed.
  The checkbox visibly unchecks immediately, and the change persists after a
  reload because the board writes the new state to `localStorage`.
- **Root cause:** `renameTask` rebuilds the record with `createTask(...)` instead
  of merging into the existing task. New tasks default to `completed: false`, so
  the flag is lost on every rename. (The record's `createdAt` is re-stamped as a
  side effect, which is not surfaced in the UI.)
- **Blast radius:** only the rename path. Create, toggle, delete and persistence
  are unaffected.

Reproduction:

1. Open `/demo` and add a task.
2. Mark it complete. The row is struck through and the counter reads `1 of 1`.
3. Click the pencil button on that row and change the title.
4. Press Enter or click Save.
5. The checkbox is unchecked again and the counter reads `0 of 1`. Reload the
   page: it stays unchecked.

All tasks resolve to the same defect, so a verification run needs only one
completed task to reproduce it.

## Notes

Git is intentionally not initialised in this phase.