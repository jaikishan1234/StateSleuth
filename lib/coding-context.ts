/**
 * Which permitted files are offered to the coding agent as context.
 *
 * Two lists are kept deliberately separate:
 *
 * - `PERMITTED_SOURCE_FILES` (lib/coding-paths.ts) is the EDIT allowlist: the
 *   only paths a proposal may touch, and the only paths the patch applier will
 *   write. This module never widens it.
 * - This module chooses a RELEVANT SUBSET of those same files to send as
 *   context. Every candidate comes from the allowlist, so selection can only
 *   narrow what the model sees, never what it may edit.
 *
 * Selection is keyword-based and deterministic: a request about task behaviour
 * always sees `lib/tasks.ts`, because that file owns the demo board's domain
 * vocabulary. A request about the landing page or the stylesheet does not.
 */

import { PERMITTED_SOURCE_FILES, type PermittedSourceFile } from "./coding-paths.ts";

/** Default number of files sent as context, chosen to fit a local model prompt. */
export const CONTEXT_FILE_LIMIT = 6;

/**
 * Vocabulary of the task-board demo. These words describe behaviour governed by
 * lib/tasks.ts: creating, renaming, completing, filtering and persisting tasks.
 */
const TASK_DOMAIN = [
  "task",
  "tasks",
  "todo",
  "todos",
  "complete",
  "completes",
  "completed",
  "completion",
  "incomplete",
  "rename",
  "renames",
  "renamed",
  "renaming",
  "edit",
  "edits",
  "edited",
  "editing",
  "title",
  "titles",
  "delete",
  "deletes",
  "deleted",
  "deleting",
  "persist",
  "persists",
  "persisted",
  "persistence",
  "persistent",
  "localstorage",
  "storage",
  "stored",
  "reload",
  "reloads",
  "reloaded",
  "board",
  "boards",
  "filter",
  "filters",
  "filtered",
  "active",
  "reorder",
  "drag",
  "due",
  "overdue",
  "date",
  "dates",
] as const;

type ContextRule = { file: PermittedSourceFile; keywords: readonly string[] };

const CONTEXT_RULES: readonly ContextRule[] = [
  { file: "lib/tasks.ts", keywords: TASK_DOMAIN },
  {
    file: "components/demo/task-board.tsx",
    keywords: [...TASK_DOMAIN, "checkbox", "row", "rows", "pencil", "input", "form", "button"],
  },
  { file: "app/demo/page.tsx", keywords: ["demo", "board", "boards"] },
  {
    file: "app/page.tsx",
    keywords: ["landing", "homepage", "hero", "headline", "tagline", "marketing", "site"],
  },
  {
    file: "app/globals.css",
    keywords: [
      "css",
      "style",
      "styles",
      "styling",
      "styled",
      "color",
      "colors",
      "colour",
      "colours",
      "theme",
      "themes",
      "dark",
      "light",
      "gradient",
      "animation",
    ],
  },
  { file: "components/icons.tsx", keywords: ["icon", "icons", "svg", "glyph"] },
  {
    file: "lib/planner.ts",
    keywords: ["plan", "plans", "planner", "planning", "schema", "validation", "validate", "acceptance"],
  },
  {
    file: "lib/planner-server.ts",
    keywords: [
      "provider",
      "providers",
      "gemini",
      "groq",
      "openrouter",
      "prompt",
      "prompts",
      "transport",
      "timeout",
      "model",
      "models",
    ],
  },
  {
    file: "lib/coding-agent.ts",
    keywords: ["proposal", "proposals", "diff", "diffs", "patch", "patches", "context", "agent"],
  },
];

const KEYWORDS_BY_FILE = new Map<string, readonly string[]>(
  CONTEXT_RULES.map((rule) => [rule.file, rule.keywords]),
);

/**
 * Files that must be present when their domain is named, however the other
 * files score. The task board's behaviour is implemented in `lib/tasks.ts`, so
 * a request about completing, renaming, editing or persisting tasks must always
 * see it — including when unrelated words in the same request (a colour, an
 * icon) would otherwise fill every slot.
 */
const REQUIRED_CONTEXT: readonly ContextRule[] = [
  { file: "lib/tasks.ts", keywords: TASK_DOMAIN },
];

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 0),
  );
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return CONTEXT_FILE_LIMIT;
  const whole = Math.floor(limit);
  return Math.max(1, Math.min(whole, PERMITTED_SOURCE_FILES.length));
}

/**
 * Chooses the context files for a feature request.
 *
 * 1. A required file whose domain is named goes in first (see
 *    `REQUIRED_CONTEXT`); this is what guarantees `lib/tasks.ts` for task
 *    behaviour.
 * 2. If the request names anything recognisable, only matching files are sent,
 *    ranked by how many of their keywords appear. Unrelated files are not
 *    padded in: they add request size and noise, and some providers reject an
 *    oversized prompt outright.
 * 3. If the request names nothing recognisable, the first `limit` files in
 *    declaration order are sent, which reproduces the previous behaviour.
 */
export function selectContextFiles(
  featureRequest: string,
  limit: number = CONTEXT_FILE_LIMIT,
): PermittedSourceFile[] {
  const bounded = clampLimit(limit);
  const tokens = tokenize(featureRequest ?? "");

  const selected = REQUIRED_CONTEXT.filter((rule) =>
    rule.keywords.some((keyword) => tokens.has(keyword)),
  )
    .map((rule) => rule.file)
    .slice(0, bounded);

  const ranked = PERMITTED_SOURCE_FILES.map((file, index) => ({
    file,
    index,
    score: (KEYWORDS_BY_FILE.get(file) ?? []).filter((keyword) => tokens.has(keyword)).length,
  })).sort((left, right) => right.score - left.score || left.index - right.index);

  const matched = ranked.filter((entry) => entry.score > 0);
  const pool = matched.length > 0 ? matched : ranked;

  for (const entry of pool) {
    if (selected.length >= bounded) break;
    if (!selected.includes(entry.file)) selected.push(entry.file);
  }

  return selected;
}