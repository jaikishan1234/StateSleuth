/**
 * Coding agent: produces a REVIEWABLE proposal. It never applies a patch.
 *
 * Server-only. Reads only the explicitly permitted source files, asks the
 * model for a unified diff, and validates every path in the answer. When the
 * provider is unavailable, a clearly labelled deterministic fixture is used
 * instead so the review flow can still be exercised.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { CONTEXT_FILE_LIMIT, selectContextFiles } from "./coding-context.ts";
import {
  buildFixtureProposal,
  validateProposal,
  type CodingProposal,
  type ProposalSource,
} from "./coding-proposal.ts";
import { callChatCompletion } from "./planner-server.ts";
import { HUNK_COUNT_MISMATCH, parseUnifiedDiff } from "./unified-diff.ts";
import { ProviderError, resolveProviderConfig } from "./provider-config.ts";
import type { FeaturePlan } from "./planner.ts";
import { extractJsonObject } from "./planner.ts";

/** Maximum bytes read from any one permitted file. */
const MAX_FILE_BYTES = 24_000;

export const CODING_SYSTEM_PROMPT = `You are the coding half of StateSleuth, a verification-first coding agent.

You are given an approved feature plan and the current contents of a few source files. Propose the change that implements the plan.

Return ONLY a JSON object, with no markdown fences and no commentary, in exactly this shape:
{
  "explanation": "2-4 sentences on the approach and why it satisfies the plan",
  "files": [{ "path": "relative/path.ts", "change": "add" | "modify" | "delete", "summary": "one line" }],
  "diff": "a unified diff"
}

Rules:
- The diff MUST be a valid unified diff using "--- a/<path>" and "+++ b/<path>" headers and "@@" hunks.
- Every hunk MUST start with a complete header carrying real line numbers and counts, in exactly this form: "@@ -10,3 +10,4 @@". Never write a bare "@@", never omit the numbers or counts, and never merge separate changes into one hunk.
- The hunk counts MUST match the body: every unchanged context line starts with a space, every addition with "+", every removal with "-". Include the unchanged lines around a change; do not invent or drop them.
- Before returning, recount each hunk: oldCount = context lines + removed lines, newCount = context lines + added lines. If the counts do not match the body, fix the header.
- Emit the complete diff. Do not elide ranges, do not write "...", and do not put commentary, markers or notes (for example "*** End of File ***") anywhere inside the diff.
- Only propose changes to files that appear in the provided context. Never invent new paths.
- Make the smallest change that satisfies the plan. Do not reformat unrelated code.
- Do not include secrets, API keys, credentials or environment files.
- Return the JSON object and nothing else: no prose, no markdown fences, no explanation outside the "explanation" field. The diff is a PROPOSAL for human review: never claim it has been applied or tested.

Example of the only accepted diff shape (note the header numbers and that context lines begin with a single space):
--- a/lib/tasks.ts
+++ b/lib/tasks.ts
@@ -4,3 +4,4 @@
   id: string,
+  source?: string,
   title: string,
   completed: boolean,`;

export type ProposalRequest = {
  featureRequest: string;
  plan: FeaturePlan;
  id: string;
  createdAt: number;
  /** Forces the deterministic fixture regardless of provider availability. */
  useFixture?: boolean;
  projectRoot?: string;
  /** Test seam: lets tests inspect and stub the outbound request. */
  fetchImpl?: typeof fetch;
};

export type ProposalResult =
  | { ok: true; proposal: CodingProposal }
  | { ok: false; error: string; issues?: string[] };

export type PermittedFileContent = {
  path: string;
  content: string;
  truncated: boolean;
};

/**
 * Reads the context files for a feature request.
 *
 * The request selects which allowlisted files are worth sending; see
 * lib/coding-context.ts. Selection only narrows the prompt, never the edit
 * allowlist. A read failure is skipped rather than fatal, so a missing file
 * cannot break proposal generation.
 */
