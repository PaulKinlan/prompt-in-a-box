/**
 * Extension configuration.
 *
 * Precedence:
 *   1. chrome.storage.local (user-provided via options / onboarding)
 *   2. manifest's `prompt_in_a_box` block (ships-with defaults)
 *   3. hardcoded fallbacks
 *
 * API keys are stored *per provider*, not as a single field, so the
 * user can have keys for multiple providers and switch without losing
 * any of them. Only the key for the currently-selected provider is
 * used at run time.
 */

export type Provider = 'anthropic' | 'google' | 'openai';

export interface Config {
  provider: Provider;
  model: string;
  alarmMinutes: number;
  /** Per-provider API keys. Only the selected provider's key is used at run time. */
  keys: Record<Provider, string>;
  /** Whether the user has completed the onboarding flow. */
  onboarded: boolean;
  /**
   * Names of provider-native tools (web_search, web_fetch, google_search,
   * code_execution, url_context) the user has turned off. Empty = all on.
   * Applies across providers — a name in this list is excluded from any
   * provider that exposes a tool by that name.
   */
  disabledProviderTools: string[];
}

/**
 * Recommended defaults per provider. The model IDs here should track
 * the latest tier the post's demos use — see
 * ~/aifocus/content/posts/where-prompts-run.md and the sibling
 * agent-do demos for the canonical list.
 */
export const PROVIDER_DEFAULTS: Record<Provider, { model: string; hint: string }> = {
  anthropic: {
    model: 'claude-sonnet-4-6',
    hint: 'Get a key at https://console.anthropic.com/ (format: sk-ant-…)',
  },
  google: {
    model: 'gemini-3.1-pro-preview',
    hint: 'Get a key at https://aistudio.google.com/ (use GOOGLE_GENERATIVE_AI_API_KEY-style key)',
  },
  openai: {
    model: 'gpt-5.4',
    hint: 'Get a key at https://platform.openai.com/api-keys (format: sk-…)',
  },
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: 'Anthropic (Claude)',
  google: 'Google (Gemini)',
  openai: 'OpenAI (GPT)',
};

/**
 * Endpoints each provider talks to. Used by:
 *   - the options page, to show the user where their key will be sent
 *   - optional CSP tightening (future: per-provider narrowed connect-src)
 *
 * The manifest ships with all three in `connect-src` so the user can
 * switch providers without editing the manifest.
 */
export const PROVIDER_ENDPOINTS: Record<Provider, string> = {
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.openai.com',
};

interface ManifestExtras {
  default_provider?: Provider;
  default_model?: string;
  alarm_minutes?: number;
}

const FALLBACKS: Omit<Config, 'keys'> = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  alarmMinutes: 30,
  onboarded: false,
  disabledProviderTools: [],
};

export async function getConfig(): Promise<Config> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    prompt_in_a_box?: ManifestExtras;
  };
  const m = manifest.prompt_in_a_box ?? {};
  const stored = await chrome.storage.local.get([
    'provider',
    'model',
    'alarmMinutes',
    'keys',
    'onboarded',
    'disabledProviderTools',
  ]);

  const provider =
    (stored.provider as Provider) ?? m.default_provider ?? FALLBACKS.provider;

  return {
    provider,
    model:
      (stored.model as string) ??
      m.default_model ??
      PROVIDER_DEFAULTS[provider].model,
    alarmMinutes:
      (stored.alarmMinutes as number) ?? m.alarm_minutes ?? FALLBACKS.alarmMinutes,
    keys: mergeKeys(stored.keys as Partial<Record<Provider, string>> | undefined),
    onboarded: Boolean(stored.onboarded),
    disabledProviderTools:
      (stored.disabledProviderTools as string[]) ?? FALLBACKS.disabledProviderTools,
  };
}

export async function setConfig(patch: Partial<Config>): Promise<void> {
  const allowed: (keyof Config)[] = [
    'provider',
    'model',
    'alarmMinutes',
    'keys',
    'onboarded',
    'disabledProviderTools',
  ];
  const clean: Partial<Config> = {};
  for (const k of allowed) {
    if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
  }
  await chrome.storage.local.set(clean as Record<string, unknown>);
}

/** The active API key for the currently-selected provider. */
export function activeKey(cfg: Config): string {
  return cfg.keys[cfg.provider] ?? '';
}

function mergeKeys(
  stored: Partial<Record<Provider, string>> | undefined,
): Record<Provider, string> {
  return {
    anthropic: stored?.anthropic ?? '',
    google: stored?.google ?? '',
    openai: stored?.openai ?? '',
  };
}
