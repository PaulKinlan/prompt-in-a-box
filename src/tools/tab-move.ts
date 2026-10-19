import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

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
    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        previousPositions.push({ tabId: id, windowId: t.windowId, index: t.index });
      } catch {
        // Tab might be gone
      }
    }

    const moved = await chrome.tabs.move(tabIds, { index, windowId });
    const arr = Array.isArray(moved) ? moved : [moved];

    await recordAction({
      toolName: 'tab_move',
      label: `Moved ${tabIds.length} tab${tabIds.length === 1 ? '' : 's'} to index ${index}`,
      detail: `Tabs: ${tabIds.join(', ')}`,
      undo: {
        kind: 'tab_move',
        previousPositions,
      },
    });

    return arr.map((t) => ({ tabId: t.id, index: t.index, windowId: t.windowId }));
  },
});
