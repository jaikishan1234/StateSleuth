/**
 * Safe, human-approved patch application.
 *
 * Server-only. Applies exactly the diff that a human approved, to files on the
 * explicit allowlist, after re-validating paths, content hashes and hunks.
 * No shell is used: the diff is parsed and applied in-process.
 *
 * Guarantees:
 * - Every path is re-checked against the allowlist (no absolute paths, no
 *   traversal, no symlink escape, no blocked segments).
 * - Only `modify` of an existing regular file is supported.
 * - The file must still match the hash captured when the proposal was created,
 *   otherwise the proposal is stale and nothing is written.
 * - All files are validated and rendered in memory before the first write, and
 *   a write failure rolls back the files already written.
 */

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkRelativePath, isPermittedSourceFile } from "./coding-paths.ts";
import { isStoredProposal, type CodingProposal } from "./coding-proposal.ts";

export type ApplyFailureCode =
  | "invalid_proposal"
  | "not_permitted"
  | "unsupported_change"
  | "missing_snapshot"
  | "stale"
  | "conflict"
  | "malformed_diff"
  | "no_change"
  | "io_error";

export type ApplyFailure = {
  code: ApplyFailureCode;
  message: string;
  path?: string;
};

export type ApplyResult =
  | { ok: true; applied: string[] }
  | { ok: false; failure: ApplyFailure; applied: string[]; rolledBack: boolean };

type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

type Section = { path: string; hunks: Hunk[] };

export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function splitLines(content: string): { lines: string[]; eol: string; trailing: boolean } {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const trailing = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (trailing) lines.pop();
  return { lines, eol, trailing };
}

function fail(code: ApplyFailureCode, message: string, filePath?: string): ApplyResult {
  return {
    ok: false,
    failure: { code, message, ...(filePath ? { path: filePath } : {}) },
    applied: [],
    rolledBack: true,
  };
}

/** Parses a unified diff into per-file hunks. Rejects anything unexpected. */
export function parseUnifiedDiff(
  diff: string,
): { ok: true; sections: Section[] } | { ok: false; message: string } {
  const lines = diff.split(/\r?\n/);
  const sections: Section[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.startsWith("--- ")) {
      const next = lines[index + 1] ?? "";
      if (!next.startsWith("+++ ")) {
        return { ok: false, message: "a diff section is missing its +++ header" };
      }

      const newPath = next.slice(4).trim();
      if (newPath === "/dev/null") {
        return { ok: false, message: "file creation and deletion are not supported" };
      }

      const normalized = newPath.replace(/^b\//, "");
      sections.push({ path: normalized, hunks: [] });
      index += 2;
      continue;
    }

    if (line.startsWith("@@")) {
      const section = sections.at(-1);
      if (!section) return { ok: false, message: "a hunk appears before any file header" };

      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) return { ok: false, message: "a hunk header is malformed" };

      const hunk: Hunk = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };

      index += 1;
      while (index < lines.length) {
        const bodyLine = lines[index] ?? "";

        // A new hunk or a new file section ends this hunk. The file-header
        // check matters because "--- " also starts with the "-" tag.
        if (bodyLine.startsWith("@@")) break;
        if (bodyLine.startsWith("--- ") && (lines[index + 1] ?? "").startsWith("+++ ")) break;

        const tag = bodyLine.charAt(0);
        if (tag === " " || tag === "+" || tag === "-" || tag === "\\") {
          hunk.lines.push(bodyLine);
          index += 1;
          continue;
        }
        break;
      }

      const oldLines = hunk.lines.filter((entry) => entry.startsWith(" ") || entry.startsWith("-")).length;
      const newLines = hunk.lines.filter((entry) => entry.startsWith(" ") || entry.startsWith("+")).length;

      if (oldLines !== hunk.oldCount || newLines !== hunk.newCount) {
        return { ok: false, message: "a hunk's line counts do not match its header" };
      }

      section.hunks.push(hunk);
      continue;
    }

    if (line === "" || line.startsWith("\\")) {
      index += 1;
      continue;
    }

    return { ok: false, message: "the diff contains a line that is not part of a hunk" };
  }

  if (sections.length === 0) return { ok: false, message: "the diff contains no file sections" };
  if (sections.some((section) => section.hunks.length === 0)) {
    return { ok: false, message: "a diff section contains no hunks" };
  }

  return { ok: true, sections };
}

