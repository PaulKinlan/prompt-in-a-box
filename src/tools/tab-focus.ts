import { tool } from 'ai';
import { z } from 'zod';

export const tabFocus = tool({
  description: 'Bring the given tab to focus (active in its window, and its window raised).',
  inputSchema: z.object({ tabId: z.number() }),
  execute: async ({ tabId }) => {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return { ok: true };
  },
});
