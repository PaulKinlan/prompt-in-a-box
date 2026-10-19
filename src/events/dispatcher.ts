/**
 * Event dispatcher.
 *
 * At service-worker startup, this module subscribes to every Chrome
 * event source whose permission the extension actually holds. When an
 * event fires:
 *
 *   1. It is written to the OPFS event queue.
 *   2. If `triggersRun` is true, we kick off an agent run right away
 *      (via the `onEventTrigger` callback passed to `startEvents`).
 *
 * The subscriptions persist for the lifetime of the service worker.
 * When the SW is terminated (Chrome's MV3 idle policy), Chrome
 * automatically revives it on the next event fire because the
 * listeners were attached at module-load time. That's the expected
 * MV3 pattern.
 */

import { ALL_SOURCES, type EventSource } from './registry';
import { enqueueEvent } from './queue';

const grantedPerms = new Set<string>();

function refreshSyncPerms(): void {
  grantedPerms.clear();
  for (const p of chrome.runtime.getManifest().permissions ?? []) {
    if (typeof p === 'string') grantedPerms.add(p);
  }
}

async function refreshAllPerms(): Promise<void> {
  return new Promise((resolve) => {
    chrome.permissions.getAll((p) => {
      for (const perm of p.permissions ?? []) {
        if (typeof perm === 'string') grantedPerms.add(perm);
      }
      resolve();
    });
  });
}

// Hook into runtime permission grant/revoke events
try {
  chrome.permissions.onAdded.addListener((p) => {
    for (const perm of p.permissions ?? []) {
      if (typeof perm === 'string') grantedPerms.add(perm);
    }
  });
  chrome.permissions.onRemoved.addListener((p) => {
    for (const perm of p.permissions ?? []) {
      if (typeof perm === 'string') grantedPerms.delete(perm);
    }
    refreshSyncPerms();
  });
} catch {
  // Not all runtimes support onAdded/onRemoved
}

const active: Array<{ source: EventSource; unsubscribe: () => void }> = [];

export async function startEvents(onEventTrigger: () => Promise<void>): Promise<void> {
  refreshSyncPerms();
  stopEvents();

  // Attach listeners synchronously during this evaluation turn
  for (const src of ALL_SOURCES) {
    try {
      const unsubscribe = src.subscribe(({ source, triggersRun, payload }) => {
        // Gate emission on whether permission is currently held
        if (src.permission !== null && !grantedPerms.has(src.permission)) {
          return;
        }

        const queued = { at: Date.now(), source, triggersRun, payload };
        enqueueEvent(queued).catch(() => {});
        if (triggersRun) {
          onEventTrigger().catch((err) => {
            console.warn('[events] trigger failed:', err);
          });
        }
      });
      active.push({ source: src, unsubscribe });
    } catch (err) {
      console.warn(`[events] failed to subscribe to ${src.id}:`, err);
    }
  }

  // Refresh runtime-granted permissions asynchronously in background
  await refreshAllPerms().catch(() => {});
  console.log('[events] synchronously subscribed to', active.length, 'sources');
}

export function stopEvents(): void {
  for (const { unsubscribe } of active) {
    try {
      unsubscribe();
    } catch {
      // Ignore
    }
  }
  active.length = 0;
}
