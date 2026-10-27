import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  OUTPUT_TOKEN_LIMITS,
  buildChatRequest,
  resolveProviderConfig,
  type ResolvedProvider,
} from "../lib/provider-config.ts";
import { callChatCompletion } from "../lib/planner-server.ts";
import { requestProposal } from "../lib/coding-agent.ts";
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

function resolved(agent: "planner" | "coding"): ResolvedProvider {
  const result = resolveProviderConfig(agent);
  if (!result.ok) throw new Error(`expected a resolution, got ${result.error.code}`);
  return result.config;
}

function configureBoth(): void {
  process.env.PLANNER_API_KEY = "planner-test-key";
  process.env.CODING_PROVIDER = "groq";
  process.env.CODING_API_KEY = "coding-test-key";
}

describe("output budgets", () => {
  it("defaults the planner and coding agent independently", () => {
    configureBoth();
    assert.equal(resolved("planner").maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS.planner);
    assert.equal(resolved("coding").maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS.coding);
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS.planner, 1600);
    assert.equal(DEFAULT_MAX_OUTPUT_TOKENS.coding, 4000);
  });

  it("uses the agent budget as the request's max_tokens", () => {
    configureBoth();
    const plannerRequest = buildChatRequest(resolved("planner"), "sys", "user");
    const codingRequest = buildChatRequest(resolved("coding"), "sys", "user");
    assert.equal(plannerRequest.body.max_tokens, 1600);
    assert.equal(codingRequest.body.max_tokens, 4000);
  });

  it("overrides the coding budget without touching the planner", () => {
    configureBoth();
    process.env.CODING_MAX_OUTPUT_TOKENS = "8000";
    assert.equal(resolved("coding").maxOutputTokens, 8000);
    assert.equal(resolved("planner").maxOutputTokens, 1600);
    assert.equal(buildChatRequest(resolved("coding"), "s", "u").body.max_tokens, 8000);
  });

  it("overrides the planner budget without touching the coding agent", () => {
    configureBoth();
    process.env.PLANNER_MAX_OUTPUT_TOKENS = "900";
    assert.equal(resolved("planner").maxOutputTokens, 900);
    assert.equal(resolved("coding").maxOutputTokens, 4000);
  });

  it("treats an empty setting as the default", () => {
    configureBoth();
    process.env.CODING_MAX_OUTPUT_TOKENS = "   ";
    assert.equal(resolved("coding").maxOutputTokens, 4000);
  });

  it("accepts the boundary values", () => {
    configureBoth();
    process.env.PLANNER_MAX_OUTPUT_TOKENS = String(OUTPUT_TOKEN_LIMITS.min);
    process.env.CODING_MAX_OUTPUT_TOKENS = String(OUTPUT_TOKEN_LIMITS.max);
    assert.equal(resolved("planner").maxOutputTokens, OUTPUT_TOKEN_LIMITS.min);
    assert.equal(resolved("coding").maxOutputTokens, OUTPUT_TOKEN_LIMITS.max);
  });

  it("refuses an unusable budget instead of guessing", () => {
    configureBoth();
    for (const value of ["0", "-1", "1.5", "abc", String(OUTPUT_TOKEN_LIMITS.max + 1)]) {
      process.env.CODING_MAX_OUTPUT_TOKENS = value;
      const result = resolveProviderConfig("coding");
      assert.equal(result.ok, false, value);
      if (result.ok) continue;
      assert.equal(result.error.code, "invalid_output_limit", value);
      assert.match(result.error.message, /CODING_MAX_OUTPUT_TOKENS/, value);
    }
  });

  it("does not echo an offending budget value back", () => {
    configureBoth();
    process.env.CODING_MAX_OUTPUT_TOKENS = "999999";
    const result = resolveProviderConfig("coding");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.message.includes("999999"), false);
  });
});

describe("truncated model output", () => {
  function responseWith(finishReason: string | undefined, content: string): typeof fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content }, ...(finishReason ? { finish_reason: finishReason } : {}) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;
  }

  it("fails with a truncated error when the provider hit the output limit", async () => {
    configureBoth();
    try {
      await callChatCompletion("coding", "s", "u", {
        fetchImpl: responseWith("length", '{"explanation":"half a prop'),
      });
      assert.fail("expected a truncated error");
    } catch (error) {
      assert.equal((error as { code?: string }).code, "truncated");
      assert.match((error as Error).message, /output-token limit/);
    }
  });

  it("still returns complete output", async () => {
    configureBoth();
    const completion = await callChatCompletion("coding", "s", "u", {
      fetchImpl: responseWith("stop", "ok"),
    });
    assert.equal(completion.content, "ok");
  });

  it("returns a safe error from the coding agent, never a fixture", async () => {
    configureBoth();
    const result = await requestProposal({
      featureRequest: "Renaming a completed task must keep it completed.",
      plan: buildFixturePlan("Renaming a completed task must keep it completed."),
      id: "prop_truncated",
      createdAt: 1,
      fetchImpl: responseWith("length", '{"explanation":"half a prop'),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /output-token limit/);
    assert.match(result.error, /No fixture proposal was substituted/);
    assert.equal("proposal" in result, false);
  });
});