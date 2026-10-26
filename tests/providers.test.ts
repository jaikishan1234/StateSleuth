import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import {
  PROVIDER_DEFAULTS,
  ProviderError,
  buildChatRequest,
  providerErrorForStatus,
  providerErrorFromUnknown,
  resolveProviderConfig,
  type ResolvedProvider,
} from "../lib/provider-config.ts";
import { generatePlan, callChatCompletion } from "../lib/planner-server.ts";
import { requestProposal } from "../lib/coding-agent.ts";
import { isPermittedSourceFile } from "../lib/coding-paths.ts";

const ENV_KEYS = [
  "PLANNER_PROVIDER",
  "PLANNER_MODEL",
  "PLANNER_API_KEY",
  "PLANNER_BASE_URL",
  "CODING_PROVIDER",
  "CODING_MODEL",
  "CODING_API_KEY",
  "CODING_BASE_URL",
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

type FetchCall = { url: string; init: RequestInit | undefined };

function stubFetch(options: {
  status?: number;
  body?: unknown;
  rawBody?: string;
  throwError?: unknown;
  calls?: FetchCall[];
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    options.calls?.push({ url: String(input), init });
    if (options.throwError) throw options.throwError;
    const status = options.status ?? 200;
    const payload =
      options.rawBody !== undefined
        ? options.rawBody
        : JSON.stringify(options.body ?? { choices: [{ message: { content: "{}" } }] });
    return new Response(payload, { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

function planPayload(plan: unknown): unknown {
  return { choices: [{ message: { content: JSON.stringify(plan) } }] };
}

const VALID_PLAN = {
  featureSummary: { title: "Due dates", description: "Tasks can have due dates." },
  implementationSteps: [{ title: "Store the date", detail: "Add a field." }],
  acceptanceCriteria: ["A task can carry a due date."],
  browserVerificationSteps: ["Open the demo."],
  expectedResults: ["The date survives a reload."],
  edgeCases: ["A date in the past."],
};

describe("provider resolution", () => {
  it("defaults to Gemini and stays unconfigured without a key", () => {
    const config = resolved("planner");
    assert.equal(config.provider, "gemini");
    assert.equal(config.model, "gemini-3.8-flash");
    assert.equal(config.baseUrl, PROVIDER_DEFAULTS.gemini.baseUrl);
    assert.equal(config.configured, false);
    assert.equal(config.apiKey, undefined);
  });

  it("preserves the existing Gemini environment shape", () => {
    process.env.PLANNER_API_KEY = "gemini-test-key";
    process.env.PLANNER_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
    process.env.PLANNER_MODEL = "gemini-3.8-flash";

    const config = resolved("planner");
    assert.equal(config.provider, "gemini");
    assert.equal(config.model, "gemini-3.8-flash");
    assert.equal(config.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
    assert.equal(config.configured, true);
    assert.equal(config.apiKey, "gemini-test-key");
  });

  it("configures planner and coding agent independently", () => {
    process.env.PLANNER_API_KEY = "planner-key";
    process.env.CODING_PROVIDER = "groq";
    process.env.CODING_API_KEY = "coding-key";
    process.env.CODING_MODEL = "llama-test";

    const planner = resolved("planner");
    const coding = resolved("coding");

    assert.equal(planner.provider, "gemini");
    assert.equal(planner.model, "gemini-3.8-flash");
    assert.equal(coding.provider, "groq");
    assert.equal(coding.model, "llama-test");
    assert.equal(coding.baseUrl, "https://api.groq.com/openai/v1");
    assert.equal(coding.apiKey, "coding-key");
  });

  it("uses provider defaults for Groq and OpenRouter", () => {
    process.env.MODEL_PROVIDER = "groq";
    process.env.MODEL_API_KEY = "shared-key";
    const groq = resolved("planner");
    assert.equal(groq.baseUrl, "https://api.groq.com/openai/v1");
    assert.equal(groq.model, "llama-3.3-70b-versatile");

    process.env.MODEL_PROVIDER = "openrouter";
    const openrouter = resolved("coding");
    assert.equal(openrouter.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(openrouter.model, "openai/gpt-4o-mini");
  });

  it("applies the documented key precedence", () => {
    process.env.CODING_PROVIDER = "groq";
    process.env.CODING_API_KEY = "agent-key";
    process.env.GROQ_API_KEY = "provider-key";
    process.env.MODEL_API_KEY = "shared-key";
    assert.equal(resolved("coding").apiKey, "agent-key");

    delete process.env.CODING_API_KEY;
    assert.equal(resolved("coding").apiKey, "provider-key");

    delete process.env.GROQ_API_KEY;
    assert.equal(resolved("coding").apiKey, "shared-key");
  });

  it("lets the agent provider override the shared one", () => {
    process.env.MODEL_PROVIDER = "gemini";
    process.env.GEMINI_API_KEY = "shared-gemini";
    process.env.CODING_PROVIDER = "openrouter";
    process.env.CODING_API_KEY = "k";

    assert.equal(resolved("planner").provider, "gemini");
    assert.equal(resolved("coding").provider, "openrouter");
  });

  it("is case-insensitive about the provider name", () => {
    process.env.PLANNER_PROVIDER = "GROQ";
    process.env.PLANNER_API_KEY = "k";
    assert.equal(resolved("planner").provider, "groq");
  });

  it("rejects an unknown provider", () => {
    process.env.PLANNER_PROVIDER = "mystery-ai";
    const result = resolveProviderConfig("planner");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "invalid_provider");
    assert.match(result.error.message, /mystery-ai/);
  });

  it("reports a missing key when a provider is named explicitly", () => {
    process.env.PLANNER_PROVIDER = "groq";
    const result = resolveProviderConfig("planner");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "missing_credentials");
    assert.match(result.error.message, /PLANNER_API_KEY/);
  });

  it("stays unconfigured (not an error) when no provider is named", () => {
    const config = resolved("coding");
    assert.equal(config.configured, false);
  });

  it("rejects an invalid base URL", () => {
    process.env.PLANNER_API_KEY = "k";
    process.env.PLANNER_BASE_URL = "not a url";
    const result = resolveProviderConfig("planner");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "invalid_base_url");
    assert.ok(!result.error.message.includes("k"));
  });

  it("rejects a non-http base URL", () => {
    process.env.PLANNER_API_KEY = "k";
    process.env.PLANNER_BASE_URL = "file:///etc/passwd";
    const result = resolveProviderConfig("planner");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error.code, "invalid_base_url");
  });
});

describe("request building", () => {
  function configFor(provider: "gemini" | "groq" | "openrouter"): ResolvedProvider {
    return {
      agent: "planner",
      provider,
      model: `model-${provider}`,
      baseUrl: PROVIDER_DEFAULTS[provider].baseUrl,
      apiKey: "secret-key-value",
      configured: true,
      providerHost: "host",
    };
  }

  it("builds the Gemini request with the existing reasoning settings", () => {
    const request = buildChatRequest(configFor("gemini"), "sys", "user");
    assert.equal(
      request.endpoint,
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    assert.equal(request.headers.Authorization, "Bearer secret-key-value");
    assert.equal(request.body.model, "model-gemini");
    assert.equal(request.body.max_tokens, 1600);
    assert.equal(request.body.reasoning_effort, "low");
    assert.equal(request.body.temperature, 0.2);
    assert.deepEqual(request.body.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
  });

  it("omits reasoning_effort for Groq and OpenRouter but keeps the bound", () => {
    for (const provider of ["groq", "openrouter"] as const) {
      const request = buildChatRequest(configFor(provider), "sys", "user");
      assert.equal(request.body.max_tokens, 1600, provider);
      assert.equal("reasoning_effort" in request.body, false, provider);
      assert.match(request.endpoint, /\/chat\/completions$/, provider);
    }
  });

  it("does not double up slashes when the base URL has a trailing slash", () => {
    const config = { ...configFor("groq"), baseUrl: "https://api.groq.com/openai/v1/" };
    assert.equal(
      buildChatRequest(config, "s", "u").endpoint,
      "https://api.groq.com/openai/v1/chat/completions",
    );
  });

  it("refuses to build a request without a key", () => {
    const config = { ...configFor("gemini"), apiKey: undefined };
    assert.throws(() => buildChatRequest(config, "s", "u"), /No API key/);
  });
});

describe("transport failures", () => {
  const key = "super-secret-key-value";

  function configure(): void {
    process.env.PLANNER_API_KEY = key;
    process.env.PLANNER_MODEL = "gemini-3.8-flash";
  }

  async function failureOf(status: number): Promise<ProviderError> {
    configure();
    try {
      await callChatCompletion("planner", "s", "u", {
        fetchImpl: stubFetch({ status, rawBody: '{"error":"upstream detail"}' }),
      });
    } catch (error) {
      assert.ok(error instanceof ProviderError);
      return error;
    }
    throw new Error("expected the call to fail");
  }

  it("maps 401 to an authentication error without leaking the key", async () => {
    const error = await failureOf(401);
    assert.equal(error.code, "auth");
    assert.match(error.message, /401/);
    assert.ok(!error.message.includes(key));
  });

  it("maps 403 to an authentication error", async () => {
    assert.equal((await failureOf(403)).code, "auth");
  });

  it("maps 404 to a model/endpoint error", async () => {
    assert.equal((await failureOf(404)).code, "not_found");
  });

  it("maps 429 to a rate-limit error", async () => {
    assert.equal((await failureOf(429)).code, "rate_limit");
  });

  it("maps 5xx to an unavailable error", async () => {
    assert.equal((await failureOf(503)).code, "unavailable");
  });

  it("maps an unreadable body to a bad-response error", async () => {
    configure();
    await assert.rejects(
      () =>
        callChatCompletion("planner", "s", "u", {
          fetchImpl: stubFetch({ rawBody: "not json" }),
        }),
      (error: unknown) => error instanceof ProviderError && error.code === "bad_response",
    );
  });

  it("maps an empty completion to a bad-response error", async () => {
    configure();
    await assert.rejects(
      () =>
        callChatCompletion("planner", "s", "u", {
          fetchImpl: stubFetch({ body: { choices: [{ message: { content: "   " } }] } }),
        }),
      (error: unknown) => error instanceof ProviderError && error.code === "bad_response",
    );
  });

  it("maps a timeout to a timeout error", async () => {
    configure();
    await assert.rejects(
      () =>
        callChatCompletion("planner", "s", "u", {
          fetchImpl: stubFetch({
            throwError: new DOMException("The operation was aborted due to timeout", "TimeoutError"),
          }),
        }),
      (error: unknown) => error instanceof ProviderError && error.code === "timeout",
    );
  });

  it("discards an unexpected transport message that might contain details", () => {
    const error = providerErrorFromUnknown(new TypeError(`failed to fetch ${key}`));
    assert.equal(error.code, "request_failed");
    assert.ok(!error.message.includes(key));
  });

  it("keeps provider-aware status messages", () => {
    assert.match(providerErrorForStatus("groq", 429).message, /groq/);
    assert.match(providerErrorForStatus("openrouter", 500).message, /openrouter/);
  });
});

describe("agents use their own provider", () => {
  it("sends planner and coding requests to different endpoints", async () => {
    process.env.PLANNER_API_KEY = "planner-key";
    process.env.PLANNER_MODEL = "planner-model";
    process.env.CODING_PROVIDER = "groq";
    process.env.CODING_API_KEY = "coding-key";
    process.env.CODING_MODEL = "coding-model";

    const plannerCalls: FetchCall[] = [];
    const codingCalls: FetchCall[] = [];

    await generatePlan("Add due dates", {
      fetchImpl: stubFetch({ body: planPayload(VALID_PLAN), calls: plannerCalls }),
    });

    const proposalCalls: FetchCall[] = [];
    // The stub returns a plan, which is not a proposal, so this fails
    // validation; the important assertion is which endpoint was called.
    await requestProposal({
      featureRequest: "Add due dates",
      plan: VALID_PLAN as never,
      id: "prop_1",
      createdAt: 1,
      fetchImpl: stubFetch({ body: planPayload(VALID_PLAN), calls: codingCalls }),
    });

    assert.equal(plannerCalls.length, 1);
    assert.equal(codingCalls.length, 1);
    assert.match(plannerCalls[0]!.url, /generativelanguage\.googleapis\.com/);
    assert.match(codingCalls[0]!.url, /api\.groq\.com/);
    assert.match(
      String((plannerCalls[0]!.init?.body ?? "") as string),
      /planner-model/,
    );
    assert.match(String(codingCalls[0]!.init?.body ?? ""), /coding-model/);
  });

  it("uses the coding provider key only for the coding request", async () => {
    process.env.PLANNER_API_KEY = "planner-key";
    process.env.CODING_PROVIDER = "openrouter";
    process.env.CODING_API_KEY = "coding-key";

    const plannerCalls: FetchCall[] = [];
    const codingCalls: FetchCall[] = [];

    await generatePlan("Add due dates", {
      fetchImpl: stubFetch({ body: planPayload(VALID_PLAN), calls: plannerCalls }),
    });
    await requestProposal({
      featureRequest: "Add due dates",
      plan: VALID_PLAN as never,
      id: "prop_1",
      createdAt: 1,
      fetchImpl: stubFetch({ body: planPayload(VALID_PLAN), calls: codingCalls }),
    });

    const plannerAuth = (plannerCalls[0]!.init?.headers as Record<string, string>).Authorization;
    const codingAuth = (codingCalls[0]!.init?.headers as Record<string, string>).Authorization;
    assert.equal(plannerAuth, "Bearer planner-key");
    assert.equal(codingAuth, "Bearer coding-key");
  });
});

describe("fallback policy", () => {
  it("returns a fixture only when explicitly requested", async () => {
    process.env.PLANNER_API_KEY = "k";
    let calls = 0;
    const result = await generatePlan("Add due dates", {
      fixture: true,
      fetchImpl: stubFetch({
        body: planPayload(VALID_PLAN),
      }),
    });
    void calls;

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.mode, "fixture");
  });

  it("never substitutes a demo plan for a configured provider failure", async () => {
    process.env.PLANNER_API_KEY = "k";
    const result = await generatePlan("Add due dates", {
      fetchImpl: stubFetch({ status: 503 }),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /unavailable/i);
    assert.match(result.error, /No demo or fixture plan was substituted/);
  });

  it("never substitutes a fixture proposal for a configured provider failure", async () => {
    process.env.CODING_API_KEY = "k";
    const result = await requestProposal({
      featureRequest: "Add due dates",
      plan: VALID_PLAN as never,
      id: "prop_1",
      createdAt: 1,
      fetchImpl: stubFetch({ status: 500 }),
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /No fixture proposal was substituted/);
    assert.equal((result as { proposal?: unknown }).proposal, undefined);
  });

  it("still produces a fixture proposal offline when explicitly requested", async () => {
    process.env.CODING_API_KEY = "k";
    const result = await requestProposal({
      featureRequest: "Add due dates",
      plan: VALID_PLAN as never,
      id: "prop_1",
      createdAt: 1,
      useFixture: true,
      fetchImpl: stubFetch({ status: 500 }),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.proposal.source, "fixture");
    assert.match(result.proposal.notice ?? "", /not by an AI model/);
  });

  it("surfaces a configuration error instead of a fixture when the provider is invalid", async () => {
    process.env.CODING_PROVIDER = "nope";
    const result = await requestProposal({
      featureRequest: "Add due dates",
      plan: VALID_PLAN as never,
      id: "prop_1",
      createdAt: 1,
      useFixture: false,
    });

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /Unknown model provider/);
  });
});

describe("existing protections are untouched", () => {
  it("still excludes the safety modules from the edit allowlist", () => {
    assert.equal(isPermittedSourceFile("lib/patch-apply.ts"), false);
    assert.equal(isPermittedSourceFile("lib/coding-paths.ts"), false);
    assert.equal(isPermittedSourceFile("lib/tasks.ts"), true);
  });
});