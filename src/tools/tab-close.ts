import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentTabMutation } from '../events/mutation-guard';

function normalizeHost(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    if (trimmed.includes('://')) {
      return new URL(trimmed).hostname.toLowerCase().replace(/^www\./, '');
    }
    return new URL(`https://${trimmed}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return trimmed.split('/')[0].split(':')[0].replace(/^www\./, '');
  }
}

function matchesExpectedHost(tabUrl: string | undefined, expectedHost: string): boolean {
  const target = normalizeHost(expectedHost);
  if (!target) return true;
  if (!tabUrl) return false;
  try {
    const actual = new URL(tabUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (!actual) return false;
    return actual === target || actual.endsWith(`.${target}`);
  } catch {
    return false;
  }
}

export const tabClose = tool({
  description:
    'Close one or more tabs by their numeric tabId. Protects pinned tabs by default and optionally guards against host navigation races via expectedHost. Returns an array of per-tab outcomes.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1).describe('Tab IDs to close'),
    allowPinned: z
      .boolean()
      .optional()
      .describe('Set true only if explicitly permitted to close pinned tabs. Default false.'),
    expectedHost: z
      .string()
      .optional()
      .describe('Optional domain/host guard; skips closing if the tab navigated to a different host.'),
  }),
  execute: async ({ tabIds, allowPinned, expectedHost }) => {
    const closedTabs: Array<{
      url: string;
      title?: string;
      windowId: number;
      index: number;
      pinned?: boolean;
    }> = [];

    const results: Array<{
      tabId: number;
      closed: boolean;
      alreadyClosed?: boolean;
      skipped?: boolean;
      reason?: string;
      error?: string;
    }> = [];

    for (const id of tabIds) {
      let t: chrome.tabs.Tab;
      try {
        t = await chrome.tabs.get(id);
      } catch {
        results.push({ tabId: id, closed: false, alreadyClosed: true });
        continue;
      }

      if (t.pinned && !allowPinned) {
        results.push({ tabId: id, closed: false, skipped: true, reason: 'Tab is pinned' });
        continue;
      }

      if (expectedHost && !matchesExpectedHost(t.url, expectedHost)) {
        results.push({
          tabId: id,
          closed: false,
          skipped: true,
          reason: 'Tab navigated to a different host',
        });
        continue;
      }

      markAgentTabMutation(id);

      try {
        await chrome.tabs.remove(id);
        markAgentTabMutation(id);
        results.push({ tabId: id, closed: true });
        if (t.url) {
          closedTabs.push({
            url: t.url,
            title: t.title,
            windowId: t.windowId,
            index: t.index,
            pinned: t.pinned,
          });
        }
      } catch (err) {
        if (isMissingResourceError(err)) {
          results.push({ tabId: id, closed: false, alreadyClosed: true });
        } else {
          results.push({
            tabId: id,
            closed: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    if (closedTabs.length > 0) {
      await recordAction({
        toolName: 'tab_close',
        label: `Closed ${closedTabs.length} tab${closedTabs.length === 1 ? '' : 's'}`,
        detail: closedTabs.map((t) => t.title || t.url).slice(0, 3).join(', '),
        undo: {
          kind: 'tab_close',
          closedTabs,
        },
      });
    }

    return results;
  },
});
