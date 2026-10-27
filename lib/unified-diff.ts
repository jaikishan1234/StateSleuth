/**
 * Pure unified-diff parser.
 *
 * Kept free of filesystem access so both sides of the safety story can share
 * exactly one definition: proposal validation (lib/coding-proposal.ts) and patch
 * application (lib/patch-apply.ts). A diff that this parser rejects is not a
 * complete diff, whether it arrived from a model or from a stored record.
 */

export type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

export type Section = { path: string; hunks: Hunk[] };

/**
 * The one parser failure the coding agent may retry. Exported so the retry
 * check and the parser message cannot drift apart.
 */
export const HUNK_COUNT_MISMATCH = "a hunk's line counts do not match its header";

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
        return { ok: false, message: HUNK_COUNT_MISMATCH };
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