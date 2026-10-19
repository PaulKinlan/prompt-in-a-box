import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const tabDuplicate = tool({
  description: 'Duplicate a tab. Returns the new tab id.',
  inputSchema: z.object({ tabId: z.number() }),
  execute: async ({ tabId }) => {
    const tab = await chrome.tabs.duplicate(tabId);

    if (tab?.id !== undefined) {
      await recordAction({
        toolName: 'tab_duplicate',
        label: `Duplicated tab ${tabId}`,
        detail: `New Tab ID: ${tab.id}`,
        undo: {
          kind: 'tab_duplicate',
          duplicatedTabId: tab.id,
        },
      });
    }

    return { tabId: tab?.id, url: tab?.url ?? null };
  },
});
