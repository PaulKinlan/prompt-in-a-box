import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';

export const tabGroup = tool({
  description:
    'Group tabs together. Pass `groupId` (or `id`) to add to an existing group, or omit and provide `title`/`color` to create a new group. Pass an empty tabIds with existing groupId to update the group\'s title/color/collapsed state.',
  inputSchema: z.object({
    tabIds: z.array(z.any()).optional().describe('Tab ids or tab objects to add to the group.'),
    ids: z.array(z.any()).optional().describe('Alias for tabIds.'),
    tabs: z.array(z.any()).optional().describe('Alias for tabIds (can be tab objects or ids).'),
    groupId: z.number().optional().describe('Existing group id. Omit to create a new one.'),
    id: z.number().optional().describe('Alias for groupId.'),
    title: z.string().optional(),
    name: z.string().optional().describe('Alias for title.'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional(),
    collapsed: z
      .boolean()
      .optional()
      .describe('Whether the group should be collapsed. If omitted when adding to an existing group, the group\'s current collapsed state is preserved.'),
  }),
  execute: async ({ tabIds, ids, tabs, groupId, id, title, name, color, collapsed }) => {
    // Record snapshot before modifying tab groups for undo support
    await recordSortSnapshotIfNeeded();

    const rawList = tabIds ?? ids ?? tabs ?? [];
    const resolvedTabIds: number[] = rawList
      .map((item) => {
        if (typeof item === 'number') return item;
        if (typeof item === 'object' && item !== null) {
          const num = item.id ?? item.tabId;
          if (typeof num === 'number') return num;
        }
        return NaN;
      })
      .filter((n) => Number.isFinite(n));

    const resolvedGroupId = groupId ?? id;
    const resolvedTitle = title ?? name;

    // Capture pre-mutation state for undo journal
    const previousTabs: Array<{ tabId: number; groupId: number }> = [];
    for (const tid of resolvedTabIds) {
      try {
        const t = await chrome.tabs.get(tid);
        previousTabs.push({ tabId: tid, groupId: t.groupId ?? -1 });
      } catch {
        previousTabs.push({ tabId: tid, groupId: -1 });
      }
    }

    let wasCollapsed: boolean | undefined;
    let prevGroupMeta: { title?: string; color?: TabGroupColor; collapsed?: boolean } | undefined;
    if (resolvedGroupId !== undefined) {
      try {
        const existingGroup = await chrome.tabGroups.get(resolvedGroupId);
        wasCollapsed = existingGroup.collapsed;
        prevGroupMeta = {
          title: existingGroup.title,
          color: existingGroup.color as TabGroupColor,
          collapsed: existingGroup.collapsed,
        };
      } catch {
        // Group may not exist or tabGroups permission not available
      }
    }

    let finalGroupId = resolvedGroupId;
    if (resolvedTabIds.length > 0) {
      finalGroupId = await chrome.tabs.group({
        tabIds: resolvedTabIds as [number, ...number[]],
        groupId: resolvedGroupId,
      });
    }

    const targetCollapsed = collapsed !== undefined ? collapsed : wasCollapsed;
    if (
      finalGroupId !== undefined &&
      (resolvedTitle !== undefined || color !== undefined || targetCollapsed !== undefined)
    ) {
      const updateProps: chrome.tabGroups.UpdateProperties = {};
      if (resolvedTitle !== undefined) updateProps.title = resolvedTitle;
      if (color !== undefined) updateProps.color = color;
      if (targetCollapsed !== undefined) updateProps.collapsed = targetCollapsed;
      await chrome.tabGroups.update(finalGroupId, updateProps);
    }

    // Record action in journal
    await recordAction({
      toolName: 'tab_group',
      label: resolvedTitle ? `Grouped ${resolvedTabIds.length} tabs into "${resolvedTitle}"` : `Grouped ${resolvedTabIds.length} tabs`,
      detail: `${resolvedTabIds.length} tabs into group ${finalGroupId}`,
      undo: {
        kind: 'tab_group',
        createdNewGroup: resolvedGroupId === undefined,
        groupId: finalGroupId,
        previousGroupMeta: prevGroupMeta,
        previousTabs,
      },
    });

    return {
      id: finalGroupId,
      groupId: finalGroupId,
      title: resolvedTitle,
      color,
      collapsed: targetCollapsed ?? false,
      tabCount: resolvedTabIds.length,
    };
  },
});
