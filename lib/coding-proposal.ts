/**
 * Coding proposal: the type, its validation, and the deterministic fixture.
 *
 * A proposal is a REVIEWABLE artefact. It is a diff, a list of affected files
 * and an explanation. It is never applied by this module, and it never
 * contains a credential.
 */

import { checkRelativePath, isPermittedSourceFile } from "./coding-paths.ts";

/** Where a proposal came from. `fixture` is never an AI result. */
export type ProposalSource = "live" | "fixture";

export type ProposalFile = {
  /** Project-relative path, always on the permitted allowlist. */
  path: string;
  /** What the change does to the file. */
  change: "add" | "modify" | "delete";
  /** One line describing the edit. */
  summary: string;
};

/** A content hash taken when the proposal was created. */
export type ProposalSnapshot = {
  path: string;
  sha256: string;
};

export type CodingProposal = {
  id: string;
  /** `live` means a model produced this. `fixture` means it did not. */
  source: ProposalSource;
  /** The model identifier, present only for a live proposal. */
  model?: string;
  /** Concise explanation of the approach. */
  explanation: string;
  /** The files the proposal touches. */
  files: ProposalFile[];
  /** A unified diff, reviewable in a normal diff viewer. */
  diff: string;
  createdAt: number;
  /** Always set for a fixture, so it can never be mistaken for AI output. */
  notice?: string;
  /**
   * Hashes of the target files at proposal time. Required before the patch may
   * be applied: a mismatch means the file changed and the proposal is stale.
   */
  snapshot?: ProposalSnapshot[];
};

export const PROPOSAL_LIMITS = {
  explanationMax: 2_000,
  fileCountMax: 20,
  diffMax: 120_000,
  summaryMax: 200,
} as const;

export const FIXTURE_NOTICE =
  "Test fixture: this proposal was generated deterministically by the local test fixture, not by an AI model. It exists so the review flow can be exercised when the model provider is unavailable.";

export type ProposalValidation =
  | { ok: true; proposal: CodingProposal }
  | { ok: false; issues: string[] };

function readText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

/** Extracts the file paths referenced by a unified diff header. */
export function diffHeaderPaths(diff: string): string[] {
  const paths: string[] = [];
  for (const line of diff.split("\n")) {
    const match = /^(?:---|\+\+\+)\s+(?:[ab]\/)?(.+?)\s*$/.exec(line);
    if (!match) continue;
    const candidate = match[1] ?? "";
    if (!candidate || candidate === "/dev/null") continue;
    paths.push(candidate);
  }
  return [...new Set(paths)];
}

/** True when the diff looks like a unified diff. */
export function looksLikeUnifiedDiff(diff: string): boolean {
  return /^(---|\+\+\+)\s/m.test(diff) && /^@@\s/m.test(diff);
}

/**
 * Validates a raw proposal from the model.
 *
 * Every path is checked against the allowlist, both on the file list and on
 * the diff headers, so a model cannot smuggle in a path it should not touch.
 */
export function validateProposal(
  value: unknown,
  options: { source: ProposalSource; model?: string; id: string; createdAt: number },
): ProposalValidation {
  const issues: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: ["proposal is not a JSON object"] };
  }

  const raw = value as Record<string, unknown>;

  const explanation = readText(raw.explanation, PROPOSAL_LIMITS.explanationMax);
  if (!explanation) issues.push("explanation is missing or too long");

  const diff = readText(raw.diff, PROPOSAL_LIMITS.diffMax);
  if (!diff) {
    issues.push("diff is missing or too long");
  } else if (!looksLikeUnifiedDiff(diff)) {
    issues.push("diff does not look like a unified diff");
  }

  const filesRaw = raw.files;
  const files: ProposalFile[] = [];
  if (!Array.isArray(filesRaw)) {
    issues.push("files is missing");
  } else if (filesRaw.length === 0 || filesRaw.length > PROPOSAL_LIMITS.fileCountMax) {
    issues.push(`files must contain 1-${PROPOSAL_LIMITS.fileCountMax} entries`);
  } else {
    for (const entry of filesRaw) {
      if (typeof entry !== "object" || entry === null) {
        issues.push("files contains a non-object entry");
        break;
      }
      const record = entry as Record<string, unknown>;
      const path = record.path;
      const check = checkRelativePath(path);
      if (!check.ok) {
        issues.push(`files entry is not a safe path: ${check.message}`);
        break;
      }
      if (!isPermittedSourceFile(check.path)) {
        issues.push(`files entry is not on the permitted allowlist: ${check.path}`);
        break;
      }
      const change = record.change;
      if (change !== "add" && change !== "modify" && change !== "delete") {
        issues.push("files entry has an unknown change type");
        break;
      }
      const summary = readText(record.summary, PROPOSAL_LIMITS.summaryMax);
      if (!summary) {
        issues.push("files entry is missing a summary");
        break;
      }
      files.push({ path: check.path, change, summary });
    }
  }

  if (diff) {
    for (const path of diffHeaderPaths(diff)) {
      const check = checkRelativePath(path);
      if (!check.ok) {
        issues.push(`diff references an unsafe path: ${check.message}`);
        break;
      }
      if (!isPermittedSourceFile(check.path)) {
        issues.push(`diff references a path that is not on the permitted allowlist: ${check.path}`);
        break;
      }
    }
  }

  if (issues.length > 0 || !explanation || !diff) {
    return { ok: false, issues: issues.length > 0 ? issues : ["proposal did not match the expected shape"] };
  }

  return {
    ok: true,
    proposal: {
      id: options.id,
      source: options.source,
      ...(options.model ? { model: options.model } : {}),
      explanation,
      files,
      diff,
      createdAt: options.createdAt,
      ...(options.source === "fixture" ? { notice: FIXTURE_NOTICE } : {}),
    },
  };
}

