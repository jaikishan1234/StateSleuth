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
import { PERMITTED_SOURCE_FILES } from "./coding-paths.ts";
import {
  buildFixtureProposal,
  validateProposal,
  type CodingProposal,
  type ProposalSource,
} from "./coding-proposal.ts";
import { callChatCompletion } from "./planner-server.ts";
import { ProviderError, resolveProviderConfig } from "./provider-config.ts";
import type { FeaturePlan } from "./planner.ts";
import { extractJsonObject } from "./planner.ts";

/** Maximum bytes read from any one permitted file. */
const MAX_FILE_BYTES = 24_000;

/** Maximum number of permitted files included in the model prompt. */
const MAX_CONTEXT_FILES = 6;

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
- Only propose changes to files that appear in the provided context. Never invent new paths.
- Make the smallest change that satisfies the plan. Do not reformat unrelated code.
- Do not include secrets, API keys, credentials or environment files.
- The diff is a PROPOSAL for human review. Never claim it has been applied or tested.`;

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
 * Reads the permitted source files for context.
 *
 * Only files on the allowlist are opened. A read failure is skipped rather
 * than fatal, so a missing file cannot break proposal generation.
 */
export async function readPermittedSources(
  projectRoot: string = process.cwd(),
  limit: number = MAX_CONTEXT_FILES,
): Promise<PermittedFileContent[]> {
  const contents: PermittedFileContent[] = [];

  for (const relative of PERMITTED_SOURCE_FILES) {
    if (contents.length >= limit) break;

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

  let completion: Awaited<ReturnType<typeof callChatCompletion>>;
  try {
    const sources = await readPermittedSources(request.projectRoot);
    completion = await callChatCompletion(
      "coding",
      CODING_SYSTEM_PROMPT,
      buildUserPrompt(request, sources),
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
      error:
        providerError.code === "timeout"
          ? "The coding request timed out. No fixture proposal was substituted."
          : `The coding request failed (${providerError.code}). No fixture proposal was substituted.`,
      issues: [providerError.message],
    };
  }

  const raw = completion.content;
  const parsed = extractJsonObject(raw);
  if (parsed === null) {
    console.error("[coding] proposal output was not valid JSON");
    return {
      ok: false,
      error: "The model did not return a readable proposal.",
    };
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
      error: "The model returned a proposal that failed validation.",
      issues: validated.issues,
    };
  }

  return { ok: true, proposal: validated.proposal };
}
