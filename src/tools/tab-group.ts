import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded, actionToast } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';

export const tabGroup = tool({
  description:
    'Group tabs together safely. Supports single-group mode or batch mode (creating multiple tab groups across windows in one call), auto-reuses existing groups with matching titles in the same window, strictly preserves collapsed state without expanding collapsed groups, and ignores pinned tabs.',
  inputSchema: z.object({
    groups: z
      .array(
        z.object({
          title: z.string().describe('Group title.'),
          color: z
            .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
            .optional(),
          tabIds: z.array(z.any()).describe('Tab IDs or objects to place in this group.'),
          windowId: z.number().optional().describe('Window ID for this group.'),
          collapsed: z.boolean().optional(),
        }),
      )
      .optional()
      .describe('Batch mode: define multiple tab groups to apply across windows in a single fast call.'),
    toastMessage: z
      .string()
      .optional()
      .describe('Optional Undo Toast message (e.g. "Sorted 12 tabs into 3 groups") to show immediately after grouping.'),
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
  execute: async ({
    groups,
    toastMessage,
    tabIds,
    ids,
    tabs,
    groupId,
    id,
    windowId,
    title,
    name,
    color,
    collapsed,
    includePinned,
  }) => {
    // Record snapshot before modifying tab groups for undo support
    await recordSortSnapshotIfNeeded();

    // Fetch all current tabs and tab groups in parallel for instant in-memory lookup
    const [allTabs, allGroups] = await Promise.all([
      chrome.tabs.query({}),
      chrome.tabGroups.query({}).catch(() => []),
    ]);

    const tabMap = new Map<number, chrome.tabs.Tab>();
    for (const t of allTabs) {
      if (t.id !== undefined) tabMap.set(t.id, t);
    }
    const groupMap = new Map<number, chrome.tabGroups.TabGroup>();
    const desiredCollapsedByGroupId = new Map<number, boolean>();
    for (const g of allGroups) {
      groupMap.set(g.id, g);
      if (g.collapsed) {
        desiredCollapsedByGroupId.set(g.id, true);
      }
    }

    // Helper to process a single group definition
    const processGroup = async (spec: {
      requestedTabItems: any[];
      targetGroupId?: number;
      targetTitle?: string;
      targetColor?: 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
      targetWindowId?: number;
      targetCollapsed?: boolean;
    }) => {
      const requestedIds: number[] = spec.requestedTabItems
        .map((item) => {
          if (typeof item === 'number') return item;
          if (typeof item === 'object' && item !== null) {
            const num = item.id ?? item.tabId;
            if (typeof num === 'number') return num;
          }
          return NaN;
        })
        .filter((n) => Number.isFinite(n));

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
        const t = tabMap.get(tid);
        if (!t) continue;
        if (t.pinned && !includePinned) continue;

        let gTitle: string | undefined;
        let gColor: TabGroupColor | undefined;
        let gCollapsed: boolean | undefined;

        if (t.groupId && t.groupId > 0) {
          const g = groupMap.get(t.groupId);
          if (g) {
            gTitle = g.title;
            gColor = g.color as TabGroupColor;
            gCollapsed = g.collapsed;
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
      }

      if (liveTabs.length === 0 && spec.targetGroupId === undefined) {
        return null;
      }

      const effectiveWindowId = spec.targetWindowId ?? (liveTabs[0]?.windowId || chrome.windows.WINDOW_ID_CURRENT);
      let finalGroupId = spec.targetGroupId;
      let wasCollapsed: boolean | undefined;
      let prevGroupMeta: { title?: string; color?: TabGroupColor; collapsed?: boolean } | undefined;

      if (finalGroupId !== undefined) {
        const eg = groupMap.get(finalGroupId);
        if (eg) {
          wasCollapsed = eg.collapsed;
          prevGroupMeta = {
            title: eg.title,
            color: eg.color as TabGroupColor,
            collapsed: eg.collapsed,
          };
        }
      }

      // Check matching title in the same window
      if (finalGroupId === undefined && spec.targetTitle && effectiveWindowId !== undefined) {
        const cleanTarget = spec.targetTitle.trim().toLowerCase();
        for (const g of allGroups) {
          if (g.windowId === effectiveWindowId && (g.title || '').trim().toLowerCase() === cleanTarget) {
            finalGroupId = g.id;
            wasCollapsed = g.collapsed;
            prevGroupMeta = {
              title: g.title,
              color: g.color as TabGroupColor,
              collapsed: g.collapsed,
            };
            break;
          }
        }
      }

      // If grouping tabs that previously came from a collapsed group, preserve collapsed state
      if (wasCollapsed === undefined && previousTabs.some((pt) => pt.groupCollapsed === true)) {
        wasCollapsed = true;
      }

      const targetTabIds = liveTabs
        .filter((t) => effectiveWindowId === undefined || t.windowId === effectiveWindowId)
        .map((t) => t.id!);

      if (targetTabIds.length > 0) {
        const groupProps: { tabIds: [number, ...number[]]; groupId?: number; createProperties?: { windowId?: number } } = {
          tabIds: targetTabIds as [number, ...number[]],
        };
        if (finalGroupId !== undefined) {
          groupProps.groupId = finalGroupId;
        } else if (effectiveWindowId !== undefined) {
          groupProps.createProperties = { windowId: effectiveWindowId };
        }

        finalGroupId = await chrome.tabs.group(groupProps as any);
      }

      // Strictly preserve collapsed state: An already-collapsed group MUST NEVER be expanded
      let targetCollapsed: boolean;
      if (wasCollapsed === true) {
        targetCollapsed = true;
      } else if (spec.targetCollapsed !== undefined) {
        targetCollapsed = spec.targetCollapsed;
      } else {
        targetCollapsed = wasCollapsed ?? false;
      }

      const resolvedColor = spec.targetColor ?? (prevGroupMeta?.color as TabGroupColor | undefined);

      if (finalGroupId !== undefined) {
        const updateProps: chrome.tabGroups.UpdateProperties = {};
        if (spec.targetTitle !== undefined) updateProps.title = spec.targetTitle;
        if (resolvedColor !== undefined) updateProps.color = resolvedColor;
        updateProps.collapsed = targetCollapsed;
        try {
          await chrome.tabGroups.update(finalGroupId, updateProps);
        } catch {
          // ignore
        }
        if (targetCollapsed) {
          desiredCollapsedByGroupId.set(finalGroupId, true);
        }
      }

      await recordAction({
        toolName: 'tab_group',
        label: spec.targetTitle ? `Grouped ${targetTabIds.length} tabs into "${spec.targetTitle}"` : `Grouped ${targetTabIds.length} tabs`,
        detail: `${targetTabIds.length} tabs into group ${finalGroupId} (window ${effectiveWindowId})`,
        undo: {
          kind: 'tab_group',
          createdNewGroup: spec.targetGroupId === undefined,
          groupId: finalGroupId,
          previousGroupMeta: prevGroupMeta,
          previousTabs,
        },
      });

      return {
        id: finalGroupId,
        groupId: finalGroupId,
        windowId: effectiveWindowId,
        title: spec.targetTitle,
        color: resolvedColor,
        collapsed: targetCollapsed,
        tabCount: targetTabIds.length,
      };
    };

    // Helper to ensure all groups that should be collapsed remain collapsed
    // (since moving/grouping tabs across the tabstrip can natively expand groups in Chrome)
    const enforceCollapsedStates = async () => {
      try {
        const currentGroups = await chrome.tabGroups.query({});
        for (const cg of currentGroups) {
          if (desiredCollapsedByGroupId.get(cg.id) === true && !cg.collapsed) {
            await chrome.tabGroups.update(cg.id, { collapsed: true }).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    };

    // 1. Batch mode
    if (Array.isArray(groups) && groups.length > 0) {
      const results: any[] = [];
      let totalTabs = 0;
      for (const g of groups) {
        const res = await processGroup({
          requestedTabItems: g.tabIds,
          targetTitle: g.title,
          targetColor: g.color,
          targetWindowId: g.windowId,
          targetCollapsed: g.collapsed,
        });
        if (res) {
          results.push(res);
          totalTabs += res.tabCount;
        }
      }

      await enforceCollapsedStates();

      const autoMessage = toastMessage || `Sorted ${totalTabs} tabs into ${results.length} groups`;
      try {
        await (actionToast.execute as any)(
          {
            message: autoMessage,
            undoLabel: 'Undo Sort',
            badgeText: '',
            openPopup: false,
          },
          { toolCallId: 'auto-toast', messages: [] },
        );
      } catch {
        // ignore
      }

      try {
        chrome.runtime.sendMessage({ type: 'action-history-updated' }).catch(() => {});
      } catch {
        // ignore
      }

      return {
        ok: true,
        batch: true,
        groups: results,
        totalTabsGrouped: totalTabs,
        toastMessage: autoMessage,
      };
    }

    // 2. Single group mode
    const rawList = tabIds ?? ids ?? tabs ?? [];
    const resolvedGroupId = groupId ?? id;
    const resolvedTitle = title ?? name;

    const singleRes = await processGroup({
      requestedTabItems: rawList,
      targetGroupId: resolvedGroupId,
      targetTitle: resolvedTitle,
      targetColor: color,
      targetWindowId: windowId,
      targetCollapsed: collapsed,
    });

    if (!singleRes) {
      return { ok: false, error: 'No accessible unpinned tabs to group', tabCount: 0 };
    }

    await enforceCollapsedStates();

    if (toastMessage) {
      try {
        await (actionToast.execute as any)(
          {
            message: toastMessage,
            undoLabel: 'Undo Sort',
            badgeText: '',
            openPopup: false,
          },
          { toolCallId: 'auto-toast', messages: [] },
        );
      } catch {
        // ignore
      }
    }

    try {
      chrome.runtime.sendMessage({ type: 'action-history-updated' }).catch(() => {});
    } catch {
      // ignore
    }

    return {
      ...singleRes,
      ok: true,
    };
  },
});
