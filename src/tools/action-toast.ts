import { tool } from 'ai';
import { z } from 'zod';
import { listActionHistory, undoActionById, undoLastRun } from '../action-history';

export interface TabSnapshotItem {
  id: number;
  groupId: number;
  index: number;
  windowId: number;
  title?: string;
  url?: string;
}

export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';

export interface GroupSnapshotItem {
  id: number;
  title?: string;
  color?: TabGroupColor;
  collapsed?: boolean;
}

export interface SortSnapshot {
  timestamp: number;
  tabs: TabSnapshotItem[];
  groups: GroupSnapshotItem[];
}

export interface ActiveUndoToast {
  id: string;
  createdAt: number;
  expiresAt: number;
  message: string;
  undoLabel: string;
  snapshot?: SortSnapshot;
}

/**
 * Automatically take a snapshot of tabs and groups before mutating them if not recently taken.
 */
export async function recordSortSnapshotIfNeeded(): Promise<SortSnapshot | null> {
  try {
    const existing = await chrome.storage.local.get('lastSortSnapshot');
    const prev = existing.lastSortSnapshot as SortSnapshot | undefined;
    if (prev && Date.now() - prev.timestamp < 45_000) {
      return prev;
    }

    const allTabs = await chrome.tabs.query({});
    const tabs: TabSnapshotItem[] = allTabs.map((t) => ({
      id: t.id!,
      groupId: t.groupId ?? -1,
      index: t.index,
      windowId: t.windowId,
      title: t.title,
      url: t.url,
    }));

    let groups: GroupSnapshotItem[] = [];
    try {
      const allGroups = await chrome.tabGroups.query({});
      groups = allGroups.map((g) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
      }));
    } catch {
      // tabGroups permission may be missing
    }

    const snapshot: SortSnapshot = {
      timestamp: Date.now(),
      tabs,
      groups,
    };

    await chrome.storage.local.set({ lastSortSnapshot: snapshot });
    return snapshot;
  } catch (err) {
    console.warn('Failed to record sort snapshot:', err);
    return null;
  }
}

/**
 * action_toast: Record an Undo snapshot for the extension popup without interrupting the user.
 */
export const actionToast = tool({
  description:
    'Record an Undo snapshot and update the extension toolbar tooltip after modifying tabs or settings without interrupting the user. Stores the snapshot in storage so it is available when the user opens the extension.',
  inputSchema: z.object({
    message: z.string().describe('Toast message to display, e.g. "Sorted 8 tabs into 3 groups"'),
    undoLabel: z.string().optional().describe('Label for the undo button, e.g. "Undo Sort" (default: "Undo")'),
    badgeText: z.string().optional().describe('Optional short badge text for the toolbar icon'),
    openPopup: z.boolean().optional().describe('Deprecated: extension popups are never auto-opened to prevent focus stealing'),
  }),
  execute: async ({ message, undoLabel, badgeText, openPopup: _openPopup }) => {
    const label = undoLabel || 'Undo';

    // Retrieve the most recent sort snapshot if recorded
    let snapshot: SortSnapshot | undefined;
    try {
      const stored = await chrome.storage.local.get('lastSortSnapshot');
      snapshot = stored.lastSortSnapshot as SortSnapshot | undefined;
    } catch {
      // ignore
    }

    const toastData: ActiveUndoToast = {
      id: `toast-${Date.now()}`,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60_000, // 10 minutes
      message,
      undoLabel: label,
      snapshot,
    };

    // Save active undo toast in storage so the popup displays the Undo banner when opened by the user
    await chrome.storage.local.set({ activeUndoToast: toastData });

    // Update extension action title (tooltip) without stealing focus or popping up windows
    try {
      if (badgeText && badgeText.trim().length > 0 && badgeText.trim().length <= 3) {
        await chrome.action.setBadgeText({ text: badgeText.trim() });
        await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
      } else {
        await chrome.action.setBadgeText({ text: '' });
      }
      await chrome.action.setTitle({ title: `${message} — Open extension to ${label}` });
    } catch {
      // ignore
    }

    return {
      success: true,
      message,
      undoLabel: label,
      popupOpened: false,
      hasSnapshot: !!snapshot,
    };
  },
});

export const actionHistory = tool({
  description: 'List the recent tool mutation actions (e.g. tabs grouped, moved, closed) and their undo status.',
  inputSchema: z.object({
    limit: z.number().int().positive().optional().describe('Maximum number of recent actions to return. Default 20.'),
  }),
  execute: async ({ limit }) => {
    const history = await listActionHistory(limit ?? 20);
    return {
      count: history.length,
      actions: history.map((h) => ({
        id: h.id,
        runId: h.runId,
        timestamp: h.timestamp,
        tool: h.toolName,
        label: h.label,
        detail: h.detail,
        undone: h.undone,
      })),
    };
  },
});

export const actionUndo = tool({
  description: 'Revert a specific tool mutation action by its action ID, or revert the entire last run.',
  inputSchema: z.object({
    actionId: z.string().optional().describe('The specific action ID to revert. If omitted, reverts all actions from the most recent run.'),
  }),
  execute: async ({ actionId }) => {
    if (actionId) {
      return await undoActionById(actionId);
    }
    return await undoLastRun();
  },
});
