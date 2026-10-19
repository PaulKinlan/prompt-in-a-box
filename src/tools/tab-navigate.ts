import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const tabNavigate = tool({
  description: 'Navigate an existing tab to a new URL, keeping the tab id stable.',
  inputSchema: z.object({
    tabId: z.number(),
    url: z.string().url(),
  }),
  execute: async ({ tabId, url }) => {
    let previousUrl = '';
    try {
      const before = await chrome.tabs.get(tabId);
      previousUrl = before.url || '';
    } catch {
      // Ignore
    }

    const tab = await chrome.tabs.update(tabId, { url });

    if (previousUrl) {
      await recordAction({
        toolName: 'tab_navigate',
        label: `Navigated tab to ${url}`,
        detail: `Tab ID: ${tabId}, Previous: ${previousUrl}`,
        undo: {
          kind: 'tab_navigate',
          tabId,
          previousUrl,
        },
      });
    }

    return { tabId: tab?.id ?? tabId, url: tab?.url ?? url };
  },
});
