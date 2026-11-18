import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentTabMutation } from '../events/mutation-guard';

export const tabMute = tool({
  description: 'Mute or unmute a tab. Useful for quieting background audio without closing it.',
  inputSchema: z.object({
    tabId: z.number(),
    muted: z.boolean(),
  }),
  execute: async ({ tabId, muted }) => {
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

    const wasMuted = Boolean(before.mutedInfo?.muted);
    const tabTitle = before.title || '';

    markAgentTabMutation(tabId);

    try {
      const tab = await chrome.tabs.update(tabId, { muted });
      if (!tab) {
        return { ok: false, missing: true, tabId, error: `No tab with id: ${tabId}` };
      }
      markAgentTabMutation(tab.id ?? tabId);

      await recordAction({
        toolName: 'tab_mute',
        label: muted ? `Muted tab "${tabTitle || tabId}"` : `Unmuted tab "${tabTitle || tabId}"`,
        detail: `Tab ID: ${tabId}`,
        undo: {
          kind: 'tab_mute',
          tabId,
          wasMuted,
        },
      });

      return { ok: true, tabId: tab.id ?? tabId, muted: tab.mutedInfo?.muted ?? muted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, tabId, error: msg };
      }
      return { ok: false, tabId, error: msg };
    }
  },
});