function matchesAt(lines: string[], position: number, hunk: Hunk): boolean {
  let cursor = position;
  for (const line of hunk.lines) {
    if (line.startsWith("+")) continue;
    if (line.startsWith("\\")) continue;
    if (lines[cursor] !== line.slice(1)) return false;
    cursor += 1;
  }
  return true;
}

/** Applies parsed hunks to a file's lines, refusing ambiguous matches. */
export function applyHunks(
  lines: string[],
  hunks: Hunk[],
): { ok: true; lines: string[] } | { ok: false; message: string } {
  const output: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const preferred = hunk.oldStart - 1;

    let start = -1;
    if (preferred >= cursor && preferred + hunk.oldCount <= lines.length && matchesAt(lines, preferred, hunk)) {
      start = preferred;
    } else {
      const candidates: number[] = [];
      for (let position = cursor; position + hunk.oldCount <= lines.length; position += 1) {
        if (matchesAt(lines, position, hunk)) candidates.push(position);
      }
      if (candidates.length === 0) {
        return { ok: false, message: "the file no longer matches the context in this hunk" };
      }
      if (candidates.length > 1) {
        return { ok: false, message: "this hunk matches more than one place in the file" };
      }
      start = candidates[0]!;
    }

    output.push(...lines.slice(cursor, start));

    let consumed = 0;
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue;
      if (line.startsWith(" ")) {
        output.push(line.slice(1));
        consumed += 1;
      } else if (line.startsWith("-")) {
        consumed += 1;
      } else if (line.startsWith("+")) {
        output.push(line.slice(1));
      }
    }

    cursor = start + consumed;
  }

  output.push(...lines.slice(cursor));
  return { ok: true, lines: output };
}

/** Resolves a permitted path, rejecting symlinks and anything outside the root. */
async function resolveTarget(
  rootAbs: string,
  relative: string,
): Promise<{ ok: true; absolute: string; content: string } | { ok: false; failure: ApplyFailure }> {
  const check = checkRelativePath(relative);
  if (!check.ok) {
    return { ok: false, failure: { code: "not_permitted", message: check.message, path: relative } };
  }
  if (!isPermittedSourceFile(check.path)) {
    return {
      ok: false,
      failure: {
        code: "not_permitted",
        message: "This file is not on the permitted allowlist.",
        path: check.path,
      },
    };
  }

  const absolute = path.resolve(rootAbs, check.path);
  const relativeToRoot = path.relative(rootAbs, absolute);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return {
      ok: false,
      failure: { code: "not_permitted", message: "The path escapes the project root.", path: check.path },
    };
  }

  try {
    const stats = await lstat(absolute);
    if (stats.isSymbolicLink()) {
      return {
        ok: false,
        failure: { code: "not_permitted", message: "Symlinks cannot be patched.", path: check.path },
      };
    }
    if (!stats.isFile()) {
      return {
        ok: false,
        failure: { code: "not_permitted", message: "The target is not a regular file.", path: check.path },
      };
    }

    const real = await realpath(absolute);
    const realRelative = path.relative(rootAbs, real);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return {
        ok: false,
        failure: {
          code: "not_permitted",
          message: "The resolved path escapes the project root.",
          path: check.path,
        },
      };
    }

    return { ok: true, absolute, content: await readFile(absolute, "utf8") };
  } catch {
    return {
      ok: false,
      failure: { code: "io_error", message: "The target file could not be read.", path: check.path },
    };
  }
}

export type ApplyProposalOptions = {
  projectRoot: string;
  proposal: CodingProposal;
  /** Test seam: allows simulating a write failure. */
  writeFileImpl?: (absolute: string, content: string) => Promise<void>;
};

/**
 * Applies a proposal. Nothing is written unless every path, hash and hunk
 * passes validation first.
 */
