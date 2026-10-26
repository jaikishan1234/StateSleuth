/**
 * Planner configuration view for the UI.
 *
 * Server-only. Delegates to the shared provider layer so the planner page and
 * the request path agree on one configuration. Never import from a client
 * component: it reads credentials.
 */

import {
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULTS,
  resolveProviderConfig,
  type ProviderId,
} from "./provider-config.ts";

export type PlannerConfig = {
  configured: boolean;
  apiKey?: string;
  baseUrl: string;
  model: string;
  provider: ProviderId;
  providerHost: string;
  /** Set when the environment names a provider that cannot be used. */
  configError?: string;
};

export function getPlannerConfig(): PlannerConfig {
  const resolution = resolveProviderConfig("planner");

  if (resolution.ok) {
    const { configured, apiKey, baseUrl, model, provider, providerHost } = resolution.config;
    return {
      configured,
      ...(apiKey ? { apiKey } : {}),
      baseUrl,
      model,
      provider,
      providerHost,
    };
  }

  const defaults = PROVIDER_DEFAULTS[DEFAULT_PROVIDER];
  return {
    configured: false,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    provider: DEFAULT_PROVIDER,
    providerHost: "",
    configError: resolution.error.message,
  };
}