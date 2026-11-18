import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';
import {
  isMissingResourceError,
  markAgentGroupMutation,
  markAgentTabMutation,
} from '../events/mutation-guard';

export const tabUngroup = tool({
  description: 'Remove one or more tabs from their tab groups so they become ungrouped again.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).min(1).describe('Tab IDs to ungroup.'),
  }),
  execute: async ({ tabIds }) => {
    await recordSortSnapshotIfNeeded();

    const liveTabIds: number[] = [];
    const missingTabIds: number[] = [];
    const groupTabMap = new Map<number, number[]>();

    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        liveTabIds.push(id);
        if (t.groupId && t.groupId > 0) {
          const list = groupTabMap.get(t.groupId) || [];
          list.push(id);
          groupTabMap.set(t.groupId, list);
        }
      } catch {
        missingTabIds.push(id);
      }
    }

    if (liveTabIds.length === 0) {
      return {
        ok: false,
        missing: true,
        missingTabIds,
        error: `No tab with id: ${tabIds.join(', ')}`,
      };
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

    markAgentTabMutation(liveTabIds);
    const affectedGroupIds = Array.from(groupTabMap.keys());
    if (affectedGroupIds.length > 0) {
      markAgentGroupMutation(affectedGroupIds);
    }

    let ungroupedIds = [...liveTabIds];
    try {
      await chrome.tabs.ungroup(liveTabIds as [number, ...number[]]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        ungroupedIds = [];
        for (const id of liveTabIds) {
          try {
            markAgentTabMutation(id);
            await chrome.tabs.ungroup(id);
            ungroupedIds.push(id);
          } catch {
            missingTabIds.push(id);
          }
        }
        if (ungroupedIds.length === 0) {
          return { ok: false, missing: true, missingTabIds, error: msg };
        }
      } else {
        return { ok: false, error: msg };
      }
    }

    markAgentTabMutation(ungroupedIds);
    if (affectedGroupIds.length > 0) {
      markAgentGroupMutation(affectedGroupIds);
    }

    await recordAction({
      toolName: 'tab_ungroup',
      label: `Ungrouped ${ungroupedIds.length} tab${ungroupedIds.length === 1 ? '' : 's'}`,
      detail: `Removed from ${previousGroups.length} group${previousGroups.length === 1 ? '' : 's'}`,
      undo: {
        kind: 'tab_ungroup',
        previousGroups,
      },
    });

    return {
      ok: true,
      ungroupedTabIds: ungroupedIds,
      ...(missingTabIds.length > 0 ? { missingTabIds } : {}),
    };
  },
});
