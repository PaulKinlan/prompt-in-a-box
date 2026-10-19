import { tool } from 'ai';
import { z } from 'zod';

export const tabUngroup = tool({
  description: 'Remove one or more tabs from their tab groups so they become ungrouped again.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1).describe('Tab IDs to ungroup.'),
  }),
  execute: async ({ tabIds }) => {
    await chrome.tabs.ungroup(tabIds as [number, ...number[]]);
    return { ok: true, ungroupedTabIds: tabIds };
  },
});
