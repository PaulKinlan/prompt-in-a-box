import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentTabMutation } from '../events/mutation-guard';

export const tabNavigate = tool({
  description: 'Navigate an existing tab to a new URL, keeping the tab id stable.',
  inputSchema: z.object({
    tabId: z.number(),
    url: z.string().url(),
  }),
  execute: async ({ tabId, url }) => {
    let before: chrome.tabs.Tab;
    try {
      before = await chrome.tabs.get(tabId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }

    const previousUrl = before.url || '';
    markAgentTabMutation(tabId, { urls: [url] });

    try {
      const tab = await chrome.tabs.update(tabId, { url });
      if (!tab) {
        return { ok: false, missing: true, tabId, error: `No tab with id: ${tabId}` };
      }
      const urlsToMark = [url, tab.url, tab.pendingUrl].filter((u): u is string => Boolean(u));
      markAgentTabMutation(tab.id ?? tabId, { urls: urlsToMark });

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

      return { ok: true, tabId: tab.id ?? tabId, url: tab.url ?? url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }
  },
});
