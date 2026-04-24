import { tool } from 'ai';
import { z } from 'zod';

export const tabDuplicate = tool({
  description: 'Duplicate a tab. Returns the new tab id.',
  inputSchema: z.object({ tabId: z.number() }),
  execute: async ({ tabId }) => {
    const tab = await chrome.tabs.duplicate(tabId);
    return { tabId: tab?.id, url: tab?.url ?? null };
  },
});
