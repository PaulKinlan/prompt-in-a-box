/**
 * Universal Action History & Reversible Undo Journal
 *
 * Tracks every mutating action performed across browser tools (tab grouping,
 * moving, pinning, closing, opening, bookmarks, windows, storage, etc.)
 * with deterministic inverse operations for both single-action and batch undo.
 */

export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export type UndoPayload =
  | {
      kind: 'tab_group';
      createdNewGroup: boolean;
      groupId?: number;
      previousGroupMeta?: { title?: string; color?: TabGroupColor; collapsed?: boolean };
      previousTabs: Array<{ tabId: number; groupId: number }>;
    }
  | {
      kind: 'tab_ungroup';
      previousGroups: Array<{
        groupId: number;
        title?: string;
        color?: TabGroupColor;
        collapsed?: boolean;
        tabIds: number[];
      }>;
    }
  | {
      kind: 'tab_move';
      previousPositions: Array<{ tabId: number; windowId: number; index: number }>;
    }
  | {
      kind: 'tab_pin';
      tabId: number;
      wasPinned: boolean;
    }
  | {
      kind: 'tab_mute';
      tabId: number;
      wasMuted: boolean;
    }
  | {
      kind: 'tab_close';
      closedTabs: Array<{
        url: string;
        title?: string;
        windowId: number;
        index: number;
        pinned?: boolean;
      }>;
    }
  | {
      kind: 'tab_open';
      createdTabId: number;
    }
  | {
      kind: 'tab_navigate';
      tabId: number;
      previousUrl: string;
    }
  | {
      kind: 'tab_duplicate';
      duplicatedTabId: number;
    }
  | {
      kind: 'window_create';
      createdWindowId: number;
    }
  | {
      kind: 'window_close';
      urls: string[];
      bounds?: { top?: number; left?: number; width?: number; height?: number };
    }
  | {
      kind: 'window_resize';
      windowId: number;
      previousBounds: {
        top?: number;
        left?: number;
        width?: number;
        height?: number;
        state?: chrome.windows.Window['state'];
      };
    }
  | {
      kind: 'bookmark_add';
      createdBookmarkId: string;
    }
  | {
      kind: 'bookmark_remove';
      removedNodes: Array<{ parentId?: string; index?: number; title: string; url?: string }>;
    }
  | {
      kind: 'reading_list_add';
      url: string;
    }
  | {
      kind: 'storage_set';
      fullKey: string;
      hadPrevious: boolean;
      previousValue?: unknown;
    };

export interface ActionHistoryEntry {
  id: string;
  runId: string;
  timestamp: number;
  toolName: string;
  label: string;
  detail?: string;
  undone: boolean;
  undoneAt?: number;
  undo: UndoPayload;
}

const ACTION_HISTORY_KEY = '__pib_action_history';
const MAX_HISTORY_ENTRIES = 100;

let currentRunId = 'manual';

export function setCurrentRunId(runId: string): void {
  currentRunId = runId;
}

export function getCurrentRunId(): string {
  return currentRunId;
}

/**
 * Prepend a newly executed mutation action to the journal.
 */
export async function recordAction(params: {
  toolName: string;
  label: string;
  detail?: string;
  undo: UndoPayload;
}): Promise<ActionHistoryEntry> {
  const entry: ActionHistoryEntry = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    runId: currentRunId,
    timestamp: Date.now(),
    toolName: params.toolName,
    label: params.label,
    detail: params.detail,
    undone: false,
    undo: params.undo,
  };

  try {
    const data = await chrome.storage.local.get(ACTION_HISTORY_KEY);
    const history = (data[ACTION_HISTORY_KEY] || []) as ActionHistoryEntry[];
    history.unshift(entry);
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.length = MAX_HISTORY_ENTRIES;
    }
    await chrome.storage.local.set({ [ACTION_HISTORY_KEY]: history });

    // Notify any open views
    try {
      chrome.runtime.sendMessage({ type: 'action-history-updated', entry }).catch(() => {});
    } catch {
      // Ignored
    }
  } catch (err) {
    console.warn('Failed to record action history:', err);
  }

  return entry;
}

/**
 * List the most recent actions.
 */
