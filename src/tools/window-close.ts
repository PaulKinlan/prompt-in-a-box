import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import {
  isMissingResourceError,
  markAgentTabMutation,
  markAgentWindowMutation,
} from '../events/mutation-guard';

export const windowClose = tool({
  description: 'Close a window by its id, including all tabs it contains.',
  inputSchema: z.object({ windowId: z.number() }),
  execute: async ({ windowId }) => {
    let urls: string[] = [];
    let winTabIds: number[] = [];
    let bounds: { top?: number; left?: number; width?: number; height?: number } | undefined;

    try {
      const win = await chrome.windows.get(windowId, { populate: true });
      urls = (win.tabs || []).map((t) => t.url || '').filter(Boolean);
      winTabIds = (win.tabs || [])
        .map((t) => t.id)
        .filter((id): id is number => id !== undefined);
      bounds = {
        top: win.top,
        left: win.left,
        width: win.width,
        height: win.height,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, windowId, error: msg };
      }
      return { ok: false, windowId, error: msg };
    }

    markAgentWindowMutation(windowId);
    if (winTabIds.length > 0) {
      markAgentTabMutation(winTabIds);
    }

    try {
      await chrome.windows.remove(windowId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, windowId, error: msg };
      }
      return { ok: false, windowId, error: msg };
    }

    markAgentWindowMutation(windowId);

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

    return { ok: true, windowId };
  },
});
