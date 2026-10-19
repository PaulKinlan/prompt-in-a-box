/**
 * Event dispatcher.
 *
 * At service-worker startup, this module subscribes to every Chrome
 * event source whose permission the extension actually holds and whose
 * underlying Chrome API is available at runtime.
 *
 * When an event fires:
 *   1. It is written to the OPFS event queue.
 *   2. If `triggersRun` is true, we kick off an agent run right away.
 *
 * Subscriptions are resilient to ungranted optional permissions and policy blocks,
 * and dynamically re-synchronize when optional permissions are granted or revoked.
 */

import { ALL_SOURCES, type EventSource } from './registry';
import { enqueueEvent } from './queue';
import { getStaticConfig } from '../config';

const grantedPerms = new Set<string>();
const blockedPerms = new Set<string>();
let allowedPermsList: Set<string> | null = null;
let lastTriggerCallback: (() => Promise<void>) | null = null;

function refreshSyncPerms(): void {
  grantedPerms.clear();
  for (const p of chrome.runtime.getManifest().permissions ?? []) {
    if (typeof p === 'string') grantedPerms.add(p);
  }
}

async function refreshAllPerms(): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.permissions.getAll((p) => {
        for (const perm of p.permissions ?? []) {
          if (typeof perm === 'string') grantedPerms.add(perm);
        }
        resolve();
      });
    } catch {
      resolve();
    }
  });
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

// Hook into runtime permission grant/revoke events
try {
  chrome.permissions?.onAdded?.addListener((p) => {
    for (const perm of p.permissions ?? []) {
      if (typeof perm === 'string') grantedPerms.add(perm);
    }
    syncListeners();
  });
  chrome.permissions?.onRemoved?.addListener((p) => {
    for (const perm of p.permissions ?? []) {
      if (typeof perm === 'string') grantedPerms.delete(perm);
    }
    refreshSyncPerms();
    syncListeners();
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

function syncListeners(): void {
  if (!lastTriggerCallback) return;
  const trigger = lastTriggerCallback;

  for (const src of ALL_SOURCES) {
    const shouldSubscribe = isPermPermitted(src.permission) && src.isAvailable();
    const currentlyActive = activeMap.has(src.id);

    if (shouldSubscribe && !currentlyActive) {
      try {
        const unsubscribe = src.subscribe(({ source, triggersRun, payload }) => {
          if (!isPermPermitted(src.permission)) return;

          const queued = { at: Date.now(), source, triggersRun, payload };
          enqueueEvent(queued).catch(() => {});
          if (triggersRun) {
            trigger().catch((err) => {
              console.warn('[events] trigger failed:', err);
            });
          }
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

export async function startEvents(onEventTrigger: () => Promise<void>): Promise<void> {
  lastTriggerCallback = onEventTrigger;
  refreshSyncPerms();
  syncListeners();

  // Refresh runtime-granted permissions and static policy asynchronously
  await Promise.all([refreshAllPerms(), refreshConfigPolicy()]).catch(() => {});
  syncListeners();
  console.log('[events] active event sources:', activeMap.size);
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
