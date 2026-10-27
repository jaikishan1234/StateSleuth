import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import {
  CODING_SYSTEM_PROMPT,
  requestProposal,
} from "../lib/coding-agent.ts";
import {
  buildFixtureProposal,
  isStoredProposal,
  looksLikeUnifiedDiff,
  validateProposal,
} from "../lib/coding-proposal.ts";
import { parseUnifiedDiff } from "../lib/patch-apply.ts";
import { buildFixturePlan } from "../lib/planner.ts";

const ENV_KEYS = [
  "PLANNER_PROVIDER",
  "PLANNER_MODEL",
  "PLANNER_API_KEY",
  "PLANNER_BASE_URL",
  "PLANNER_MAX_OUTPUT_TOKENS",
  "CODING_PROVIDER",
  "CODING_MODEL",
  "CODING_API_KEY",
  "CODING_BASE_URL",
  "CODING_MAX_OUTPUT_TOKENS",
  "MODEL_PROVIDER",
  "MODEL_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(clearEnv);
after(clearEnv);

/** A complete, well-formed hunk: 3 old lines, 4 new lines. */
const VALID_DIFF = [
  "--- a/lib/tasks.ts",
  "+++ b/lib/tasks.ts",
  "@@ -10,3 +10,4 @@ export function renameTask(",
  "   id: string,",
  "+  source?: string;",
  "   title: string,",
  "   completed: boolean,",
  "",
].join("\n");

/** The failure the live Groq run produced: a header with no line numbers. */
const BARE_HEADER_DIFF = [
  "--- a/lib/tasks.ts",
  "+++ b/lib/tasks.ts",
  "@@",
  " export function renameTask(",
  "   id: string,",
  "-  const trimmed = cleanTitle(title);",
  "+  const trimmed = cleanTitle(title).trim();",
  "   return tasks;",
  "",
].join("\n");

function proposal(diff: string): unknown {
  return {
    explanation: "Preserve the completion flag when a task is renamed.",
    files: [{ path: "lib/tasks.ts", change: "modify", summary: "Merge into the existing task." }],
    diff,
  };
}

describe("unified diff syntax", () => {
  it("rejects a bare @@ hunk header", () => {
    const result = parseUnifiedDiff(BARE_HEADER_DIFF);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /hunk header is malformed/);
  });

  it("accepts a hunk header with line numbers and counts", () => {
    const result = parseUnifiedDiff(VALID_DIFF);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.sections.length, 1);
    assert.equal(result.sections[0]?.path, "lib/tasks.ts");
    const hunk = result.sections[0]?.hunks[0];
    assert.equal(hunk?.oldStart, 10);
    assert.equal(hunk?.oldCount, 3);
    assert.equal(hunk?.newStart, 10);
    assert.equal(hunk?.newCount, 4);
  });

  it("rejects a header whose counts do not match the body", () => {
    const mismatched = VALID_DIFF.replace("@@ -10,3 +10,4 @@", "@@ -10,9 +10,9 @@");
    const result = parseUnifiedDiff(mismatched);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /line counts do not match/);
  });

  it("rejects commentary inside the diff", () => {
    const withProse = `${VALID_DIFF}*** End of File ***\n`;
    const result = parseUnifiedDiff(withProse);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /not part of a hunk/);
  });

  it("agrees with the shape check used before a proposal is stored", () => {
    assert.equal(looksLikeUnifiedDiff(BARE_HEADER_DIFF), false);
    assert.equal(looksLikeUnifiedDiff(VALID_DIFF), true);
  });
});

describe("proposal validation uses the strict header rule", () => {
  const options = { source: "live" as const, model: "test-model", id: "prop_1", createdAt: 1 };

  it("refuses a proposal with a bare @@ header", () => {
    const result = validateProposal(proposal(BARE_HEADER_DIFF), options);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(
      result.issues.some((issue) => /diff/i.test(issue)),
      `expected a diff issue, got: ${result.issues.join("; ")}`,
    );
    assert.equal(isStoredProposal({ ...(proposal(BARE_HEADER_DIFF) as object), source: "live", createdAt: 1 }), false);
  });

  it("accepts a well-formed diff", () => {
    const result = validateProposal(proposal(VALID_DIFF), options);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.proposal.diff, VALID_DIFF.trimEnd());
  });
});

