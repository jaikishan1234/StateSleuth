/**
 * Where verification evidence lives on disk.
 *
 * Server-only. Kept separate from the browser runner so the workflow service
 * can resolve evidence paths without importing Playwright.
 *
 * Evidence is written under `.data/`, which is already ignored by git, next to
 * the workflow records. Nothing here is encrypted or access-controlled; it is
 * screenshots of a local demo app, for a single local user.
 */

import path from "node:path";
import { VERIFICATION_LIMITS } from "./verification.ts";

export function evidenceDir(): string {
  const configured = process.env.STATESLEUTH_EVIDENCE_DIR?.trim();
  if (configured && configured.length > 0) return configured;
  return path.join(process.cwd(), ".data", "evidence");
}

/**
 * Resolves an evidence file name to an absolute path, or null.
 *
 * The name must be a plain file name matching the server-generated pattern, so
 * a stored (or hand-edited) record can never escape the evidence directory.
 */
export function evidencePath(name: unknown): string | null {
  if (typeof name !== "string" || !VERIFICATION_LIMITS.screenshotPattern.test(name)) return null;
  // path.basename is redundant after the pattern check, but it keeps the
  // containment guarantee local and obvious.
  if (name !== path.basename(name)) return null;
  // turbopackIgnore: the file name is validated above and the directory is a
  // fixed local evidence folder, not a traced project path.
  return path.join(/* turbopackIgnore: true */ evidenceDir(), name);
}