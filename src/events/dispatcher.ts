/**
 * Event dispatcher.
 *
 * At service-worker startup, this module subscribes synchronously (tick 0) to every
 * Chrome event source whose underlying API is available on `chrome.*` so Chrome MV3
 * can replay cold-wake events even for runtime-granted `optional_permissions`.
 *
 * When an event fires:
 *   1. Self-originated events caused by the agent's own tool mutations are dropped
 *      immediately (`isSelfOriginatedEvent`) to prevent feedback loops.
 *   2. Async permission/policy/prompt initialization (`initReady`) is awaited.
 *   3. During browser startup (`isInStartupCooldown`), session-restore tab storms
 *      are queued rather than firing individual immediate runs.
 *   4. If a saved `code_mode` deterministic event handler (`onEvents`) handles the
 *      event, it completes in ~30ms with 0 LLM tokens.
 *   5. Otherwise the event is written to the OPFS event queue, and if `wakeNow` is
 *      true, an agent run is triggered.
 */

import { ALL_SOURCES, type EventSource } from './registry';
import { enqueueEvent } from './queue';
import { isSelfOriginatedEvent } from './mutation-guard';
import { getStaticConfig } from '../config';
import {
  isInStartupCooldown,
  readCachedOptionalPermissions,
  syncCachedOptionalPermissions,
} from '../lifecycle';

export type FastPathEventHandler = (event: {
  at: number;
  source: string;
  payload: unknown;
}) => Promise<{ handled: boolean; scriptName?: string; result?: unknown }>;

const grantedPerms = new Set<string>();
const blockedPerms = new Set<string>();
let allowedPermsList: Set<string> | null = null;
let promptTriggerSources = new Set<string>();
let initReady: Promise<unknown> | null = null;
let initCompleted = false;
let lastTriggerCallback: (() => Promise<void>) | null = null;
let lastFastPathCallback: FastPathEventHandler | null = null;

const WAKEABLE_QUEUED_EVENTS = [
  'tabs.onUpdated',
  'tabs.onCreated',
  'tabs.onRemoved',
  'bookmarks.onCreated',
  'bookmarks.onChanged',
  'bookmarks.onRemoved',
  'history.onVisited',
  'downloads.onCreated',
  'downloads.onChanged',
  'webNavigation.onCompleted',
  'idle.onStateChanged',
  'readingList.onEntryAdded',
  'readingList.onEntryUpdated',
  'readingList.onEntryRemoved',
  'tabGroups.onCreated',
  'tabGroups.onUpdated',
  'tabGroups.onRemoved',
] as const;

/**
 * Inspects prompt.md text to determine which queued Chrome events should
 * immediately wake an agent run instead of waiting for the periodic alarm.
 */
export function detectPromptTriggerSources(promptText: string): Set<string> {
  const triggers = new Set<string>();
  if (!promptText) return triggers;

  // Strip declarative ```ui ... ``` JSON blocks before scanning
  const body = promptText.replace(/```ui[\s\S]*?```/gi, '');

  for (const ev of WAKEABLE_QUEUED_EVENTS) {
    const escaped = ev.replace('.', '\\.');
    const headingRegex = new RegExp(`##\\s+On\\b[^\\n]*\\b${escaped}\\b`, 'i');
    if (headingRegex.test(body)) {
      triggers.add(ev);
      continue;
    }

    const mentionRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (mentionRegex.test(body)) {
      // Do not auto-wake if the prompt only mentions reading passive queued events on periodic sweeps
      const passiveOnlyRegex = new RegExp(`get\\s+queued[^\\n]*\\b${escaped}\\b`, 'i');
      if (!passiveOnlyRegex.test(body)) {
        triggers.add(ev);
      }
    }
  }

  // Natural-language navigation trigger fallback
  if (
    !triggers.has('tabs.onUpdated') &&
    !triggers.has('webNavigation.onCompleted') &&
    /\bwhen (?:the )?user navigates to\b/i.test(body)
  ) {
    triggers.add('tabs.onUpdated');
  }

  return triggers;
}

