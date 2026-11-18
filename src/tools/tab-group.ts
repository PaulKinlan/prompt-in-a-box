import { tool } from 'ai';
import { z } from 'zod';
import { recordSortSnapshotIfNeeded, actionToast } from './action-toast';
import { recordAction, type TabGroupColor } from '../action-history';
import {
  isMissingResourceError,
  markAgentGroupMutation,
  markAgentTabMutation,
} from '../events/mutation-guard';

type ProcessGroupResult =
  | {
      ok: true;
      id: number | undefined;
      groupId: number | undefined;
      windowId: number | undefined;
      title: string | undefined;
      color: TabGroupColor | undefined;
      collapsed: boolean;
      tabCount: number;
    }
  | {
      ok: false;
      missing?: boolean;
      groupId?: number;
      windowId?: number;
      error: string;
    }
  | null;

export const tabGroup = tool({
  description:
    'Group tabs together safely. Supports single-group mode or batch mode (creating multiple tab groups across windows in one call), auto-reuses existing groups with matching titles in the same window, strictly preserves collapsed state without expanding collapsed groups, and ignores pinned tabs.',
  inputSchema: z.object({
    groups: z
      .array(
        z.object({
          groupId: z
            .number()
            .optional()
            .describe('Optional existing groupId to add tabs into directly without creating a duplicate group.'),
          title: z
            .string()
            .optional()
            .describe('Group title (optional when adding to an existing groupId; required when creating a new group).'),
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
    groupId: z
      .number()
      .optional()
      .describe('Existing group id. Omit to create a new one or reuse an existing matching group.'),
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
      .describe(
        "Whether the group should be collapsed. If omitted when adding to an existing group, the group's current collapsed state is preserved.",
      ),
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
      chrome.tabs.query({}).catch(() => []),
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
    }): Promise<ProcessGroupResult> => {
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
      let existingRequestedCount = 0;
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
        existingRequestedCount++;
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
        if (requestedIds.length > 0 && existingRequestedCount === 0) {
          return {
            ok: false,
            missing: true,
            error: `No tab with id: ${requestedIds.join(', ')}`,
          };
        }
        return null;
      }

      const effectiveWindowId = spec.targetWindowId ?? (liveTabs[0]?.windowId || chrome.windows.WINDOW_ID_CURRENT);
      let finalGroupId = spec.targetGroupId;
      let wasCollapsed: boolean | undefined;
      let prevGroupMeta: { title?: string; color?: TabGroupColor; collapsed?: boolean } | undefined;

      if (finalGroupId !== undefined) {
        let eg = groupMap.get(finalGroupId);
        if (!eg) {
          try {
            eg = await chrome.tabGroups.get(finalGroupId);
            if (eg) groupMap.set(eg.id, eg);
          } catch {
            // Group no longer exists
          }
        }
        if (eg) {
          wasCollapsed = eg.collapsed;
          prevGroupMeta = {
            title: eg.title,
            color: eg.color as TabGroupColor,
            collapsed: eg.collapsed,
          };
        } else if (liveTabs.length === 0 || !spec.targetTitle) {
          return {
            ok: false,
            missing: true,
            groupId: finalGroupId,
            error: `No group with id: ${finalGroupId}`,
          };
        } else {
          finalGroupId = undefined;
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

      let targetTabIds = liveTabs
        .filter((t) => effectiveWindowId === undefined || t.windowId === effectiveWindowId)
        .map((t) => t.id!);

      const priorGroupIds = previousTabs.map((pt) => pt.groupId).filter((gid) => gid > 0);
      if (priorGroupIds.length > 0) {
        markAgentGroupMutation(priorGroupIds);
      }

      if (targetTabIds.length > 0) {
        markAgentTabMutation(targetTabIds);
        if (finalGroupId !== undefined) {
          markAgentGroupMutation(finalGroupId);
        }

        const buildGroupProps = (
          tids: number[],
          gid?: number,
        ): { tabIds: [number, ...number[]]; groupId?: number; createProperties?: { windowId?: number } } => {
          const gp: { tabIds: [number, ...number[]]; groupId?: number; createProperties?: { windowId?: number } } = {
            tabIds: tids as [number, ...number[]],
          };
          if (gid !== undefined) {
            gp.groupId = gid;
          } else if (effectiveWindowId !== undefined) {
            gp.createProperties = { windowId: effectiveWindowId };
          }
          return gp;
        };

        try {
          finalGroupId = await chrome.tabs.group(buildGroupProps(targetTabIds, finalGroupId) as any);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/no group with id|no tab group with id/i.test(msg)) {
            if (spec.targetTitle) {
              prevGroupMeta = undefined;
              try {
                finalGroupId = await chrome.tabs.group(buildGroupProps(targetTabIds, undefined) as any);
              } catch (retryErr) {
                const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                return {
                  ok: false,
                  missing: isMissingResourceError(retryErr),
                  error: retryMsg,
                };
              }
            } else {
              return {
                ok: false,
                missing: true,
                groupId: finalGroupId,
                error: msg,
              };
            }
          } else if (/no tab with id/i.test(msg)) {
            // Re-filter surviving tabs in case one closed between query and group
            const survivingIds: number[] = [];
            for (const tid of targetTabIds) {
              try {
                await chrome.tabs.get(tid);
                survivingIds.push(tid);
              } catch {
                // Skip closed tab
              }
            }
            if (survivingIds.length === 0) {
              return { ok: false, missing: true, error: msg };
            }
            targetTabIds = survivingIds;
            markAgentTabMutation(targetTabIds);
            try {
              finalGroupId = await chrome.tabs.group(buildGroupProps(targetTabIds, finalGroupId) as any);
            } catch (retryErr) {
              const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              return {
                ok: false,
                missing: isMissingResourceError(retryErr),
                error: retryMsg,
              };
            }
          } else if (/no window with id/i.test(msg)) {
            return {
              ok: false,
              missing: true,
              windowId: effectiveWindowId,
              error: msg,
            };
          } else if (isMissingResourceError(err)) {
            return { ok: false, missing: true, error: msg };
          } else {
            return { ok: false, error: msg };
          }
        }

        if (finalGroupId !== undefined) {
          markAgentGroupMutation(finalGroupId);
        }
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

      const isExistingGroup = prevGroupMeta !== undefined;
      const resolvedColor =
        isExistingGroup && prevGroupMeta?.color
          ? (spec.targetColor ?? prevGroupMeta.color)
          : (spec.targetColor ?? (prevGroupMeta?.color as TabGroupColor | undefined));

      // If targeting an existing group, preserve its existing title unless explicitly overriding
      const resolvedTitle =
        spec.targetTitle !== undefined && spec.targetTitle.trim().length > 0
          ? spec.targetTitle
          : prevGroupMeta?.title;

      if (finalGroupId !== undefined) {
        markAgentGroupMutation(finalGroupId);
        const updateProps: chrome.tabGroups.UpdateProperties = {};
        if (resolvedTitle !== undefined) updateProps.title = resolvedTitle;
        if (resolvedColor !== undefined) updateProps.color = resolvedColor;
        updateProps.collapsed = targetCollapsed;
        try {
          await chrome.tabGroups.update(finalGroupId, updateProps);
        } catch (err) {
          if (targetTabIds.length === 0 && isMissingResourceError(err)) {
            return {
              ok: false,
              missing: true,
              groupId: finalGroupId,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
        if (targetCollapsed) {
          desiredCollapsedByGroupId.set(finalGroupId, true);
        }
      }

      await recordAction({
        toolName: 'tab_group',
        label: resolvedTitle
          ? `Grouped ${targetTabIds.length} tabs into "${resolvedTitle}"`
          : `Grouped ${targetTabIds.length} tabs`,
        detail: `${targetTabIds.length} tabs into group ${finalGroupId} (window ${effectiveWindowId})`,
        undo: {
          kind: 'tab_group',
          createdNewGroup: !isExistingGroup,
          groupId: finalGroupId,
          previousGroupMeta: prevGroupMeta,
          previousTabs,
        },
      });

      return {
        ok: true,
        id: finalGroupId,
        groupId: finalGroupId,
        windowId: effectiveWindowId,
        title: resolvedTitle,
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
            markAgentGroupMutation(cg.id);
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
      const errors: Array<{ missing?: boolean; error: string }> = [];
      let totalTabs = 0;

      for (const g of groups) {
        const res = await processGroup({
          requestedTabItems: g.tabIds,
          targetGroupId: g.groupId,
          targetTitle: g.title,
          targetColor: g.color,
          targetWindowId: g.windowId,
          targetCollapsed: g.collapsed,
        });
        if (res && res.ok) {
          const { ok: _ok, ...groupSummary } = res;
          results.push(groupSummary);
          totalTabs += res.tabCount;
        } else if (res && !res.ok) {
          errors.push({ missing: res.missing, error: res.error });
        }
      }

      if (results.length === 0 && errors.length > 0) {
        const allMissing = errors.every((e) => e.missing);
        return {
          ok: false,
          ...(allMissing ? { missing: true } : {}),
          batch: true,
          groups: [],
          totalTabsGrouped: 0,
          error: errors.map((e) => e.error).join('; '),
        };
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

    if (!singleRes.ok) {
      return {
        ...singleRes,
        tabCount: 0,
      };
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

    return singleRes;
  },
});
