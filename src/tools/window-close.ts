import { tool } from 'ai';
import { z } from 'zod';

export const windowClose = tool({
  description: 'Close a window by its id, including all tabs it contains.',
  inputSchema: z.object({ windowId: z.number() }),
  execute: async ({ windowId }) => {
    await chrome.windows.remove(windowId);
    return { ok: true };
  },
});