function shouldWakeForPromptEvent(source: string, payload: unknown): boolean {
  if (!promptTriggerSources.has(source)) return false;

  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;

  if (source === 'tabs.onUpdated' || source === 'webNavigation.onCompleted') {
    const url = typeof p.url === 'string' ? p.url : '';
    // Only wake on real web navigations, never on chrome://newtab/, chrome-extension://, or about:blank
    return /^https?:\/\//i.test(url);
  }

  if (source === 'tabs.onCreated' && promptTriggerSources.has('tabs.onUpdated')) {
    const url = typeof p.url === 'string' ? p.url : '';
    return /^https?:\/\//i.test(url);
  }

  return true;
}

async function refreshPromptTriggers(): Promise<void> {
  try {
    let promptText = '';
    try {
      const stored = await chrome.storage.local.get('studioLiveOverride');
      const override = stored.studioLiveOverride as { enabled?: boolean; prompt?: string } | undefined;
      if (override?.enabled && typeof override.prompt === 'string' && override.prompt.trim().length > 0) {
        promptText = override.prompt;
      }
    } catch {
      // ignore
    }

    if (!promptText) {
      const url = chrome.runtime.getURL('prompt.md');
      const res = await fetch(url);
      if (res.ok) {
        promptText = await res.text();
      }
    }

    promptTriggerSources = detectPromptTriggerSources(promptText);
  } catch {
    // ignore
  }
}

function refreshSyncPerms(): void {
  grantedPerms.clear();
  for (const p of chrome.runtime.getManifest().permissions ?? []) {
    if (typeof p === 'string') grantedPerms.add(p);
  }
}

async function refreshAllPerms(): Promise<void> {
  const cachedOpt = await readCachedOptionalPermissions().catch(() => []);
  for (const perm of cachedOpt) {
    grantedPerms.add(perm);
  }

  await new Promise<void>((resolve) => {
    try {
      if (!chrome.permissions?.getAll) {
        resolve();
        return;
      }
      chrome.permissions.getAll((p) => {
        for (const perm of p?.permissions ?? []) {
          if (typeof perm === 'string') grantedPerms.add(perm);
        }
        resolve();
      });
    } catch {
      resolve();
    }
  });

  void syncCachedOptionalPermissions().catch(() => {});
}

async function refreshConfigPolicy(): Promise<void> {
  try {
    const cfg = await getStaticConfig();
    blockedPerms.clear();
    if (cfg.permissions?.blocked) {
      for (const p of cfg.permissions.blocked) blockedPerms.add(p);
    }
    if (cfg.permissions?.allowed && Array.isArray(cfg.permissions.allowed)) {
      allowedPermsList = new Set(cfg.permissions.allowed);
    } else {
      allowedPermsList = null;
    }
  } catch {
    // Ignore
  }
}

// Hook into runtime permission grant/revoke events and Studio live prompt changes
try {
  chrome.permissions?.onAdded?.addListener((p) => {
    for (const perm of p.permissions ?? []) {
      if (typeof perm === 'string') grantedPerms.add(perm);
    }
    void syncCachedOptionalPermissions().catch(() => {});
    syncListeners(false);
  });
  chrome.permissions?.onRemoved?.addListener((p) => {
    for (const perm of p.permissions ?? []) {
      if (typeof perm === 'string') grantedPerms.delete(perm);
    }
    refreshSyncPerms();
    void syncCachedOptionalPermissions().catch(() => {});
    syncListeners(false);
  });
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.studioLiveOverride) {
      initReady = refreshPromptTriggers();
    }
  });
} catch {
  // Not all runtimes support onAdded/onRemoved
}

const activeMap = new Map<string, { source: EventSource; unsubscribe: () => void }>();