export async function readPermittedSources(
  projectRoot: string = process.cwd(),
  featureRequest: string = "",
  limit: number = CONTEXT_FILE_LIMIT,
): Promise<PermittedFileContent[]> {
  const contents: PermittedFileContent[] = [];

  for (const relative of selectContextFiles(featureRequest, limit)) {
    // turbopackIgnore: the path is a fixed relative file inside the project,
    // not a project-wide trace.
    const absolute = path.join(/* turbopackIgnore: true */ projectRoot, relative);
    try {
      const raw = await readFile(absolute, "utf8");
      const truncated = raw.length > MAX_FILE_BYTES;
      contents.push({
        path: relative,
        content: truncated ? `${raw.slice(0, MAX_FILE_BYTES)}\n… truncated …` : raw,
        truncated,
      });
    } catch {
      // A file that cannot be read is simply not offered as context.
    }
  }

  return contents;
}

function buildUserPrompt(
  request: ProposalRequest,
  sources: PermittedFileContent[],
): string {
  const lines: string[] = [];

  lines.push("## Feature request");
  lines.push(request.featureRequest.trim());
  lines.push("");

  lines.push("## Approved plan");
  lines.push(`Summary: ${request.plan.featureSummary.title}`);
  lines.push(request.plan.featureSummary.description);
  lines.push("");
  lines.push("Implementation steps:");
  request.plan.implementationSteps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step.title} — ${step.detail}`);
  });
  lines.push("");
  lines.push("Acceptance criteria:");
  request.plan.acceptanceCriteria.forEach((item) => lines.push(`- ${item}`));
  lines.push("");

  lines.push("## Current source files");
  if (sources.length === 0) {
    lines.push("(no source context was available)");
  }
  for (const source of sources) {
    lines.push("");
    lines.push(`### ${source.path}`);
    lines.push("```");
    lines.push(source.content);
    lines.push("```");
  }
  lines.push("");
  lines.push("## Task");
  lines.push(
    "Propose the unified diff that implements the approved plan, restricted to the files above.",
  );

  return lines.join("\n");
}

type AttemptResult =
  | { ok: true; proposal: CodingProposal }
  | {
      ok: false;
      kind: "provider" | "unreadable" | "validation" | "diff";
      error: string;
      issues?: string[];
      /** Parser message, when the failure was the strict diff parse. */
      reason?: string;
    };

/**
 * Strips control characters and caps length. The parser messages are our own
 * fixed literals, so this is defence in depth rather than a sanitisation of
 * model output.
 */
