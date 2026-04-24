import { tool } from 'ai';
import { z } from 'zod';

export const tabPin = tool({
  description: 'Pin or unpin a tab. Pinned tabs sit at the start of the tab strip and survive window close semantics differently.',
  inputSchema: z.object({
    tabId: z.number(),
    pinned: z.boolean(),
  }),
  execute: async ({ tabId, pinned }) => {
    const tab = await chrome.tabs.update(tabId, { pinned });
    return { tabId: tab.id, pinned: tab.pinned };
  },
});
