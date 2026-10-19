import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const tabMute = tool({
  description: 'Mute or unmute a tab. Useful for quieting background audio without closing it.',
  inputSchema: z.object({
    tabId: z.number(),
    muted: z.boolean(),
  }),
  execute: async ({ tabId, muted }) => {
    let wasMuted = false;
    let tabTitle = '';
    try {
      const before = await chrome.tabs.get(tabId);
      wasMuted = Boolean(before.mutedInfo?.muted);
      tabTitle = before.title || '';
    } catch {
      // Ignore
    }

    const tab = await chrome.tabs.update(tabId, { muted });

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

    return { tabId: tab?.id ?? tabId, muted: tab?.mutedInfo?.muted ?? muted };
  },
});
