/**
 * Extension configuration.
 *
 * Sources, in order of precedence:
 *   1. chrome.storage.local (user-provided via popup)
 *   2. manifest.json -> prompt_in_a_box block (ships-with defaults)
 *   3. hardcoded fallbacks
 *
 * The API key is always user-provided. The manifest never contains
 * secrets — BYO key, stored only on this device.
 */

const MANIFEST_DEFAULTS_KEY = 'prompt_in_a_box';

const FALLBACKS = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  alarmMinutes: 30,
};

export async function getConfig() {
  const manifestBlock = chrome.runtime.getManifest()[MANIFEST_DEFAULTS_KEY] ?? {};
  const stored = await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'alarmMinutes',
  ]);

  return {
    apiKey: stored.apiKey ?? '',
    provider: stored.provider ?? manifestBlock.default_provider ?? FALLBACKS.provider,
    model: stored.model ?? manifestBlock.default_model ?? FALLBACKS.model,
    alarmMinutes:
      stored.alarmMinutes ?? manifestBlock.alarm_minutes ?? FALLBACKS.alarmMinutes,
  };
}

export async function setConfig(patch) {
  // Only persist the keys we know about; don't let the popup dump
  // arbitrary state into storage.
  const allowed = ['apiKey', 'provider', 'model', 'alarmMinutes'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  await chrome.storage.local.set(clean);
}
