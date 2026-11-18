/**
 * Service-worker & extension lifecycle helpers:
 *   1. Prompt capability detectors for install/update bootstrap and browser startup runs
 *   2. Deferred post-API-key onboarding bootstrap tracking
 *   3. Browser startup session-restore event storm cooldown
 *   4. Automatic event-triggered run circuit breaker / rate limiter
 *   5. MV3 service-worker active-run keepalive & pre-kill safety timeout
 *   6. Persisted granted optional permissions cache for cold SW boot visibility
 */

export const PENDING_BOOTSTRAP_KEY = '__pib_pending_bootstrap';
export const STARTUP_COOLDOWN_KEY = '__pib_startup_cooldown_until';
export const EVENT_RUN_HISTORY_KEY = '__pib_event_run_history';
export const SW_HEARTBEAT_KEY = '__pib_sw_heartbeat';
export const GRANTED_OPT_PERMS_KEY = '__pib_granted_opt_perms';

export type BootstrapReason = 'install' | 'update';

const UI_FENCE_RE = /```ui\b([\s\S]*?)```/gi;
const DYNAMIC_UI_WIDGET_TYPE_RE = /"type"\s*:\s*"(?:metrics|table|summary)"/;

// ─── 1. Prompt Lifecycle Capability Detectors ───────────────────────

/**
 * Determines whether a `prompt.md` requires an immediate one-time bootstrap run
 * on extension install or update (e.g., to register context menus, schedule named
 * alarms, seed initial storage state, or populate initial dynamic UI widgets).
 */
export function promptNeedsBootstrap(promptText: string): boolean {
  if (!promptText) return false;

  const uiBlocks: string[] = [];
  const prose = promptText.replace(UI_FENCE_RE, (_match, block: string) => {
    uiBlocks.push(block ?? '');
    return '';
  });

  if (
    prose.includes('context_menu_create') ||
    prose.includes('contextMenus') ||
    prose.includes('alarm_set') ||
    prose.includes('bootstrapAt') ||
    /##\s*(?:On\s+install|On\s+bootstrap|Bootstrap|Setup|Initialization|One-time\s+bookkeeping)\b/i.test(prose) ||
    /\bon\s+(?:first\s+)?install\b/i.test(prose)
  ) {
    return true;
  }

  // Check declarative ```ui blocks for data widgets only when prose mentions ui_update on install/bootstrap
  if (
    uiBlocks.length > 0 &&
    prose.includes('ui_update') &&
    /\b(?:install|bootstrap)\b/i.test(prose) &&
    uiBlocks.some((block) => DYNAMIC_UI_WIDGET_TYPE_RE.test(block))
  ) {
    return true;
  }

  return false;
}

/**
 * Determines whether a `prompt.md` explicitly requests an agent run whenever
 * the browser starts (`chrome.runtime.onStartup`).
 */
export function promptNeedsStartupRun(promptText: string): boolean {
  if (!promptText) return false;

  const prose = promptText.replace(UI_FENCE_RE, '');
  return (
    /##\s*On\s+startup\b/i.test(prose) ||
    /\bchrome\.runtime\.onStartup\b/i.test(prose) ||
    /\bwhen\s+(?:the\s+)?browser\s+starts\b/i.test(prose)
  );
}

// ─── 2. Deferred Post-API-Key Bootstrap Tracking ────────────────────

let memoryPendingBootstrap: BootstrapReason | null = null;

export async function setPendingBootstrap(reason: BootstrapReason): Promise<void> {
  memoryPendingBootstrap = reason;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      await chrome.storage.local.set({ [PENDING_BOOTSTRAP_KEY]: reason });
    }
  } catch {
    // Keep in-memory fallback if storage is unavailable
  }
}

export async function getPendingBootstrap(): Promise<BootstrapReason | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      const stored = await chrome.storage.local.get(PENDING_BOOTSTRAP_KEY);
      const val = stored?.[PENDING_BOOTSTRAP_KEY];
      if (val === 'install' || val === 'update') {
        memoryPendingBootstrap = val;
        return val;
      }
      memoryPendingBootstrap = null;
      return null;
    }
  } catch {
    // Fall back to module memory if storage read fails
  }
  return memoryPendingBootstrap;
}

export async function clearPendingBootstrap(): Promise<void> {
  memoryPendingBootstrap = null;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.remove) {
      await chrome.storage.local.remove(PENDING_BOOTSTRAP_KEY);
    }
  } catch {
    // Ignore
  }
}

