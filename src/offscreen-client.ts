/**
 * Service-worker-side helper for talking to the offscreen document.
 *
 * Creates the offscreen document on first use; Chrome only allows one
 * per extension, and the SW crashes if we `createDocument` while one
 * already exists. `ensureOffscreen` is idempotent. The document stays
 * around until Chrome decides to close it (typically when the SW is
 * idle).
 */

const OFFSCREEN_PATH = 'dist/offscreen.html';

async function hasOffscreen(): Promise<boolean> {
  // Modern Chrome exposes chrome.runtime.getContexts to check this,
  // though the type defs aren't always up-to-date. Fall back to the
  // older `reasons` approach if unavailable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getContexts = (chrome.runtime as any).getContexts;
  if (typeof getContexts === 'function') {
    const contexts = await getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
    });
    return contexts.length > 0;
  }
  return false;
}

export async function ensureOffscreen(
  reason: chrome.offscreen.Reason = chrome.offscreen.Reason.CLIPBOARD,
): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [reason],
    justification: 'DOM-dependent operations the service worker cannot perform itself (clipboard, HTML parsing).',
  });
}

export interface OffscreenMessage {
  target: 'offscreen';
  kind: 'clipboard-write-text' | 'parse-html';
  [key: string]: unknown;
}

export async function sendToOffscreen<T = unknown>(message: OffscreenMessage): Promise<T> {
  await ensureOffscreen();
  const reply = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (reply && typeof reply === 'object' && 'error' in reply && typeof reply.error === 'string') {
    throw new Error(reply.error);
  }
  return reply as T;
}
