import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const tabPin = tool({
  description: 'Pin or unpin a tab. Pinned tabs sit at the start of the tab strip and survive window close semantics differently.',
  inputSchema: z.object({
    tabId: z.number(),
    pinned: z.boolean(),
  }),
  execute: async ({ tabId, pinned }) => {
    let wasPinned = false;
    let tabTitle = '';
    try {
      const before = await chrome.tabs.get(tabId);
      wasPinned = Boolean(before.pinned);
      tabTitle = before.title || '';
    } catch {
      // Ignore
    }

    const tab = await chrome.tabs.update(tabId, { pinned });

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

    return { tabId: tab?.id ?? tabId, pinned: tab?.pinned ?? pinned };
  },
});
