import { tool } from 'ai';
import { z } from 'zod';
import {
  isMissingResourceError,
  markAgentTabMutation,
  markAgentWindowMutation,
} from '../events/mutation-guard';

export const tabFocus = tool({
  description: 'Bring the given tab to focus (active in its window, and its window raised).',
  inputSchema: z.object({ tabId: z.number() }),
  execute: async ({ tabId }) => {
    markAgentTabMutation(tabId);
    try {
      const tab = await chrome.tabs.update(tabId, { active: true });
      if (!tab) {
        return { ok: false, missing: true, tabId, error: `No tab with id: ${tabId}` };
      }
      markAgentTabMutation(tab.id ?? tabId);
      if (tab.windowId !== undefined) {
        markAgentWindowMutation(tab.windowId);
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
      }
      return { ok: true, tabId: tab.id ?? tabId, windowId: tab.windowId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }
  },
});
