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

const MANIFEST_PERMS = new Set<string>();
function refreshManifestPerms(): void {
  MANIFEST_PERMS.clear();
  for (const p of chrome.runtime.getManifest().permissions ?? []) {
    if (typeof p === 'string') MANIFEST_PERMS.add(p);
  }
}

async function hasPermission(perm: string | null): Promise<boolean> {
  if (perm === null) return true;
  if (MANIFEST_PERMS.has(perm)) return true;
  // Runtime-granted optional permissions count too.
  return await new Promise<boolean>((resolve) => {
    chrome.permissions.contains({ permissions: [perm] }, (granted) => resolve(granted));
  });
}

const active: Array<{ source: EventSource; unsubscribe: () => void }> = [];

export async function startEvents(onEventTrigger: () => Promise<void>): Promise<void> {
  refreshManifestPerms();
  // Tear down any stale subscriptions before re-attaching. Calling
  // startEvents twice in the same SW lifetime is legal (the options
  // page can ask the background to re-scan permissions after a
  // runtime grant).
  stopEvents();

  for (const src of ALL_SOURCES) {
    if (!(await hasPermission(src.permission))) continue;
    try {
      const unsubscribe = src.subscribe(({ source, triggersRun, payload }) => {
        const queued = { at: Date.now(), source, triggersRun, payload };
        enqueueEvent(queued).catch(() => {
          // Queue write failures are non-fatal; the event is still
          // logged via the trigger path if applicable.
        });
        if (triggersRun) {
          // Don't await — we want the event handler to return fast so
          // Chrome's listener budget isn't consumed.
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

  console.log('[events] subscribed to', active.length, 'sources');
}

export function stopEvents(): void {
  for (const { unsubscribe } of active) {
    try {
      unsubscribe();
    } catch {
      // Ignore — the SW is probably tearing down.
    }
  }
  active.length = 0;
}
