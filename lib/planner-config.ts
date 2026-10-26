/**
 * Server-only planner configuration.
 *
 * Never import this module from a client component: it reads credentials.
 */

export type PlannerConfig = {
  configured: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  providerHost: string;
};

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function getPlannerConfig(): PlannerConfig {
  const apiKey = readEnv("PLANNER_API_KEY") || readEnv("OPENAI_API_KEY");
  const baseUrl = readEnv("PLANNER_BASE_URL") || "https://api.openai.com/v1";
  const model = readEnv("PLANNER_MODEL") || "gpt-4o-mini";

  let providerHost = "unknown";
  try {
    providerHost = new URL(baseUrl).host;
  } catch {
    providerHost = "invalid-url";
  }

  return {
    configured: apiKey.length > 0,
    apiKey: apiKey.length > 0 ? apiKey : undefined,
    baseUrl,
    model,
    providerHost,
  };
}