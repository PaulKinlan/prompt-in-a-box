/**
 * Extension configuration.
 *
 * Precedence:
 *   1. chrome.storage.local (user-provided via popup)
 *   2. manifest's `prompt_in_a_box` block (ships-with defaults)
 *   3. hardcoded fallbacks
 */

export interface Config {
  apiKey: string;
  provider: 'anthropic';
  model: string;
  alarmMinutes: number;
}

const FALLBACKS: Omit<Config, 'apiKey'> = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  alarmMinutes: 30,
};

interface ManifestExtras {
  default_provider?: string;
  default_model?: string;
  alarm_minutes?: number;
}

export async function getConfig(): Promise<Config> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    prompt_in_a_box?: ManifestExtras;
  };
  const m = manifest.prompt_in_a_box ?? {};
  const stored = await chrome.storage.local.get(['apiKey', 'provider', 'model', 'alarmMinutes']);

  return {
    apiKey: (stored.apiKey as string) ?? '',
    provider: ((stored.provider as string) ?? m.default_provider ?? FALLBACKS.provider) as 'anthropic',
    model: (stored.model as string) ?? m.default_model ?? FALLBACKS.model,
    alarmMinutes: (stored.alarmMinutes as number) ?? m.alarm_minutes ?? FALLBACKS.alarmMinutes,
  };
}

export async function setConfig(patch: Partial<Config>): Promise<void> {
  const allowed: (keyof Config)[] = ['apiKey', 'provider', 'model', 'alarmMinutes'];
  const clean: Partial<Config> = {};
  for (const k of allowed) {
    if (k in patch) (clean as Record<string, unknown>)[k] = patch[k];
  }
  await chrome.storage.local.set(clean as Record<string, unknown>);
}
