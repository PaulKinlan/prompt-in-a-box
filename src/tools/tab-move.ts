import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import {
  isMissingResourceError,
  markAgentTabMutation,
  markAgentWindowMutation,
} from '../events/mutation-guard';

export const tabMove = tool({
  description:
    'Move one or more tabs to a new position within a window, or to a different window. Index -1 appends.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1),
    index: z.number().int().describe('New index. Use -1 to append to the end.'),
    windowId: z.number().optional().describe('Destination window. Omit to move within the current window.'),
  }),
  execute: async ({ tabIds, index, windowId }) => {
    const previousPositions: Array<{ tabId: number; windowId: number; index: number }> = [];
    const liveTabIds: number[] = [];

    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        liveTabIds.push(id);
        previousPositions.push({ tabId: id, windowId: t.windowId, index: t.index });
      } catch {
        // Tab was closed before move; skip missing tab instead of failing the batch
      }
    }

    if (liveTabIds.length === 0) {
      return {
        ok: false,
        missing: true,
        error: `No tab with id: ${tabIds.join(', ')}`,
      };
    }

    markAgentTabMutation(liveTabIds);
    if (windowId !== undefined) {
      markAgentWindowMutation(windowId);
    }

    let arr: chrome.tabs.Tab[] = [];
    try {
      const moved = await chrome.tabs.move(liveTabIds, { index, windowId });
      arr = (Array.isArray(moved) ? moved : [moved]).filter(Boolean);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no window with id/i.test(msg)) {
        return { ok: false, missing: true, windowId, error: msg };
      }
      if (isMissingResourceError(err)) {
        // A tab closed mid-call; move surviving tabs individually
        for (const id of liveTabIds) {
          try {
            markAgentTabMutation(id);
            const single = await chrome.tabs.move(id, { index, windowId });
            if (single) {
              arr.push(...(Array.isArray(single) ? single : [single]));
            }
          } catch {
            // Skip closed tab
          }
        }
        if (arr.length === 0) {
          return { ok: false, missing: true, error: msg };
        }
      } else {
        return { ok: false, error: msg };
      }
    }

    const movedIds = arr.map((t) => t.id).filter((id): id is number => id !== undefined);
    if (movedIds.length > 0) {
      markAgentTabMutation(movedIds);
    }

    await recordAction({
      toolName: 'tab_move',
      label: `Moved ${arr.length} tab${arr.length === 1 ? '' : 's'} to index ${index}`,
      detail: `Tabs: ${(movedIds.length > 0 ? movedIds : liveTabIds).join(', ')}`,
      undo: {
        kind: 'tab_move',
        previousPositions: previousPositions.filter(
          (p) => movedIds.length === 0 || movedIds.includes(p.tabId),
        ),
      },
    });

    return arr.map((t) => ({ tabId: t.id, index: t.index, windowId: t.windowId }));
  },
});
