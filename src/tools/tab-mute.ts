import { tool } from 'ai';
import { z } from 'zod';

export const tabMute = tool({
  description: 'Mute or unmute a tab. Useful for quieting background audio without closing it.',
  inputSchema: z.object({
    tabId: z.number(),
    muted: z.boolean(),
  }),
  execute: async ({ tabId, muted }) => {
    const tab = await chrome.tabs.update(tabId, { muted });
    return { tabId: tab.id, muted: tab.mutedInfo?.muted ?? muted };
  },
});
