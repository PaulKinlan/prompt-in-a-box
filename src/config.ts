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

export interface AgentSettingOption {
  label: string;
  value: string;
}

export interface AgentSettingField {
  id: string;
  label: string;
  hint?: string;
  type: 'boolean' | 'select';
  default: boolean | string;
  options?: AgentSettingOption[];
}

export interface AgentSettingsConfig {
  storageKey: string;
  title?: string;
  fields: AgentSettingField[];
}

export interface UIConfig {
  // Global / Cross-surface
  showCosts: boolean;
  showTokenUsage: boolean;
  showToolCallDetails: boolean;
  showHistory: boolean;
  showVersionBadge: boolean;
  showPolicyBadge: boolean;

  // Popup
  showPopupHeader: boolean;
  showViewSwitcher: boolean;
  showStatusCard: boolean;
  showKeyStatusBadge: boolean;
  showScheduleSummary: boolean;
  showRecentArtifacts: boolean;
  showPopupFooter: boolean;
  allowSettingsAccess: boolean;
  allowSidePanel: boolean;

  // Side Panel
  showSidePanelHeader: boolean;
  showSidePanelStatusBar: boolean;
  showActivityDrawer: boolean;
  showRecentRuns: boolean;

  // Options — Settings
  showOnboardingBanner: boolean;
  showProviderSelector: boolean;
  showApiKeyInput: boolean;
  showModelSelector: boolean;
  showProviderTools: boolean;
  showPermissionsManager: boolean;
  showSchedule: boolean;
  allowTestConnection: boolean;
  allowManualRun: boolean;

  // Options — Audit & History
  showAuditLog: boolean;
  showAuditStats: boolean;
  showAuditFilters: boolean;
  allowExportAudit: boolean;
  allowClearAudit: boolean;

  // Artifacts
  allowArtifacts: boolean;
  showArtifactStats: boolean;
  showArtifactFilters: boolean;
  allowCopyArtifact: boolean;
  allowDownloadArtifact: boolean;
  allowDeleteArtifacts: boolean;
}

export const DEFAULT_UI_CONFIG: UIConfig = {
  // Global / Cross-surface
  showCosts: true,
  showTokenUsage: true,
  showToolCallDetails: true,
  showHistory: true,
  showVersionBadge: true,
  showPolicyBadge: true,

  // Popup
  showPopupHeader: true,
  showViewSwitcher: true,
  showStatusCard: true,
  showKeyStatusBadge: true,
  showScheduleSummary: true,
  showRecentArtifacts: true,
  showPopupFooter: true,
  allowSettingsAccess: true,
  allowSidePanel: true,

  // Side Panel
  showSidePanelHeader: true,
  showSidePanelStatusBar: true,
  showActivityDrawer: true,
  showRecentRuns: true,

  // Options — Settings
  showOnboardingBanner: true,
  showProviderSelector: true,
  showApiKeyInput: true,
  showModelSelector: true,
  showProviderTools: true,
  showPermissionsManager: true,
  showSchedule: true,
  allowTestConnection: true,
  allowManualRun: true,

  // Options — Audit & History
  showAuditLog: true,
  showAuditStats: true,
  showAuditFilters: true,
  allowExportAudit: true,
  allowClearAudit: true,

  // Artifacts
  allowArtifacts: true,
  showArtifactStats: true,
  showArtifactFilters: true,
  allowCopyArtifact: true,
  allowDownloadArtifact: true,
  allowDeleteArtifacts: true,
};

