import { tool } from 'ai';
import { z } from 'zod';

export const tabNavigate = tool({
  description: 'Navigate an existing tab to a new URL, keeping the tab id stable.',
  inputSchema: z.object({
    tabId: z.number(),
    url: z.string().url(),
  }),
  execute: async ({ tabId, url }) => {
    const tab = await chrome.tabs.update(tabId, { url });
    return { tabId: tab.id, url: tab.url ?? url };
  },
});
