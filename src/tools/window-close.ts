import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const windowClose = tool({
  description: 'Close a window by its id, including all tabs it contains.',
  inputSchema: z.object({ windowId: z.number() }),
  execute: async ({ windowId }) => {
    let urls: string[] = [];
    let bounds: { top?: number; left?: number; width?: number; height?: number } | undefined;

    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      urls = (win.tabs || []).map((t) => t.url || '').filter(Boolean);
      bounds = {
        top: win.top,
        left: win.left,
        width: win.width,
        height: win.height,
      };
    } catch {
      // Window might already be gone
    }

    await chrome.windows.remove(windowId);

    if (urls.length > 0) {
      await recordAction({
        toolName: 'window_close',
        label: `Closed window ${windowId} with ${urls.length} tabs`,
        detail: urls.slice(0, 3).join(', '),
        undo: {
          kind: 'window_close',
          urls,
          bounds,
        },
      });
    }

    return { ok: true };
  },
});