export interface StaticConfig {
  version?: string;
  providers?: {
    allowed?: Provider[];
    default?: Provider;
    lockProvider?: boolean;
  };
  models?: {
    default?: string;
    lockModel?: boolean;
    allowCustomModelInput?: boolean;
    allowed?: Partial<Record<Provider, string[]>>;
  };
  schedule?: {
    defaultAlarmMinutes?: number;
    lockSchedule?: boolean;
  };
  providerTools?: {
    disabledByDefault?: string[];
    lockProviderTools?: boolean;
  };
  ui?: Partial<UIConfig>;
  agentSettings?: AgentSettingsConfig | null;
  features?: {
    showProviderSelector?: boolean;
    showModelSelector?: boolean;
    showProviderTools?: boolean;
    showPermissionsManager?: boolean;
    showSchedule?: boolean;
    showAuditLog?: boolean;
    allowExportAudit?: boolean;
    allowClearAudit?: boolean;
    allowSidePanel?: boolean;
    allowArtifacts?: boolean;
    allowManualRun?: boolean;
  };
}

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
  /** Fine-grained UI visibility settings. */
  ui: UIConfig;
  /** Optional custom agent setting definitions from config.json. */
  agentSettings?: AgentSettingsConfig | null;
}

export const DEFAULT_STATIC_CONFIG: Required<Omit<StaticConfig, 'agentSettings'>> & { agentSettings: AgentSettingsConfig | null } = {
  version: '0.7.0',
  providers: {
    allowed: ['anthropic', 'google', 'openai'],
    default: 'google',
    lockProvider: false,
  },
  models: {
    default: 'gemini-3.8-flash',
    lockModel: false,
    allowCustomModelInput: true,
    allowed: {
      anthropic: [
        'claude-sonnet-5-5',
        'claude-opus-5-5',
        'claude-fable-5-1',
        'claude-haiku-5-5',
        'claude-fable-5',
        'claude-opus-5',
        'claude-sonnet-5',
        'claude-opus-4-8',
        'claude-opus-4-7',
        'claude-sonnet-4-6',
        'claude-haiku-4-5',
      ],
      google: [
        'gemini-3.8-flash',
        'gemini-4-argon',
        'gemini-3.5-flash-lite',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.1-pro-preview',
        'gemini-3.1-flash-lite',
        'gemini-3-flash-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
      ],
      openai: [
        'gpt-6.1-sol',
        'gpt-6-astra',
        'gpt-6-sol',
        'gpt-6-luna',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
        'gpt-5.6-luna',
        'gpt-5.6',
        'gpt-5.5',
        'gpt-5.5-pro',
        'gpt-5.4',
        'gpt-5.4-pro',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
        'gpt-5.3-codex',
        'o3',
        'o4-mini',
      ],
    },
  },
  schedule: {
    defaultAlarmMinutes: 30,
    lockSchedule: false,
  },
  providerTools: {
    disabledByDefault: [],
    lockProviderTools: false,
  },
  ui: DEFAULT_UI_CONFIG,
  agentSettings: null,
  features: {
    showProviderSelector: true,
    showModelSelector: true,
    showProviderTools: true,
    showPermissionsManager: true,
    showSchedule: true,
    showAuditLog: true,
    allowExportAudit: true,
    allowClearAudit: true,
    allowSidePanel: true,
    allowArtifacts: true,
    allowManualRun: true,
  },
};

let cachedStaticConfig: StaticConfig | null = null;

export async function getStaticConfig(): Promise<StaticConfig> {
  if (cachedStaticConfig) return cachedStaticConfig;
  try {
    const url = chrome.runtime.getURL('config.json');
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as StaticConfig;
      cachedStaticConfig = {
        ...DEFAULT_STATIC_CONFIG,
        ...data,
        providers: { ...DEFAULT_STATIC_CONFIG.providers, ...(data.providers || {}) },
        models: {
          ...DEFAULT_STATIC_CONFIG.models,
          ...(data.models || {}),
          allowed: {
            ...DEFAULT_STATIC_CONFIG.models.allowed,
            ...((data.models && data.models.allowed) || {}),
          },
        },
        schedule: { ...DEFAULT_STATIC_CONFIG.schedule, ...(data.schedule || {}) },
        providerTools: {
          ...DEFAULT_STATIC_CONFIG.providerTools,
          ...(data.providerTools || {}),
        },
        ui: { ...DEFAULT_STATIC_CONFIG.ui, ...(data.ui || {}) },
        agentSettings: data.agentSettings ?? null,
        features: { ...DEFAULT_STATIC_CONFIG.features, ...(data.features || {}) },
      };
      return cachedStaticConfig;
    }
  } catch (err) {
    console.warn('[config] Failed to load config.json, using defaults:', err);
  }
  cachedStaticConfig = DEFAULT_STATIC_CONFIG;
  return cachedStaticConfig;
}

