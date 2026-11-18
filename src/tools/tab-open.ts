import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { markAgentTabMutation } from '../events/mutation-guard';

export const tabOpen = tool({
  description: 'Open a URL in a new tab. Returns the new tab\'s id and title after it has loaded.',
  inputSchema: z.object({
    url: z.string().url(),
    active: z.boolean().optional().describe('Whether the new tab should be active (focused). Default false.'),
  }),
  execute: async ({ url, active }) => {
    markAgentTabMutation([], { urls: [url] });

    try {
      const tab = await chrome.tabs.create({ url, active: active ?? false });
      const urlsToMark = [url, tab.url, tab.pendingUrl].filter((u): u is string => Boolean(u));
      markAgentTabMutation(tab.id !== undefined ? [tab.id] : [], { urls: urlsToMark });

      if (tab.id !== undefined) {
        await recordAction({
          toolName: 'tab_open',
          label: `Opened tab: ${tab.title || url}`,
          detail: `Tab ID: ${tab.id}, URL: ${url}`,
          undo: {
            kind: 'tab_open',
            createdTabId: tab.id,
          },
        });
      }

      return { ok: true, tabId: tab.id, title: tab.title ?? '', url: tab.url ?? url };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