export async function applyProposal(options: ApplyProposalOptions): Promise<ApplyResult> {
  const { proposal } = options;
  const rootAbs = path.resolve(options.projectRoot);
  const write = options.writeFileImpl ?? ((absolute: string, content: string) => writeFile(absolute, content, "utf8"));

  if (!isStoredProposal(proposal)) {
    return fail("invalid_proposal", "The stored proposal is not valid.");
  }

  if (proposal.files.length === 0) {
    return fail("invalid_proposal", "The proposal does not name any files.");
  }

  if (!proposal.snapshot || proposal.snapshot.length === 0) {
    return fail("missing_snapshot", "This proposal has no file snapshot, so it cannot be applied safely.");
  }

  const snapshot = new Map(proposal.snapshot.map((entry) => [entry.path, entry.sha256]));

  for (const file of proposal.files) {
    if (file.change !== "modify") {
      return fail(
        "unsupported_change",
        `Only whole-file modifications are supported; "${file.change}" is not.`,
        file.path,
      );
    }
  }

  const parsed = parseUnifiedDiff(proposal.diff);
  if (!parsed.ok) return fail("malformed_diff", parsed.message);

  const proposedPaths = new Set(proposal.files.map((file) => file.path));
  const sectionPaths = new Set(parsed.sections.map((section) => section.path));

  if (sectionPaths.size !== proposedPaths.size) {
    return fail("malformed_diff", "The diff and the affected file list do not describe the same files.");
  }
  for (const section of parsed.sections) {
    if (!proposedPaths.has(section.path)) {
      return fail("malformed_diff", "The diff references a file the proposal did not declare.", section.path);
    }
  }

  // Validate everything in memory before touching the disk.
  const prepared: { path: string; absolute: string; original: string; next: string }[] = [];

  for (const section of parsed.sections) {
    const resolved = await resolveTarget(rootAbs, section.path);
    if (!resolved.ok) return fail(resolved.failure.code, resolved.failure.message, section.path);

    const expected = snapshot.get(section.path);
    if (!expected) {
      return fail("missing_snapshot", "No snapshot hash was recorded for this file.", section.path);
    }
    if (sha256(resolved.content) !== expected) {
      return fail(
        "stale",
        "This file has changed since the proposal was created, so the proposal is stale.",
        section.path,
      );
    }

    const { lines, eol, trailing } = splitLines(resolved.content);
    const applied = applyHunks(lines, section.hunks);
    if (!applied.ok) return fail("conflict", applied.message, section.path);

    const next = applied.lines.join(eol) + (trailing ? eol : "");
    if (next === resolved.content) {
      return fail("no_change", "Applying this hunk would not change the file.", section.path);
    }

    prepared.push({
      path: section.path,
      absolute: resolved.absolute,
      original: resolved.content,
      next,
    });
  }

  const written: { path: string; absolute: string; original: string }[] = [];

  for (const file of prepared) {
    try {
      await write(file.absolute, file.next);
      written.push({ path: file.path, absolute: file.absolute, original: file.original });
    } catch {
      const unrestored: string[] = [];

      for (const entry of written) {
        try {
          await write(entry.absolute, entry.original);
        } catch {
          unrestored.push(entry.path);
        }
      }

      const rolledBack = unrestored.length === 0;

      return {
        ok: false,
        failure: {
          code: "io_error",
          message: rolledBack
            ? "Writing the patch failed. Every change was rolled back, so the files are unchanged."
            : `Writing the patch failed and these files could not be restored: ${unrestored.join(", ")}.`,
          path: file.path,
        },
        // `applied` means "still modified on disk". After a complete rollback
        // nothing is applied, so a retry is safe.
        applied: rolledBack ? [] : unrestored,
        rolledBack,
      };
    }
  }

  return { ok: true, applied: prepared.map((file) => file.path) };
}

/**
 * Captures the current content hash of every file a proposal touches.
 *
 * The workflow service calls this when a proposal is created, so a later
 * approval can prove the files have not changed in the meantime.
 */
export async function captureProposalSnapshot(
  projectRoot: string,
  proposal: CodingProposal,
): Promise<CodingProposal> {
  const rootAbs = path.resolve(projectRoot);
  const snapshot: { path: string; sha256: string }[] = [];

  for (const file of proposal.files) {
    const resolved = await resolveTarget(rootAbs, file.path);
    if (!resolved.ok) continue;
    snapshot.push({ path: file.path, sha256: sha256(resolved.content) });
  }

  return { ...proposal, snapshot };
}