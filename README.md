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

Phase 2. The repository contains the landing page that frames the idea, and a
small but real task board at `/demo` that the future verification engine can
drive.

Implemented:

- Next.js App Router application with TypeScript and Tailwind CSS
- Responsive landing page describing the verification model
- Task board demo: create, rename, complete, delete, filter, reset
- Browser-local persistence via `localStorage`
- Project documentation, including one documented defect (see
  [Known defect](#known-defect-developers-only))

Deliberately not implemented yet:

- Model or LLM integration
- Playwright or any browser automation
- Database or server-side persistence
- Autonomous repair loop

## Prerequisites

- Node.js 20.9 or newer (developed on Node 24)
- npm 10 or newer

## Local setup

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the landing page, or
http://localhost:3000/demo for the task board.

## Using the task board demo

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
│   ├── demo/
│   │   └── page.tsx     # /demo route: task board demo
│   ├── globals.css      # Tailwind entry point, theme tokens, backdrop effects
│   ├── icon.svg         # Favicon
│   ├── layout.tsx       # Root layout and metadata
│   └── page.tsx         # StateSleuth landing page
├── components/
│   ├── demo/
│   │   └── task-board.tsx  # Client-side board: state, forms, rows
│   ├── icons.tsx        # Inline SVG icon set (no icon dependency)
│   └── logo.tsx         # Shared wordmark
├── lib/
│   └── tasks.ts         # Task types, pure operations, storage helpers
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
| 3     | Model integration: turn a change request into a verification plan                        |
| 4     | Verification engine: drive apps in a browser, capture evidence, evaluate behaviour        |
| 5     | Repair loop: propose a fix, re-run the same journeys, accept only verified changes        |

## Known defect (developers only)

This section is documentation for developers. The demo UI does not mention the
defect; it is only discoverable by driving the board.

The task board contains **exactly one deliberately introduced defect**. It
exists so the StateSleuth verification engine has a real, reproducible failure
to find. Every other workflow on the board behaves correctly. Do not fix it
during Phase 2 — a passing verification run on this bug means the verifier is
broken.

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