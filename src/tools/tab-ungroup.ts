import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';

export const tabUngroup = tool({
  description: 'Remove one or more tabs from their tab groups so they become ungrouped again.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1).describe('Tab IDs to ungroup.'),
  }),
  execute: async ({ tabIds }) => {
    await recordSortSnapshotIfNeeded();

    // Map existing groups before ungrouping
    const groupTabMap = new Map<number, number[]>();
    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        if (t.groupId && t.groupId > 0) {
          const list = groupTabMap.get(t.groupId) || [];
          list.push(id);
          groupTabMap.set(t.groupId, list);
        }
      } catch {
        // Tab might be gone
      }
    }

    const previousGroups: Array<{
      groupId: number;
      title?: string;
      color?: TabGroupColor;
      collapsed?: boolean;
      tabIds: number[];
    }> = [];

    for (const [gid, tids] of groupTabMap.entries()) {
      try {
        const g = await chrome.tabGroups.get(gid);
        previousGroups.push({
          groupId: gid,
          title: g.title,
          color: g.color as TabGroupColor,
          collapsed: g.collapsed,
          tabIds: tids,
        });
      } catch {
        previousGroups.push({
          groupId: gid,
          tabIds: tids,
        });
      }
    }

    await chrome.tabs.ungroup(tabIds as [number, ...number[]]);

    await recordAction({
      toolName: 'tab_ungroup',
      label: `Ungrouped ${tabIds.length} tabs`,
      detail: `Removed from ${previousGroups.length} group${previousGroups.length === 1 ? '' : 's'}`,
      undo: {
        kind: 'tab_ungroup',
        previousGroups,
      },
    });

    return { ok: true, ungroupedTabIds: tabIds };
  },
});
