import { tool } from 'ai';
import { z } from 'zod';

export const tabClose = tool({
  description:
    'Close one or more tabs by their numeric tabId. Returns an array of { tabId, closed, error? } so the model can see per-tab outcomes.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1).describe('Tab IDs to close'),
  }),
  execute: async ({ tabIds }) => {
    const results: Array<{ tabId: number; closed: boolean; error?: string }> = [];
    for (const id of tabIds) {
      try {
        await chrome.tabs.remove(id);
        results.push({ tabId: id, closed: true });
      } catch (err) {
        results.push({ tabId: id, closed: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  },
});
