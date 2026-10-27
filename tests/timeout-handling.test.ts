import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_TIMEOUT_MS,
  TIMEOUT_LIMITS,
  resolveProviderConfig,
  type ResolvedProvider,
} from "../lib/provider-config.ts";
import { callChatCompletion } from "../lib/planner-server.ts";

const ENV_KEYS = [
  "PLANNER_PROVIDER",
  "PLANNER_MODEL",
  "PLANNER_API_KEY",
  "PLANNER_BASE_URL",
  "PLANNER_MAX_OUTPUT_TOKENS",
  "PLANNER_TIMEOUT_MS",
  "CODING_PROVIDER",
  "CODING_MODEL",
  "CODING_API_KEY",
  "CODING_BASE_URL",
  "CODING_MAX_OUTPUT_TOKENS",
  "CODING_TIMEOUT_MS",
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

function configurePlanner(): void {
  process.env.PLANNER_PROVIDER = "openrouter";
  process.env.PLANNER_MODEL = "openrouter/free";
  process.env.PLANNER_API_KEY = "test-key";
}

function configureCoding(): void {
  process.env.CODING_PROVIDER = "groq";
  process.env.CODING_API_KEY = "test-key";
}

function resolved(agent: "planner" | "coding"): ResolvedProvider {
  const result = resolveProviderConfig(agent);
  if (!result.ok) throw new Error(`expected a resolution, got ${result.error.code}`);
  return result.config;
}

/** A 200 response whose body fails part-way through, as an abort would. */
function bodyFailingWith(name: string, message: string): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"choices":'));
          setTimeout(() => controller.error(new DOMException(message, name)), 5);
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as unknown as typeof fetch;
}

function bodyOf(text: string): typeof fetch {
  return (async () =>
    new Response(text, { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
}

async function errorOf(fetchImpl: typeof fetch): Promise<{ code?: string; message: string }> {
  try {
    await callChatCompletion("planner", "s", "u", { fetchImpl });
    assert.fail("expected the call to fail");
  } catch (error) {
    return error as { code?: string; message: string };
  }
}

describe("body-read timeout classification", () => {
  it("reports a TimeoutError raised while reading the body as a timeout", async () => {
    configurePlanner();
    const error = await errorOf(bodyFailingWith("TimeoutError", "The operation was aborted due to timeout"));
    assert.equal(error.code, "timeout");
    assert.match(error.message, /timed out before it was fully received/);
  });

  it("reports an AbortError raised while reading the body as a timeout", async () => {
    configurePlanner();
    const error = await errorOf(bodyFailingWith("AbortError", "The operation was aborted"));
    assert.equal(error.code, "timeout");
    assert.match(error.message, /timed out before it was fully received/);
  });

  it("keeps malformed JSON classified as a bad response", async () => {
    configurePlanner();
    const error = await errorOf(bodyOf("<html>upstream error</html>"));
    assert.equal(error.code, "bad_response");
    assert.match(error.message, /unreadable response/);
  });

  it("keeps an empty body classified as a bad response", async () => {
    configurePlanner();
    const error = await errorOf(bodyOf(""));
    assert.equal(error.code, "bad_response");
    assert.match(error.message, /unreadable response/);
  });

  it("returns content from a successful response", async () => {
    configurePlanner();
    const completion = await callChatCompletion("planner", "s", "u", {
      fetchImpl: bodyOf(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      ),
    });
    assert.equal(completion.content, "ok");
    assert.equal(completion.provider, "openrouter");
  });
});

describe("planner timeout configuration", () => {
  it("defaults the planner to 90s and leaves the coding agent at 45s", () => {
    configurePlanner();
    configureCoding();
    assert.equal(DEFAULT_TIMEOUT_MS.planner, 90_000);
    assert.equal(DEFAULT_TIMEOUT_MS.coding, 45_000);
    assert.equal(resolved("planner").timeoutMs, 90_000);
    assert.equal(resolved("coding").timeoutMs, 45_000);
  });

  it("honours PLANNER_TIMEOUT_MS at the range boundaries", () => {
    configurePlanner();
    process.env.PLANNER_TIMEOUT_MS = String(TIMEOUT_LIMITS.min);
    assert.equal(resolved("planner").timeoutMs, TIMEOUT_LIMITS.min);

    process.env.PLANNER_TIMEOUT_MS = String(TIMEOUT_LIMITS.max);
    assert.equal(resolved("planner").timeoutMs, TIMEOUT_LIMITS.max);
  });

  it("treats an empty setting as the default", () => {
    configurePlanner();
    process.env.PLANNER_TIMEOUT_MS = "   ";
    assert.equal(resolved("planner").timeoutMs, 90_000);
  });

  it("refuses an unusable timeout instead of guessing", () => {
    configurePlanner();
    for (const value of ["0", "4999", "300001", "1.5", "abc", "-1"]) {
      process.env.PLANNER_TIMEOUT_MS = value;
      const result = resolveProviderConfig("planner");
      assert.equal(result.ok, false, value);
      if (result.ok) continue;
      assert.equal(result.error.code, "invalid_timeout", value);
      assert.match(result.error.message, /PLANNER_TIMEOUT_MS/, value);
    }
  });

  it("does not echo an offending timeout value back", () => {
    configurePlanner();
    process.env.PLANNER_TIMEOUT_MS = "400000";
    const result = resolveProviderConfig("planner");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.message.includes("400000"), false);
  });

  it("does not apply PLANNER_TIMEOUT_MS to the coding agent", () => {
    configurePlanner();
    configureCoding();
    process.env.PLANNER_TIMEOUT_MS = "120000";
    assert.equal(resolved("planner").timeoutMs, 120_000);
    assert.equal(resolved("coding").timeoutMs, 45_000);
  });
});