export function isPolicyLocked(policy: StaticConfig): boolean {
  if (policy.providers?.lockProvider) return true;
  if (policy.providers?.allowed && policy.providers.allowed.length < 3) return true;
  if (policy.models?.lockModel) return true;
  if (policy.models?.allowCustomModelInput === false) return true;
  if (policy.schedule?.lockSchedule) return true;
  if (policy.providerTools?.lockProviderTools) return true;
  return false;
}

/**
 * Recommended defaults per provider.
 */
export const PROVIDER_DEFAULTS: Record<Provider, { model: string; hint: string }> = {
  anthropic: {
    model: 'claude-sonnet-5-5',
    hint: 'Get a key at https://console.anthropic.com/ (format: sk-ant-…)',
  },
  google: {
    model: 'gemini-3.8-flash',
    hint: 'Get a key at https://aistudio.google.com/ (use GOOGLE_GENERATIVE_AI_API_KEY-style key)',
  },
  openai: {
    model: 'gpt-6.1-sol',
    hint: 'Get a key at https://platform.openai.com/api-keys (format: sk-…)',
  },
};

/**
 * Curated model IDs surfaced in the options-page model picker, newest / most capable first.
 */
export const PROVIDER_MODELS: Record<Provider, string[]> = {
  anthropic: [
    'claude-sonnet-5-5',
    'claude-opus-5-5',
    'claude-fable-5-1',
    'claude-haiku-5-5',
    'claude-fable-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  google: [
    'gemini-3.8-flash',
    'gemini-4-argon',
    'gemini-3.5-flash-lite',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.1-pro-preview',
    'gemini-3.1-flash-lite',
    'gemini-3-flash-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ],
  openai: [
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6-sol',
    'gpt-6-luna',
    'gpt-5.6-sol',
    'gpt-5.6-terra',
    'gpt-5.6-luna',
    'gpt-5.6',
    'gpt-5.5',
    'gpt-5.5-pro',
    'gpt-5.4',
    'gpt-5.4-pro',
    'gpt-5.4-mini',
    'gpt-5.4-nano',
    'gpt-5.3-codex',
    'o3',
    'o4-mini',
  ],
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

const FALLBACKS: Omit<Config, 'keys' | 'ui' | 'agentSettings'> = {
  provider: 'google',
  model: 'gemini-3.8-flash',
  alarmMinutes: 30,
  onboarded: false,
  disabledProviderTools: [],
};

export async function getConfig(): Promise<Config> {
  const manifest = chrome.runtime.getManifest() as chrome.runtime.Manifest & {
    prompt_in_a_box?: ManifestExtras;
  };
  const m = manifest.prompt_in_a_box ?? {};
  const staticCfg = await getStaticConfig();

  const stored = await chrome.storage.local.get([
    'provider',
    'model',
    'alarmMinutes',
    'keys',
    'onboarded',
    'disabledProviderTools',
  ]);

  // Determine allowed providers from static configuration.
  const allowedProviders = (staticCfg.providers?.allowed && staticCfg.providers.allowed.length > 0)
    ? staticCfg.providers.allowed
    : (['anthropic', 'google', 'openai'] as Provider[]);

  let provider: Provider;
  if (staticCfg.providers?.lockProvider) {
    provider = (staticCfg.providers.default && allowedProviders.includes(staticCfg.providers.default))
      ? staticCfg.providers.default
      : allowedProviders[0];
  } else {
    const candidate = (stored.provider as Provider) ?? staticCfg.providers?.default ?? m.default_provider ?? FALLBACKS.provider;
    provider = allowedProviders.includes(candidate) ? candidate : allowedProviders[0];
  }

  // Determine allowed models for the active provider.
  const providerModels = staticCfg.models?.allowed?.[provider] ?? PROVIDER_MODELS[provider] ?? [PROVIDER_DEFAULTS[provider].model];
  const defaultModel = staticCfg.models?.default || m.default_model || PROVIDER_DEFAULTS[provider].model;

  let model: string;
  if (staticCfg.models?.lockModel) {
    model = (staticCfg.models.default && providerModels.includes(staticCfg.models.default))
      ? staticCfg.models.default
      : defaultModel;
  } else if (staticCfg.models?.allowCustomModelInput === false) {
    const candidate = (stored.model as string) ?? defaultModel;
    model = providerModels.includes(candidate) ? candidate : providerModels[0];
  } else {
    model = (stored.model as string) ?? defaultModel;
  }

  const rawAlarm = stored.alarmMinutes;
  const alarmMinutes = staticCfg.schedule?.lockSchedule
    ? (staticCfg.schedule.defaultAlarmMinutes ?? 30)
    : (typeof rawAlarm === 'number' && rawAlarm >= 0
        ? rawAlarm
        : ((staticCfg.schedule?.defaultAlarmMinutes ?? m.alarm_minutes ?? FALLBACKS.alarmMinutes) as number));

  const disabledProviderTools = staticCfg.providerTools?.lockProviderTools
    ? (staticCfg.providerTools.disabledByDefault ?? [])
    : ((stored.disabledProviderTools as string[]) ?? staticCfg.providerTools?.disabledByDefault ?? FALLBACKS.disabledProviderTools);

  const ui: UIConfig = {
    ...DEFAULT_UI_CONFIG,
    ...(staticCfg.ui || {}),
    ...(staticCfg.features?.showProviderSelector !== undefined ? { showProviderSelector: staticCfg.features.showProviderSelector } : {}),
    ...(staticCfg.features?.showModelSelector !== undefined ? { showModelSelector: staticCfg.features.showModelSelector } : {}),
    ...(staticCfg.features?.showProviderTools !== undefined ? { showProviderTools: staticCfg.features.showProviderTools } : {}),
    ...(staticCfg.features?.showPermissionsManager !== undefined ? { showPermissionsManager: staticCfg.features.showPermissionsManager } : {}),
    ...(staticCfg.features?.showSchedule !== undefined ? { showSchedule: staticCfg.features.showSchedule } : {}),
    ...(staticCfg.features?.showAuditLog !== undefined ? { showAuditLog: staticCfg.features.showAuditLog } : {}),
    ...(staticCfg.features?.allowExportAudit !== undefined ? { allowExportAudit: staticCfg.features.allowExportAudit } : {}),
    ...(staticCfg.features?.allowClearAudit !== undefined ? { allowClearAudit: staticCfg.features.allowClearAudit } : {}),
    ...(staticCfg.features?.allowSidePanel !== undefined ? { allowSidePanel: staticCfg.features.allowSidePanel } : {}),
    ...(staticCfg.features?.allowArtifacts !== undefined ? { allowArtifacts: staticCfg.features.allowArtifacts } : {}),
    ...(staticCfg.features?.allowManualRun !== undefined ? { allowManualRun: staticCfg.features.allowManualRun } : {}),
  };

  return {
    provider,
    model,
    alarmMinutes,
    keys: mergeKeys(stored.keys as Partial<Record<Provider, string>> | undefined),
    onboarded: Boolean(stored.onboarded),
    disabledProviderTools,
    ui,
    agentSettings: staticCfg.agentSettings ?? null,
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
