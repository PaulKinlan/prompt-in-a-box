import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentTabMutation } from '../events/mutation-guard';

export const tabPin = tool({
  description:
    'Pin or unpin a tab. Pinned tabs sit at the start of the tab strip and survive window close semantics differently.',
  inputSchema: z.object({
    tabId: z.number(),
    pinned: z.boolean(),
  }),
  execute: async ({ tabId, pinned }) => {
    let before: chrome.tabs.Tab;
    try {
      before = await chrome.tabs.get(tabId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }

    const wasPinned = Boolean(before.pinned);
    const tabTitle = before.title || '';

    markAgentTabMutation(tabId);

    try {
      const tab = await chrome.tabs.update(tabId, { pinned });
      if (!tab) {
        return { ok: false, missing: true, tabId, error: `No tab with id: ${tabId}` };
      }
      markAgentTabMutation(tab.id ?? tabId);

      await recordAction({
        toolName: 'tab_pin',
        label: pinned ? `Pinned tab "${tabTitle || tabId}"` : `Unpinned tab "${tabTitle || tabId}"`,
        detail: `Tab ID: ${tabId}`,
        undo: {
          kind: 'tab_pin',
          tabId,
          wasPinned,
        },
      });

      return { ok: true, tabId: tab.id ?? tabId, pinned: tab.pinned ?? pinned };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }
  },
});
