import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';

export const tabGroup = tool({
  description:
    'Group tabs together safely. Groups tabs per-window, reuses existing groups with matching titles in the same window, preserves collapsed state, and ignores pinned tabs.',
  inputSchema: z.object({
    tabIds: z.array(z.any()).optional().describe('Tab ids or tab objects to add to the group.'),
    ids: z.array(z.any()).optional().describe('Alias for tabIds.'),
    tabs: z.array(z.any()).optional().describe('Alias for tabIds (can be tab objects or ids).'),
    groupId: z.number().optional().describe('Existing group id. Omit to create a new one or reuse an existing matching group.'),
    id: z.number().optional().describe('Alias for groupId.'),
    windowId: z.number().optional().describe('Optional windowId to restrict or assign this group.'),
    title: z.string().optional(),
    name: z.string().optional().describe('Alias for title.'),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional(),
    collapsed: z
      .boolean()
      .optional()
      .describe('Whether the group should be collapsed. If omitted when adding to an existing group, the group\'s current collapsed state is preserved.'),
    includePinned: z.boolean().optional().describe('Whether to allow grouping pinned tabs (default false).'),
  }),
  execute: async ({ tabIds, ids, tabs, groupId, id, windowId, title, name, color, collapsed, includePinned }) => {
    // Record snapshot before modifying tab groups for undo support
    await recordSortSnapshotIfNeeded();

    const rawList = tabIds ?? ids ?? tabs ?? [];
    const requestedIds: number[] = rawList
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

    // Fetch live tab records
    const liveTabs: chrome.tabs.Tab[] = [];
    const previousTabs: Array<{
      tabId: number;
      groupId: number;
      index: number;
      windowId: number;
      groupTitle?: string;
      groupColor?: TabGroupColor;
      groupCollapsed?: boolean;
    }> = [];

    for (const tid of requestedIds) {
      try {
        const t = await chrome.tabs.get(tid);
        // Skip pinned tabs unless explicitly requested
        if (t.pinned && !includePinned) continue;

        let gTitle: string | undefined;
        let gColor: TabGroupColor | undefined;
        let gCollapsed: boolean | undefined;

        if (t.groupId && t.groupId > 0) {
          try {
            const g = await chrome.tabGroups.get(t.groupId);
            gTitle = g.title;
            gColor = g.color as TabGroupColor;
            gCollapsed = g.collapsed;
          } catch {
            // ignore
          }
        }

        previousTabs.push({
          tabId: tid,
          groupId: t.groupId ?? -1,
          index: t.index,
          windowId: t.windowId,
          groupTitle: gTitle,
          groupColor: gColor,
          groupCollapsed: gCollapsed,
        });

        liveTabs.push(t);
      } catch {
        // Tab no longer exists
      }
    }

    if (liveTabs.length === 0 && resolvedGroupId === undefined) {
      return { ok: false, error: 'No accessible unpinned tabs to group', tabCount: 0 };
    }

    // Determine target window
    const targetWindowId = windowId ?? (liveTabs[0]?.windowId || chrome.windows.WINDOW_ID_CURRENT);

    let finalGroupId = resolvedGroupId;
    let wasCollapsed: boolean | undefined;
    let prevGroupMeta: { title?: string; color?: TabGroupColor; collapsed?: boolean } | undefined;

    // 1. If groupId is provided, inspect existing group
    if (finalGroupId !== undefined) {
      try {
        const existingGroup = await chrome.tabGroups.get(finalGroupId);
        wasCollapsed = existingGroup.collapsed;
        prevGroupMeta = {
          title: existingGroup.title,
          color: existingGroup.color as TabGroupColor,
          collapsed: existingGroup.collapsed,
        };
      } catch {
        finalGroupId = undefined;
      }
    }

    // 2. If no groupId is provided, check if a group with the exact title already exists in this window
    if (finalGroupId === undefined && resolvedTitle && targetWindowId !== undefined) {
      try {
        const windowGroups = await chrome.tabGroups.query({ windowId: targetWindowId });
        const cleanTarget = resolvedTitle.trim().toLowerCase();
        const match = windowGroups.find((g) => (g.title || '').trim().toLowerCase() === cleanTarget);
        if (match) {
          finalGroupId = match.id;
          wasCollapsed = match.collapsed;
          prevGroupMeta = {
            title: match.title,
            color: match.color as TabGroupColor,
            collapsed: match.collapsed,
          };
        }
      } catch {
        // ignore
      }
    }

    // 3. Group tabs inside the target window
    const targetTabIds = liveTabs
      .filter((t) => targetWindowId === undefined || t.windowId === targetWindowId)
      .map((t) => t.id!);

    if (targetTabIds.length > 0) {
      const groupProps: { tabIds: [number, ...number[]]; groupId?: number; createProperties?: { windowId?: number } } = {
        tabIds: targetTabIds as [number, ...number[]],
      };
      if (finalGroupId !== undefined) {
        groupProps.groupId = finalGroupId;
      } else if (targetWindowId !== undefined) {
        groupProps.createProperties = { windowId: targetWindowId };
      }

      finalGroupId = await chrome.tabs.group(groupProps as any);
    }

    // 4. Determine collapsed state safely (never force-collapse a group containing the active tab)
    const hasActiveTab = liveTabs.some((t) => t.active);
    let targetCollapsed = collapsed !== undefined ? collapsed : wasCollapsed;
    if (hasActiveTab && collapsed === undefined) {
      targetCollapsed = false; // preserve active tab visibility
    }

    if (finalGroupId !== undefined) {
      const updateProps: chrome.tabGroups.UpdateProperties = {};
      if (resolvedTitle !== undefined) updateProps.title = resolvedTitle;
      if (color !== undefined) updateProps.color = color;
      if (targetCollapsed !== undefined) updateProps.collapsed = targetCollapsed;
      try {
        await chrome.tabGroups.update(finalGroupId, updateProps);
      } catch {
        // ignore
      }
    }

    // Record action in journal
    await recordAction({
      toolName: 'tab_group',
      label: resolvedTitle ? `Grouped ${targetTabIds.length} tabs into "${resolvedTitle}"` : `Grouped ${targetTabIds.length} tabs`,
      detail: `${targetTabIds.length} tabs into group ${finalGroupId} (window ${targetWindowId})`,
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
      windowId: targetWindowId,
      title: resolvedTitle,
      color,
      collapsed: targetCollapsed ?? false,
      tabCount: targetTabIds.length,
    };
  },
});