// ─── 3. Session-Restore Startup Cooldown ────────────────────────────

let memoryStartupCooldownUntil = 0;

/**
 * Activates a temporary startup cooldown window so session-restore tab bursts
 * (`tabs.onCreated` / `tabs.onUpdated`) on browser launch do not trigger immediate runs.
 */
export async function activateStartupCooldown(durationMs = 10_000): Promise<number> {
  const until = Date.now() + Math.max(0, durationMs);
  memoryStartupCooldownUntil = until;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.set) {
      await chrome.storage.session.set({ [STARTUP_COOLDOWN_KEY]: until });
    }
  } catch {
    // Ignore if chrome.storage.session is unavailable
  }
  return until;
}

/**
 * Checks whether the browser startup session-restore cooldown is currently active.
 */
export async function isInStartupCooldown(): Promise<boolean> {
  if (memoryStartupCooldownUntil > 0 && Date.now() < memoryStartupCooldownUntil) {
    return true;
  }
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session?.get) {
      const stored = await chrome.storage.session.get(STARTUP_COOLDOWN_KEY);
      const until = stored?.[STARTUP_COOLDOWN_KEY];
      if (typeof until === 'number' && Number.isFinite(until)) {
        memoryStartupCooldownUntil = until;
        return Date.now() < until;
      }
    }
  } catch {
    // Ignore if chrome.storage.session is unavailable
  }
  return false;
}

// ─── 4. Automatic Event Run Circuit Breaker ─────────────────────────

export interface EventCircuitBreakerOptions {
  maxRuns?: number;
  windowMs?: number;
}

export interface EventCircuitBreakerResult {
  allowed: boolean;
  recentCount: number;
  retryAfterMs: number;
}

let memoryEventRunHistory: number[] = [];

/**
 * Rolling-window rate limiter for automatic `'event'` runs so event storms or
 * redirect loops cannot burn unbounded LLM API credits.
 */
export async function checkEventRunCircuitBreaker(
  opts?: EventCircuitBreakerOptions,
): Promise<EventCircuitBreakerResult> {
  const maxRuns = opts?.maxRuns ?? 12;
  const windowMs = opts?.windowMs ?? 5 * 60_000;
  const now = Date.now();

  let history: number[] = memoryEventRunHistory;
  const hasSessionStorage =
    typeof chrome !== 'undefined' &&
    typeof chrome.storage?.session?.get === 'function' &&
    typeof chrome.storage?.session?.set === 'function';

  if (hasSessionStorage) {
    try {
      const stored = await chrome.storage.session.get(EVENT_RUN_HISTORY_KEY);
      const raw = stored?.[EVENT_RUN_HISTORY_KEY];
      if (Array.isArray(raw)) {
        history = raw.filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));
      } else {
        history = [];
      }
    } catch {
      history = memoryEventRunHistory;
    }
  }

  const cutoff = now - windowMs;
  const recent = history.filter((ts) => ts > cutoff).sort((a, b) => a - b);

  if (recent.length >= maxRuns) {
    memoryEventRunHistory = recent;
    if (hasSessionStorage && recent.length !== history.length) {
      try {
        await chrome.storage.session.set({ [EVENT_RUN_HISTORY_KEY]: recent });
      } catch {
        // Ignore
      }
    }
    const retryAfterMs = Math.max(0, recent[0] + windowMs - now);
    return {
      allowed: false,
      recentCount: recent.length,
      retryAfterMs,
    };
  }

  const next = [...recent, now];
  memoryEventRunHistory = next;
  if (hasSessionStorage) {
    try {
      await chrome.storage.session.set({ [EVENT_RUN_HISTORY_KEY]: next });
    } catch {
      // Ignore
    }
  }

  return {
    allowed: true,
    recentCount: recent.length + 1,
    retryAfterMs: 0,
  };
}

// ─── 5. MV3 Service Worker Active-Run Keepalive & Safety Timeout ────

export interface ServiceWorkerKeepaliveOptions {
  heartbeatMs?: number;
  maxRunMs?: number;
}

export interface ServiceWorkerKeepaliveHandle {
  stop: () => void;
  timedOut: () => boolean;
}

/**
 * Keeps the MV3 service worker alive while an active LLM / tool loop is running
 * and aborts cleanly at 4.5 minutes before Chrome's hard 5-minute termination.
 */