/**
 * Structural check for a proposal that is already attached to a workflow.
 *
 * This is the gate used by the workflow domain before allowing a workflow into
 * `awaiting_code_approval`: the stored proposal must be well formed, every
 * file must be on the allowlist, and every path named in the diff must be too.
 */
export function isStoredProposal(value: unknown): value is CodingProposal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0) return false;
  if (candidate.source !== "live" && candidate.source !== "fixture") return false;
  if (typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt)) return false;
  if (candidate.model !== undefined && typeof candidate.model !== "string") return false;
  if (candidate.notice !== undefined && typeof candidate.notice !== "string") return false;

  const explanation = readText(candidate.explanation, PROPOSAL_LIMITS.explanationMax);
  if (!explanation) return false;

  const diff = readText(candidate.diff, PROPOSAL_LIMITS.diffMax);
  if (!diff || !looksLikeUnifiedDiff(diff)) return false;

  if (
    !Array.isArray(candidate.files) ||
    candidate.files.length === 0 ||
    candidate.files.length > PROPOSAL_LIMITS.fileCountMax
  ) {
    return false;
  }

  for (const entry of candidate.files) {
    if (typeof entry !== "object" || entry === null) return false;
    const file = entry as Record<string, unknown>;
    const check = checkRelativePath(file.path);
    if (!check.ok || !isPermittedSourceFile(check.path)) return false;
    if (file.change !== "add" && file.change !== "modify" && file.change !== "delete") return false;
    if (!readText(file.summary, PROPOSAL_LIMITS.summaryMax)) return false;
  }

  for (const path of diffHeaderPaths(diff)) {
    if (!isPermittedSourceFile(path)) return false;
  }

  if (candidate.snapshot !== undefined) {
    if (!Array.isArray(candidate.snapshot) || candidate.snapshot.length > PROPOSAL_LIMITS.fileCountMax) {
      return false;
    }
    for (const entry of candidate.snapshot) {
      if (typeof entry !== "object" || entry === null) return false;
      const record = entry as Record<string, unknown>;
      if (typeof record.path !== "string" || !isPermittedSourceFile(record.path)) return false;
      if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(record.sha256)) return false;
    }
  }

  return true;
}

/**
 * The deterministic fixture.
 *
 * It proposes one small, safe change to a permitted file. It is clearly
 * labelled and is never presented as model output.
 */
export function buildFixtureProposal(options: {
  id: string;
  createdAt: number;
  featureRequest: string;
}): CodingProposal {
  const request = options.featureRequest.trim().replace(/\s+/g, " ");

  return {
    id: options.id,
    source: "fixture",
    explanation:
      `Test fixture proposal for: ${request}. This is a deterministic sample showing what a ` +
      "reviewable proposal looks like: one affected file, a unified diff, and a short " +
      "explanation. It was not produced by a model.",
    files: [
      {
        path: "lib/tasks.ts",
        change: "modify",
        summary: "Record the source of a task so the origin of a change is inspectable.",
      },
    ],
    diff: [
      "--- a/lib/tasks.ts",
      "+++ b/lib/tasks.ts",
      "@@ -8,6 +8,7 @@ export type Task = {",
      "   id: string;",
      "   title: string;",
      "+  source?: string;",
      "   completed: boolean;",
      "   createdAt: number;",
      "   updatedAt: number;",
      " };",
      "",
    ].join("\n"),
    createdAt: options.createdAt,
    notice: FIXTURE_NOTICE,
  };
}
