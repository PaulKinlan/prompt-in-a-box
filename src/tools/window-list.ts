import { tool } from 'ai';
import { z } from 'zod';

export const windowList = tool({
  description:
    "List the user's browser windows. Each window carries its id, type (normal/popup/devtools), focused/incognito flags, bounds, and the number of tabs it contains.",
  inputSchema: z.object({
    populate: z.boolean().optional().describe('If true, include the tabs in each window. Default false.'),
  }),
  execute: async ({ populate }) => {
    const windows = await chrome.windows.getAll({ populate: populate ?? false });
    return windows.map((w) => ({
      windowId: w.id,
      type: w.type,
      state: w.state,
      focused: w.focused,
      incognito: w.incognito,
      top: w.top,
      left: w.left,
      width: w.width,
      height: w.height,
      tabCount: w.tabs?.length ?? 0,
      tabs: populate ? (w.tabs ?? []).map((t) => ({ tabId: t.id, title: t.title, url: t.url })) : undefined,
    }));
  },
});
