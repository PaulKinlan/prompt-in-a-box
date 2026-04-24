import { tool } from 'ai';
import { z } from 'zod';

export const windowResize = tool({
  description: 'Resize or reposition a window. Any omitted dimension is left unchanged. Set state to change minimize/maximize/fullscreen.',
  inputSchema: z.object({
    windowId: z.number(),
    top: z.number().optional(),
    left: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    state: z.enum(['normal', 'minimized', 'maximized', 'fullscreen']).optional(),
  }),
  execute: async ({ windowId, top, left, width, height, state }) => {
    await chrome.windows.update(windowId, { top, left, width, height, state });
    return { ok: true };
  },
});