describe("malformed live output is an explicit error", () => {
  function liveReplyWith(diff: string): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify(proposal(diff)) }, finish_reason: "stop" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
  }

  function configureCoding(): void {
    process.env.CODING_PROVIDER = "groq";
    process.env.CODING_API_KEY = "test-key";
  }

  it("fails the proposal instead of substituting a fixture", async () => {
    configureCoding();

    const result = await requestProposal({
      featureRequest: "Renaming a completed task must keep it completed.",
      plan: buildFixturePlan("Renaming a completed task must keep it completed."),
      id: "prop_bare",
      createdAt: 1,
      fetchImpl: liveReplyWith(BARE_HEADER_DIFF),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /failed validation/);
    assert.equal("proposal" in result, false, "no fixture proposal may be substituted");
  });

  it("fails a diff that the applier's parser rejects, even with a valid header", async () => {
    configureCoding();

    // A correct header shape with wrong counts passes the broad shape check but
    // is not a complete diff; the parser must still reject it.
    const mismatched = VALID_DIFF.replace("@@ -10,3 +10,4 @@", "@@ -10,9 +10,9 @@");

    const result = await requestProposal({
      featureRequest: "Renaming a completed task must keep it completed.",
      plan: buildFixturePlan("Renaming a completed task must keep it completed."),
      id: "prop_counts",
      createdAt: 1,
      fetchImpl: liveReplyWith(mismatched),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /not a complete unified diff/);
    assert.match((result.issues ?? []).join(" "), /line counts do not match/);
    assert.equal("proposal" in result, false, "no fixture proposal may be substituted");
  });
});

describe("stored proposals use the same strict parser", () => {
  function stored(diff: string): unknown {
    return {
      id: "prop_stored",
      source: "fixture",
      explanation: "Preserve the completion flag when a task is renamed.",
      files: [{ path: "lib/tasks.ts", change: "modify", summary: "Merge into the existing task." }],
      diff,
      createdAt: 1,
    };
  }

  it("accepts a stored proposal whose diff parses", () => {
    assert.equal(isStoredProposal(stored(VALID_DIFF)), true);
    assert.equal(
      isStoredProposal(
        buildFixtureProposal({ id: "prop_fixture", createdAt: 1, featureRequest: "Add a field." }),
      ),
      true,
    );
  });

  it("refuses a stored proposal with a bare @@ header", () => {
    assert.equal(isStoredProposal(stored(BARE_HEADER_DIFF)), false);
  });

  it("refuses a stored proposal whose hunk counts are wrong", () => {
    const mismatched = VALID_DIFF.replace("@@ -10,3 +10,4 @@", "@@ -10,9 +10,9 @@");
    assert.equal(isStoredProposal(stored(mismatched)), false);
  });

  it("refuses a stored proposal with prose inside the diff", () => {
    assert.equal(isStoredProposal(stored(`${VALID_DIFF}*** End of File ***\n`)), false);
  });

  it("keeps a trailing whitespace-only context line intact", () => {
    // A diff may legitimately end with a context line for an empty line, which
    // is a single space. Trimming it would change the counts, so the parser
    // must see the stored bytes.
    const diff = [
      "--- a/lib/tasks.ts",
      "+++ b/lib/tasks.ts",
      "@@ -1,2 +1,3 @@",
      " export const A = 1;",
      "+export const B = 2;",
      " ",
    ].join("\n");
    assert.equal(parseUnifiedDiff(diff).ok, true);
    assert.equal(isStoredProposal(stored(diff)), true);
  });
});

describe("coding agent instructions", () => {
  it("demand a complete hunk header with numbers", () => {
    assert.match(CODING_SYSTEM_PROMPT, /@@ -10,3 \+10,4 @@/);
    assert.match(CODING_SYSTEM_PROMPT, /bare "@@"/);
  });

  it("forbid elided ranges and commentary inside the diff", () => {
    assert.match(CODING_SYSTEM_PROMPT, /Do not elide ranges/);
    assert.match(CODING_SYSTEM_PROMPT, /no prose/i);
  });
});