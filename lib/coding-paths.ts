/**
 * Path safety rules for coding proposals.
 *
 * The coding agent may only read and propose changes to an explicit allowlist
 * of source files inside the project root. Everything else is refused:
 * secrets, version control, dependencies, build output and any path that
 * could escape the project.
 */

/** Files the coding agent is permitted to read and propose changes to. */
export const PERMITTED_SOURCE_FILES = [
  "app/demo/page.tsx",
  "app/globals.css",
  "app/page.tsx",
  "components/demo/task-board.tsx",
  "components/icons.tsx",
  "lib/coding-agent.ts",
  "lib/coding-fixture.ts",
  "lib/coding-paths.ts",
  "lib/coding-proposal.ts",
  "lib/planner.ts",
  "lib/planner-server.ts",
  "lib/tasks.ts",
  "lib/workflow-service.ts",
  "lib/workflow-store.ts",
  "lib/workflow.ts",
] as const;

export type PermittedSourceFile = (typeof PERMITTED_SOURCE_FILES)[number];

const PERMITTED_SET = new Set<string>(PERMITTED_SOURCE_FILES);

/** Directory names that are never readable or writable, whatever the path. */
export const BLOCKED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".data",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

/** File patterns that are never readable or writable. */
export const BLOCKED_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(\..*)?$/i,
  /(^|\/)\.envrc$/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.tsbuildinfo$/i,
  /(^|\/)package-lock\.json$/i,
  /(^|\/)npm-debug\.log/i,
  /(^|\/)id_(rsa|ed25519)/i,
];

export type PathRejection =
  | "not_a_string"
  | "empty"
  | "absolute"
  | "backslash"
  | "parent_traversal"
  | "windows_drive"
  | "null_byte"
  | "blocked_segment"
  | "blocked_file"
  | "not_permitted";

export type PathCheck =
  | { ok: true; path: string }
  | { ok: false; reason: PathRejection; message: string };

/** Normalises separators and reports why a path is unsafe, if it is. */
export function checkRelativePath(value: unknown): PathCheck {
  if (typeof value !== "string") {
    return { ok: false, reason: "not_a_string", message: "Path must be a string." };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "empty", message: "Path must not be empty." };
  }

  if (trimmed.includes("\0")) {
    return { ok: false, reason: "null_byte", message: "Path must not contain a null byte." };
  }

  if (trimmed.includes("\\")) {
    return {
      ok: false,
      reason: "backslash",
      message: "Path must use forward slashes.",
    };
  }

  if (/^[A-Za-z]:/.test(trimmed)) {
    return {
      ok: false,
      reason: "windows_drive",
      message: "Path must be relative to the project root.",
    };
  }

  if (trimmed.startsWith("/")) {
    return {
      ok: false,
      reason: "absolute",
      message: "Path must be relative to the project root.",
    };
  }

  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "..")) {
    return {
      ok: false,
      reason: "parent_traversal",
      message: "Path must not leave the project root.",
    };
  }

  for (const segment of segments) {
    if (BLOCKED_SEGMENTS.has(segment)) {
      return {
        ok: false,
        reason: "blocked_segment",
        message: `Path segment "${segment}" is not accessible.`,
      };
    }
  }

  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        reason: "blocked_file",
        message: "This file is sensitive or generated and cannot be read or changed.",
      };
    }
  }

  return { ok: true, path: trimmed };
}

/** True when the path is safe and on the explicit allowlist. */
export function isPermittedSourceFile(value: unknown): value is string {
  const check = checkRelativePath(value);
  if (!check.ok) return false;
  return PERMITTED_SET.has(check.path);
}

/** Every reason a path is refused, for use in error messages. */
export function describeRejection(check: PathCheck): string {
  return check.ok ? "" : check.message;
}
