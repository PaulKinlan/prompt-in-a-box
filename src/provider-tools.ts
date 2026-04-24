/**
 * Provider-native tools — the ones the model's host executes for us.
 *
 * For each provider we return a ToolSet that `agent-do` / the Vercel
 * AI SDK merges into the custom tool set. The model issues the call;
 * the provider's backend runs the tool; the result flows back through
 * the same `tool-result` channel as any local tool, so the agent loop
 * is none the wiser.
 *
 * Mirrors the pattern in the CHAOS extension
 * (packages/extension/src/agents/provider-registry.ts) so the two
 * projects evolve in lockstep.
 *
 * Availability:
 *   - Anthropic: web_search, web_fetch, code_execution
 *   - Google:    google_search, url_context, code_execution
 *   - OpenAI:    web_search
 *
 * Always-on by default. Users disable specific tools by name via
 * `cfg.disabledProviderTools` (see src/config.ts) — same mechanism for
 * provider-native and custom tools.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { ToolSet } from 'ai';
import type { Provider } from './config';

export function getProviderTools(provider: Provider, apiKey: string): ToolSet {
  try {
    switch (provider) {
      case 'anthropic': {
        const anthropic = createAnthropic({
          apiKey,
          headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
        });
        return {
          web_search: anthropic.tools.webSearch_20260209(),
          web_fetch: anthropic.tools.webFetch_20260209(),
          code_execution: anthropic.tools.codeExecution_20260120(),
        } as ToolSet;
      }
      case 'google': {
        const google = createGoogleGenerativeAI({ apiKey });
        return {
          google_search: google.tools.googleSearch({}),
          url_context: google.tools.urlContext({}),
          code_execution: google.tools.codeExecution({}),
        } as ToolSet;
      }
      case 'openai': {
        const openai = createOpenAI({ apiKey });
        return {
          web_search: openai.tools.webSearch(),
        } as ToolSet;
      }
    }
  } catch (err) {
    // Dated tool versions move; if this SDK doesn't know one of them,
    // fall through gracefully. Custom tools still work.
    console.warn('[prompt-in-a-box] provider tools unavailable:', err);
  }
  return {};
}

/**
 * Names of all provider-native tools we ever expose, regardless of
 * which provider is currently active. Useful for populating the
 * disable list in the options UI.
 */
export const ALL_PROVIDER_TOOL_NAMES: readonly string[] = [
  'web_search',
  'web_fetch',
  'code_execution',
  'google_search',
  'url_context',
] as const;

/**
 * Apply the user's disable list to a provider ToolSet. Returns a new
 * object; does not mutate input.
 */
export function filterProviderTools(
  tools: ToolSet,
  disabled: string[] | undefined,
): ToolSet {
  if (!disabled || disabled.length === 0) return tools;
  const out: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!disabled.includes(name)) out[name] = tool;
  }
  return out;
}
