import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

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
    let previousBounds: {
      top?: number;
      left?: number;
      width?: number;
      height?: number;
      state?: chrome.windows.Window['state'];
    } = {};

    try {
      const win = await chrome.windows.get(windowId);
      previousBounds = {
        top: win.top,
        left: win.left,
        width: win.width,
        height: win.height,
        state: win.state,
      };
    } catch {
      // Ignore
    }

    await chrome.windows.update(windowId, { top, left, width, height, state });

    await recordAction({
      toolName: 'window_resize',
      label: `Resized window ${windowId}`,
      detail: `New state: ${state || 'custom bounds'}`,
      undo: {
        kind: 'window_resize',
        windowId,
        previousBounds,
      },
    });

    return { ok: true };
  },
});