function sanitizeReason(reason: string): string {
  return reason
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function providerFailureMessage(error: ProviderError): string {
  if (error.code === "truncated") {
    return "The coding response was cut off at the output-token limit, so no complete diff was produced. Raise CODING_MAX_OUTPUT_TOKENS or ask for a smaller change. No fixture proposal was substituted.";
  }
  if (error.code === "timeout") {
    return "The coding request timed out. No fixture proposal was substituted.";
  }
  return `The coding request failed (${error.code}). No fixture proposal was substituted.`;
}

/**
 * The single corrective instruction used for the one retry. It names the
 * parser's reason and restates the counting rule, without suggesting that the
 * diff may be partial or approximate.
 */
function buildCorrectionPrompt(reason: string): string {
  return [
    "## Correction required",
    `Your previous answer was rejected by the strict diff validator: ${reason}.`,
    "Return the same proposal again, corrected.",
    "The diff must be a complete standard unified diff. Every hunk header must declare counts that exactly match its body:",
    "- unchanged context lines start with a single space,",
    "- added lines start with \"+\",",
    "- removed lines start with \"-\".",
    "Recount each hunk before returning: oldCount = context lines + removed lines, newCount = context lines + added lines.",
    "Do not omit context lines, do not elide ranges, and do not put prose inside the diff.",
  ].join("\n");
}

/**
 * One model call plus validation. Returns a structured failure so the caller
 * can decide whether the failure is retryable; it never throws for a provider
 * or output problem.
 */
async function attemptProposal(
  request: ProposalRequest,
  sources: PermittedFileContent[],
  correction?: string,
): Promise<AttemptResult> {
  const userPrompt = buildUserPrompt(request, sources);
  const prompted = correction ? `${userPrompt}\n\n${correction}` : userPrompt;

  let completion: Awaited<ReturnType<typeof callChatCompletion>>;
  try {
    completion = await callChatCompletion(
      "coding",
      CODING_SYSTEM_PROMPT,
      prompted,
      request.fetchImpl ? { fetchImpl: request.fetchImpl } : {},
    );
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError("request_failed", "The model request could not be completed.");
    console.error(`[coding] proposal request failed: ${providerError.message}`);

    return {
      ok: false,
      kind: "provider",
      error: providerFailureMessage(providerError),
      issues: [providerError.message],
    };
  }

  const parsed = extractJsonObject(completion.content);
  if (parsed === null) {
    console.error("[coding] proposal output was not valid JSON");
    return { ok: false, kind: "unreadable", error: "The model did not return a readable proposal." };
  }

  const validated = validateProposal(parsed, {
    source: "live" as ProposalSource,
    model: completion.model,
    id: request.id,
    createdAt: request.createdAt,
  });

  if (!validated.ok) {
    console.error("[coding] proposal failed validation:", validated.issues);
    return {
      ok: false,
      kind: "validation",
      error: "The model returned a proposal that failed validation.",
      issues: validated.issues,
    };
  }

  // The shape check above is deliberately broad; the applier's parser is the
  // authority on whether a diff is complete. Run it here so a malformed live
  // diff is an explicit error now, rather than a stored proposal that fails
  // later at approval time. The parser itself is unchanged and stays strict.
  const syntax = parseUnifiedDiff(validated.proposal.diff);
  if (!syntax.ok) {
    const reason = sanitizeReason(syntax.message);
    console.error(`[coding] proposal diff is malformed: ${reason}`);
    return {
      ok: false,
      kind: "diff",
      reason,
      // The UI renders this string, so the parser's reason is surfaced here
      // instead of being hidden behind a generic message.
      error: `The model returned a diff that is not a complete unified diff: ${reason}.`,
      issues: [reason],
    };
  }

  return { ok: true, proposal: validated.proposal };
}

/**
 * Produces a proposal.
 *
 * The provider is used when it is configured and reachable. When it is not
 * configured, the deterministic fixture is returned and labelled as such. A
 * configured-but-failing provider is reported as an error: a fixture is never
 * silently substituted for a live failure.
 */
export async function requestProposal(
  request: ProposalRequest,
): Promise<ProposalResult> {
  const resolution = resolveProviderConfig("coding");
  if (!resolution.ok) {
    return { ok: false, error: resolution.error.message };
  }

  const config = resolution.config;
  const useFixture = request.useFixture === true || !config.configured;

  if (useFixture) {
    return {
      ok: true,
      proposal: buildFixtureProposal({
        id: request.id,
        createdAt: request.createdAt,
        featureRequest: request.featureRequest,
      }),
    };
  }

  const sources = await readPermittedSources(request.projectRoot, request.featureRequest);

  const first = await attemptProposal(request, sources);
  if (first.ok) return { ok: true, proposal: first.proposal };

  // Exactly one retry, and only for the failure the parser can name precisely:
  // hunk counts that do not match the body. Every other failure is final.
  if (first.kind !== "diff" || first.reason !== HUNK_COUNT_MISMATCH) {
    return { ok: false, error: first.error, issues: first.issues };
  }

  console.error("[coding] hunk counts mismatched; retrying once with a correction");

  const retry = await attemptProposal(request, sources, buildCorrectionPrompt(first.reason));
  if (retry.ok) return { ok: true, proposal: retry.proposal };

  // The retry failed too. Report it explicitly; a configured provider never
  // falls back to the fixture.
  return {
    ok: false,
    error:
      retry.kind === "diff"
        ? `The model returned a diff that is not a complete unified diff after one corrective retry: ${retry.reason ?? "unknown parser error"}.`
        : retry.error,
    issues: retry.issues,
  };
}
