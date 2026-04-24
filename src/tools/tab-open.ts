import { tool } from 'ai';
import { z } from 'zod';

export const tabOpen = tool({
  description: 'Open a URL in a new tab. Returns the new tab\'s id and title after it has loaded.',
  inputSchema: z.object({
    url: z.string().url(),
    active: z.boolean().optional().describe('Whether the new tab should be active (focused). Default false.'),
  }),
  execute: async ({ url, active }) => {
    const tab = await chrome.tabs.create({ url, active: active ?? false });
    return { tabId: tab.id, title: tab.title ?? '', url: tab.url ?? url };
  },
});