function isPermPermitted(perm: string | null): boolean {
  if (perm === null) return true;
  if (blockedPerms.has(perm)) return false;
  if (allowedPermsList !== null && !allowedPermsList.has(perm)) return false;
  return grantedPerms.has(perm);
}

/**
 * Attaches or detaches Chrome event listeners.
 * When `optimisticTickZero` is true (synchronous SW boot before `chrome.permissions.getAll` resolves),
 * any source whose Chrome API object exists (`src.isAvailable()`) is attached synchronously so
 * Chrome MV3 can deliver cold-wake events for granted optional permissions; the callback still
 * awaits `initReady` and enforces `isPermPermitted()` before queuing or acting.
 */
function syncListeners(optimisticTickZero = false): void {
  if (!lastTriggerCallback) return;
  const trigger = lastTriggerCallback;

  for (const src of ALL_SOURCES) {
    const permitted = optimisticTickZero
      ? !src.permission || !blockedPerms.has(src.permission)
      : isPermPermitted(src.permission);
    const shouldSubscribe = permitted && src.isAvailable();
    const currentlyActive = activeMap.has(src.id);

    if (shouldSubscribe && !currentlyActive) {
      try {
        const unsubscribe = src.subscribe(({ source, triggersRun, payload }) => {
          // 1. Synchronous self-mutation check so agent tool calls never feed back into events
          if (isSelfOriginatedEvent(source, payload)) {
            return;
          }

          const eventAt = Date.now();
          (async () => {
            if (!initCompleted && initReady) {
              await initReady;
            }
            if (!isPermPermitted(src.permission)) return;
            if (isSelfOriginatedEvent(source, payload)) return;

            let wakeNow = triggersRun || shouldWakeForPromptEvent(source, payload);

            // 2. Suppress individual wakes during browser session-restore startup storms
            if (wakeNow && !triggersRun && (await isInStartupCooldown())) {
              wakeNow = false;
            }

            // 3. Zero-token deterministic fast-path via saved `code_mode` event routines (`onEvents`)
            if (wakeNow && lastFastPathCallback) {
              try {
                const fast = await lastFastPathCallback({ at: eventAt, source, payload });
                if (fast.handled) {
                  return;
                }
              } catch {
                // Fall back to standard queue + LLM run
              }
            }

            const queued = { at: eventAt, source, triggersRun: wakeNow, payload };
            await enqueueEvent(queued);
            if (wakeNow) {
              await trigger();
            }
          })().catch((err) => {
            console.warn('[events] dispatch failed:', err);
          });
        });
        activeMap.set(src.id, { source: src, unsubscribe });
      } catch {
        // Safe no-op, no warning spam
      }
    } else if (!shouldSubscribe && currentlyActive) {
      const item = activeMap.get(src.id);
      if (item) {
        try {
          item.unsubscribe();
        } catch {
          // Ignore
        }
        activeMap.delete(src.id);
      }
    }
  }
}

export async function startEvents(
  onEventTrigger: () => Promise<void>,
  onFastPathEvent?: FastPathEventHandler,
): Promise<void> {
  lastTriggerCallback = onEventTrigger;
  if (onFastPathEvent) {
    lastFastPathCallback = onFastPathEvent;
  }
  initCompleted = false;
  refreshSyncPerms();

  // Synchronous tick-0 registration including available optional-permission namespaces
  syncListeners(true);

  initReady = Promise.all([
    refreshAllPerms(),
    refreshConfigPolicy(),
    refreshPromptTriggers(),
  ]).catch(() => {});

  await initReady;
  initCompleted = true;

  // Prune any listeners that weren't actually granted or were policy-blocked
  syncListeners(false);
  console.log(
    '[events] active event sources:',
    activeMap.size,
    '| immediate prompt triggers:',
    Array.from(promptTriggerSources),
  );
}

export function stopEvents(): void {
  for (const [, { unsubscribe }] of activeMap) {
    try {
      unsubscribe();
    } catch {
      // Ignore
    }
  }
  activeMap.clear();
}
