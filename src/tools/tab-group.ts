import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';

export const tabGroup = tool({
  description:
    'Group tabs together. Pass `groupId` to add to an existing group, or omit and provide `title`/`color` to create a new group. Pass an empty tabIds with existing groupId to update the group\'s title/color/collapsed state.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).describe('Tab ids to add to the group.'),
    groupId: z.number().optional().describe('Existing group id. Omit to create a new one.'),
    title: z.string().optional(),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional(),
    collapsed: z
      .boolean()
      .optional()
      .describe('Whether the group should be collapsed. If omitted when adding to an existing group, the group\'s current collapsed state is preserved.'),
  }),
  execute: async ({ tabIds, groupId, title, color, collapsed }) => {
    // Record snapshot before modifying tab groups for undo support
    await recordSortSnapshotIfNeeded();

    // Capture pre-mutation state for undo journal
    const previousTabs: Array<{ tabId: number; groupId: number }> = [];
    for (const id of tabIds) {
      try {
        const t = await chrome.tabs.get(id);
        previousTabs.push({ tabId: id, groupId: t.groupId ?? -1 });
      } catch {
        previousTabs.push({ tabId: id, groupId: -1 });
      }
    }

    let wasCollapsed: boolean | undefined;
    let prevGroupMeta: { title?: string; color?: TabGroupColor; collapsed?: boolean } | undefined;
    if (groupId !== undefined) {
      try {
        const existingGroup = await chrome.tabGroups.get(groupId);
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

    let finalGroupId = groupId;
    if (tabIds.length > 0) {
      finalGroupId = await chrome.tabs.group({
        tabIds: tabIds as [number, ...number[]],
        groupId,
      });
    }

    const targetCollapsed = collapsed !== undefined ? collapsed : wasCollapsed;
    if (
      finalGroupId !== undefined &&
      (title !== undefined || color !== undefined || targetCollapsed !== undefined)
    ) {
      const updateProps: chrome.tabGroups.UpdateProperties = {};
      if (title !== undefined) updateProps.title = title;
      if (color !== undefined) updateProps.color = color;
      if (targetCollapsed !== undefined) updateProps.collapsed = targetCollapsed;
      await chrome.tabGroups.update(finalGroupId, updateProps);
    }

    // Record action in journal
    await recordAction({
      toolName: 'tab_group',
      label: title ? `Grouped ${tabIds.length} tabs into "${title}"` : `Grouped ${tabIds.length} tabs`,
      detail: `${tabIds.length} tabs into group ${finalGroupId}`,
      undo: {
        kind: 'tab_group',
        createdNewGroup: groupId === undefined,
        groupId: finalGroupId,
        previousGroupMeta: prevGroupMeta,
        previousTabs,
      },
    });

    return { groupId: finalGroupId, collapsed: targetCollapsed ?? false };
  },
});
