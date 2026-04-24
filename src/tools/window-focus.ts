import { tool } from 'ai';
import { z } from 'zod';

export const windowFocus = tool({
  description: 'Bring a window to the foreground and focus it.',
  inputSchema: z.object({ windowId: z.number() }),
  execute: async ({ windowId }) => {
    await chrome.windows.update(windowId, { focused: true });
    return { ok: true };
  },
});