export function startServiceWorkerKeepalive(
  abortController: AbortController,
  opts?: ServiceWorkerKeepaliveOptions,
): ServiceWorkerKeepaliveHandle {
  const heartbeatMs = opts?.heartbeatMs ?? 20_000;
  const maxRunMs = opts?.maxRunMs ?? 270_000;

  let didTimeout = false;
  let stopped = false;

  const sendHeartbeat = (): void => {
    try {
      if (typeof chrome !== 'undefined') {
        chrome.runtime?.getPlatformInfo?.(() => {
          void chrome.runtime?.lastError;
        });
      }
    } catch {
      // Ignore
    }
    try {
      if (typeof chrome !== 'undefined') {
        chrome.storage?.session?.set?.({ [SW_HEARTBEAT_KEY]: Date.now() })?.catch?.(() => {});
      }
    } catch {
      // Ignore
    }
  };

  let heartbeatTimer: ReturnType<typeof setInterval> | null = setInterval(
    sendHeartbeat,
    heartbeatMs,
  );

  let maxRunTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    maxRunTimer = null;
    if (stopped) return;
    didTimeout = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    abortController.abort(new Error('Run exceeded 4.5-minute MV3 service worker time limit'));
  }, maxRunMs);

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (maxRunTimer !== null) {
      clearTimeout(maxRunTimer);
      maxRunTimer = null;
    }
  };

  if (abortController.signal.aborted) {
    stop();
  } else {
    abortController.signal.addEventListener('abort', stop, { once: true });
  }

  return {
    stop,
    timedOut: () => didTimeout,
  };
}

// ─── 6. Persisted Granted Optional Permissions Cache ────────────────

let memoryCachedOptPerms: string[] = [];

async function queryRuntimePermissions(): Promise<chrome.permissions.Permissions | undefined> {
  if (typeof chrome === 'undefined' || !chrome.permissions?.getAll) {
    return undefined;
  }
  return await new Promise<chrome.permissions.Permissions | undefined>((resolve) => {
    let settled = false;
    const finish = (val: chrome.permissions.Permissions | undefined) => {
      if (!settled) {
        settled = true;
        resolve(val);
      }
    };
    try {
      const ret = (
        chrome.permissions.getAll as unknown as (
          cb?: (p: chrome.permissions.Permissions) => void,
        ) => Promise<chrome.permissions.Permissions> | void
      )((p) => {
        void chrome.runtime?.lastError;
        finish(p);
      });
      if (ret && typeof (ret as Promise<unknown>).then === 'function') {
        (ret as Promise<chrome.permissions.Permissions>).then(finish, () => finish(undefined));
      }
    } catch {
      finish(undefined);
    }
  });
}

/**
 * Queries `chrome.permissions.getAll()`, caches granted optional permissions in
 * `chrome.storage.local` (`__pib_granted_opt_perms`), and returns the array.
 */
export async function syncCachedOptionalPermissions(): Promise<string[]> {
  const all = await queryRuntimePermissions();
  let required = new Set<string>();
  try {
    if (typeof chrome !== 'undefined' && typeof chrome.runtime?.getManifest === 'function') {
      const manifestPerms: readonly unknown[] = chrome.runtime.getManifest()?.permissions ?? [];
      required = new Set(manifestPerms.filter((p): p is string => typeof p === 'string'));
    }
  } catch {
    // Ignore
  }

  const rawPerms: readonly unknown[] = all?.permissions ?? [];
  const perms = Array.from(
    new Set(rawPerms.filter((p): p is string => typeof p === 'string' && !required.has(p))),
  );

  memoryCachedOptPerms = perms;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      await chrome.storage.local.set({ [GRANTED_OPT_PERMS_KEY]: perms });
    }
  } catch {
    // Keep in-memory fallback
  }
  return perms;
}

/**
 * Reads the persisted granted optional permissions list from `chrome.storage.local`.
 */
export async function readCachedOptionalPermissions(): Promise<string[]> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
      const stored = await chrome.storage.local.get(GRANTED_OPT_PERMS_KEY);
      const raw = stored?.[GRANTED_OPT_PERMS_KEY];
      if (Array.isArray(raw)) {
        const perms = raw.filter((p): p is string => typeof p === 'string');
        memoryCachedOptPerms = perms;
        return perms;
      }
      return [];
    }
  } catch {
    // Fall back to module memory
  }
  return [...memoryCachedOptPerms];
}
