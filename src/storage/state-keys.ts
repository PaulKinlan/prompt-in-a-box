/**
 * Shared Storage State Key Normalization & System Key Protection
 *
 * Ensures `storage_get`, `storage_set`, and declarative UI `storageKey` / `dataKey`
 * bindings resolve to the same canonical `state:<shortKey>` namespace while
 * protecting internal extension configuration and runtime keys from accidental
 * or malicious access.
 */

export const STATE_PREFIX = 'state:';

export const RESERVED_SYSTEM_KEYS = new Set<string>([
  'provider',
  'model',
  'alarmMinutes',
  'keys',
  'onboarded',
  'disabledProviderTools',
  'studioProjects',
  'activeStudioProjectId',
  'studioLiveOverride',
  'agentSettingsValues',
  '__pib_dynamic_ui',
  '__pib_saved_scripts',
  '__pib_audit_index',
  '__pib_artifact_index',
  '__pib_live_logs',
  '__pib_run_status',
  '__pib_last_scheduled_run_at',
  '__pib_pending_bootstrap',
  '__pib_granted_opt_perms',
  'activeUndoToast',
  'lastSortSnapshot',
]);

export interface ResolvedStateKey {
  shortKey: string;
  fullKey: string;
  isReserved: boolean;
}

export interface WriteStateResult {
  fullKey: string;
  shortKey: string;
  hadPrevious: boolean;
  previousValue: unknown;
}

/**
 * Normalizes any raw state key (e.g. `"mode"`, `"state:mode"`, `"state:state:mode"`)
 * into `{ shortKey: "mode", fullKey: "state:mode", isReserved }`.
 */
export function resolveStateKey(rawKey?: string): ResolvedStateKey {
  const trimmed = (rawKey ?? '').trim();
  let s = trimmed;
  while (s.startsWith(STATE_PREFIX)) {
    s = s.slice(STATE_PREFIX.length);
  }
  s = s.trim();
  const shortKey = s || 'default';
  const fullKey = `${STATE_PREFIX}${shortKey}`;
  const isReserved = RESERVED_SYSTEM_KEYS.has(shortKey) || RESERVED_SYSTEM_KEYS.has(trimmed);

  return { shortKey, fullKey, isReserved };
}

/**
 * Reads a state value from `chrome.storage.local`, preferring the canonical
 * `state:<shortKey>` entry and falling back to legacy unprefixed `<shortKey>`
 * only when the key is not a reserved system key.
 */
export async function readStateValue(rawKey?: string): Promise<unknown> {
  const { shortKey, fullKey, isReserved } = resolveStateKey(rawKey);
  const keysToFetch = isReserved ? [fullKey] : Array.from(new Set([fullKey, shortKey]));
  const stored = await chrome.storage.local.get(keysToFetch);
  if (stored && stored[fullKey] !== undefined) {
    return stored[fullKey];
  }
  if (!isReserved && stored && stored[shortKey] !== undefined) {
    return stored[shortKey];
  }
  return null;
}

/**
 * Writes a state value to `chrome.storage.local` under the canonical `state:<shortKey>`
 * key (never touching unprefixed reserved system keys) and returns previous-value
 * metadata for reversible action-history tracking.
 */
export async function writeStateValue(rawKey: string, value: unknown): Promise<WriteStateResult> {
  const { shortKey, fullKey } = resolveStateKey(rawKey);
  let hadPrevious = false;
  let previousValue: unknown;

  try {
    const existing = await chrome.storage.local.get(fullKey);
    if (existing && fullKey in existing) {
      hadPrevious = true;
      previousValue = existing[fullKey];
    }
  } catch {
    // Ignore storage read failure prior to write
  }

  await chrome.storage.local.set({ [fullKey]: value });

  return {
    fullKey,
    shortKey,
    hadPrevious,
    previousValue,
  };
}
