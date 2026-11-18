import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentTabMutation } from '../events/mutation-guard';

export const tabDuplicate = tool({
  description: 'Duplicate a tab. Returns the new tab id.',
  inputSchema: z.object({ tabId: z.number() }),
  execute: async ({ tabId }) => {
    let sourceTab: chrome.tabs.Tab;
    try {
      sourceTab = await chrome.tabs.get(tabId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }

    markAgentTabMutation(tabId, sourceTab.url ? { urls: [sourceTab.url] } : undefined);

    try {
      const tab = await chrome.tabs.duplicate(tabId);
      if (!tab) {
        return { ok: false, missing: true, tabId, error: `No tab with id: ${tabId}` };
      }

      const urlsToMark = [sourceTab.url, tab.url, tab.pendingUrl].filter(
        (u): u is string => Boolean(u),
      );
      if (tab.id !== undefined) {
        markAgentTabMutation(tab.id, urlsToMark.length > 0 ? { urls: urlsToMark } : undefined);
      }

      if (tab.id !== undefined) {
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

      return { ok: true, tabId: tab.id, url: tab.url ?? null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }
  },
});
