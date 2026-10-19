import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const tabClose = tool({
  description:
    'Close one or more tabs by their numeric tabId. Returns an array of { tabId, closed, error? } so the model can see per-tab outcomes.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1).describe('Tab IDs to close'),
  }),
  execute: async ({ tabIds }) => {
    const closedTabs: Array<{
      url: string;
      title?: string;
      windowId: number;
      index: number;
      pinned?: boolean;
    }> = [];

    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        if (t.url) {
          closedTabs.push({
            url: t.url,
            title: t.title,
            windowId: t.windowId,
            index: t.index,
            pinned: t.pinned,
          });
        }
      } catch {
        // Tab might already be gone
      }
    }

    const results: Array<{ tabId: number; closed: boolean; error?: string }> = [];
    for (const id of tabIds) {
      try {
        await chrome.tabs.remove(id);
        results.push({ tabId: id, closed: true });
      } catch (err) {
        results.push({ tabId: id, closed: false, error: err instanceof Error ? err.message : String(err) });
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