export async function listActionHistory(limit = 30): Promise<ActionHistoryEntry[]> {
  try {
    const data = await chrome.storage.local.get(ACTION_HISTORY_KEY);
    const history = (data[ACTION_HISTORY_KEY] || []) as ActionHistoryEntry[];
    return history.slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Execute the inverse operation for a single action entry by ID.
 */
export async function undoActionById(
  actionId: string,
): Promise<{ ok: boolean; entry?: ActionHistoryEntry; message: string; error?: string }> {
  try {
    const data = await chrome.storage.local.get(ACTION_HISTORY_KEY);
    const history = (data[ACTION_HISTORY_KEY] || []) as ActionHistoryEntry[];
    const entry = history.find((e) => e.id === actionId);

    if (!entry) {
      return { ok: false, message: 'Action not found', error: `No action entry with id "${actionId}"` };
    }

    if (entry.undone) {
      return { ok: true, entry, message: 'Action was already undone' };
    }

    await executeInverse(entry.undo);

    entry.undone = true;
    entry.undoneAt = Date.now();
    await chrome.storage.local.set({ [ACTION_HISTORY_KEY]: history });

    try {
      chrome.runtime.sendMessage({ type: 'action-history-updated', undoneActionId: actionId }).catch(() => {});
    } catch {
      // Ignored
    }

    return { ok: true, entry, message: `Successfully reverted: ${entry.label}` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: 'Failed to undo action', error: errorMsg };
  }
}

/**
 * Revert all non-undone actions from the most recent run (or the last non-undone action batch).
 */
export async function undoLastRun(): Promise<{ ok: boolean; undoneCount: number; message: string; error?: string }> {
  try {
    const data = await chrome.storage.local.get(ACTION_HISTORY_KEY);
    const history = (data[ACTION_HISTORY_KEY] || []) as ActionHistoryEntry[];

    // Find the latest non-undone action
    const latestNonUndone = history.find((e) => !e.undone);
    if (!latestNonUndone) {
      return { ok: true, undoneCount: 0, message: 'No actions to undo' };
    }

    const targetRunId = latestNonUndone.runId;
    // Find all non-undone actions with this runId
    const actionsToUndo = history.filter((e) => e.runId === targetRunId && !e.undone);

    let undoneCount = 0;
    // Execute inverse operations in reverse chronological order
    for (const act of actionsToUndo) {
      try {
        await executeInverse(act.undo);
        act.undone = true;
        act.undoneAt = Date.now();
        undoneCount++;
      } catch (err) {
        console.warn(`Failed to invert action ${act.id}:`, err);
      }
    }

    await chrome.storage.local.set({ [ACTION_HISTORY_KEY]: history });

    try {
      chrome.runtime.sendMessage({ type: 'action-history-updated', undoneRunId: targetRunId }).catch(() => {});
    } catch {
      // Ignored
    }

    return {
      ok: true,
      undoneCount,
      message: `Reverted ${undoneCount} action${undoneCount === 1 ? '' : 's'} from run ${targetRunId}`,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, undoneCount: 0, message: 'Failed to undo last run', error: errorMsg };
  }
}

/**
 * Executes the inverse Chrome API operations for a given undo payload.
 */
async function executeInverse(undo: UndoPayload): Promise<void> {
  switch (undo.kind) {
    case 'tab_group': {
      // Restore previous group assignments
      const ungroupTabIds: number[] = [];
      interface RegroupEntry {
        tabIds: number[];
        windowId?: number;
        title?: string;
        color?: TabGroupColor;
        collapsed?: boolean;
      }
      const regroupMap = new Map<number, RegroupEntry>();

      for (const t of undo.previousTabs as any[]) {
        if (t.groupId === -1 || t.groupId === undefined) {
          ungroupTabIds.push(t.tabId);
        } else {
          let entry = regroupMap.get(t.groupId);
          if (!entry) {
            entry = {
              tabIds: [],
              windowId: t.windowId,
              title: t.groupTitle,
              color: t.groupColor,
              collapsed: t.groupCollapsed,
            };
            regroupMap.set(t.groupId, entry);
          }
          entry.tabIds.push(t.tabId);
        }
      }

      if (ungroupTabIds.length > 0) {
        try {
          await chrome.tabs.ungroup(ungroupTabIds as [number, ...number[]]);
        } catch {
          // Tabs might have moved or closed
        }
      }

      for (const [prevGroupId, groupInfo] of regroupMap.entries()) {
        try {
          // Try adding back to original group ID
          await chrome.tabs.group({
            tabIds: groupInfo.tabIds as [number, ...number[]],
            groupId: prevGroupId > 0 ? prevGroupId : undefined,
          });
        } catch {
          // Original group ID was destroyed; recreate group
          try {
            const createProps = groupInfo.windowId !== undefined ? { windowId: groupInfo.windowId } : undefined;
            const newGid = await chrome.tabs.group({
              tabIds: groupInfo.tabIds as [number, ...number[]],
              createProperties: createProps,
            } as any);
            if (groupInfo.title || groupInfo.color || groupInfo.collapsed !== undefined) {
              await chrome.tabGroups.update(newGid, {
                title: groupInfo.title,
                color: groupInfo.color,
                collapsed: groupInfo.collapsed,
              });
            }
          } catch {
            // best effort
          }
        }
      }

      // Restore original tab indices if available
      const orderedTabs = [...undo.previousTabs].filter((t: any) => typeof t.index === 'number').sort((a: any, b: any) => a.index - b.index);
      for (const t of orderedTabs as any[]) {
        try {
          await chrome.tabs.move(t.tabId, { index: t.index });
        } catch {
          // tab might be gone
        }
      }

      // If we updated metadata of an existing group, restore previous metadata
      if (undo.groupId && undo.previousGroupMeta) {
        try {
          await chrome.tabGroups.update(undo.groupId, {
            title: undo.previousGroupMeta.title,
            color: undo.previousGroupMeta.color,
            collapsed: undo.previousGroupMeta.collapsed,
          });
        } catch {
          // Ignore
        }
      }
      break;
    }

    case 'tab_ungroup': {
      // Re-group tabs into their previous groups
      for (const prevGroup of undo.previousGroups) {
        if (prevGroup.tabIds.length === 0) continue;
        try {
          const newGroupId = await chrome.tabs.group({
            tabIds: prevGroup.tabIds as [number, ...number[]],
          });
          if (prevGroup.title || prevGroup.color || prevGroup.collapsed !== undefined) {
            await chrome.tabGroups.update(newGroupId, {
              title: prevGroup.title,
              color: prevGroup.color,
              collapsed: prevGroup.collapsed,
            });
          }
        } catch {
          // Ignore
        }
      }
      break;
    }

    case 'tab_move': {
      // Move tabs back to their previous indices and windows
      for (const pos of undo.previousPositions) {
        try {
          await chrome.tabs.move(pos.tabId, {
            index: pos.index,
            windowId: pos.windowId,
          });
        } catch {
          // Ignore
        }
      }
      break;
    }

    case 'tab_pin': {
      try {
        await chrome.tabs.update(undo.tabId, { pinned: undo.wasPinned });
      } catch {
        // Tab might be gone
      }
      break;
    }

    case 'tab_mute': {
      try {
        await chrome.tabs.update(undo.tabId, { muted: undo.wasMuted });
      } catch {
        // Tab might be gone
      }
      break;
    }

    case 'tab_close': {
      // Re-open closed tabs
      for (const closed of undo.closedTabs) {
        try {
          await chrome.tabs.create({
            url: closed.url,
            windowId: closed.windowId,
            index: closed.index,
            pinned: closed.pinned ?? false,
            active: false,
          });
        } catch {
          // Ignore
        }
      }
      break;
    }

    case 'tab_open': {
      try {
        await chrome.tabs.remove(undo.createdTabId);
      } catch {
        // Ignore
      }
      break;
    }

    case 'tab_navigate': {
      try {
        await chrome.tabs.update(undo.tabId, { url: undo.previousUrl });
      } catch {
        // Ignore
      }
      break;
    }

    case 'tab_duplicate': {
      try {
        await chrome.tabs.remove(undo.duplicatedTabId);
      } catch {
        // Ignore
      }
      break;
    }

    case 'window_create': {
      try {
        await chrome.windows.remove(undo.createdWindowId);
      } catch {
        // Ignore
      }
      break;
    }

    case 'window_close': {
      try {
        if (undo.urls.length > 0) {
          await chrome.windows.create({
            url: undo.urls,
            top: undo.bounds?.top,
            left: undo.bounds?.left,
            width: undo.bounds?.width,
            height: undo.bounds?.height,
          });
        }
      } catch {
        // Ignore
      }
      break;
    }

    case 'window_resize': {
      try {
        await chrome.windows.update(undo.windowId, {
          top: undo.previousBounds.top,
          left: undo.previousBounds.left,
          width: undo.previousBounds.width,
          height: undo.previousBounds.height,
          state: undo.previousBounds.state,
        });
      } catch {
        // Ignore
      }
      break;
    }

    case 'bookmark_add': {
      try {
        await chrome.bookmarks.remove(undo.createdBookmarkId);
      } catch {
        // Ignore
      }
      break;
    }

    case 'bookmark_remove': {
      for (const node of undo.removedNodes) {
        try {
          await chrome.bookmarks.create({
            parentId: node.parentId,
            index: node.index,
            title: node.title,
            url: node.url,
          });
        } catch {
          // Ignore
        }
      }
      break;
    }

    case 'reading_list_add': {
      // chrome.readingList does not offer a direct removeEntry in standard typings,
      // but if present duck-typed:
      try {
        const rl = (chrome as unknown as { readingList?: { removeEntry?: (opts: { url: string }) => Promise<void> } }).readingList;
        if (typeof rl?.removeEntry === 'function') {
          await rl.removeEntry({ url: undo.url });
        }
      } catch {
        // Ignore
      }
      break;
    }

    case 'storage_set': {
      try {
        if (undo.hadPrevious) {
          await chrome.storage.local.set({ [undo.fullKey]: undo.previousValue });
        } else {
          await chrome.storage.local.remove(undo.fullKey);
        }
      } catch {
        // Ignore
      }
      break;
    }
  }
}
