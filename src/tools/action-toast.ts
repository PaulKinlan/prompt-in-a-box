import { tool } from 'ai';
import { z } from 'zod';

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
 * action_toast: Display an Undo toast bubble attached to the Extension icon (and popup) after actions like tab sorting.
 */
export const actionToast = tool({
  description:
    'Show an Undo toast bubble attached to the extension icon after modifying tabs or settings. Sets the badge, stores the undo snapshot, and opens the extension popup bubble.',
  inputSchema: z.object({
    message: z.string().describe('Toast message to display, e.g. "Sorted 8 tabs into 3 groups"'),
    undoLabel: z.string().optional().describe('Label for the undo button, e.g. "Undo Sort" (default: "Undo")'),
    badgeText: z.string().optional().describe('Text to show on extension icon badge, e.g. "UNDO" or "DONE" (default: "UNDO")'),
    openPopup: z.boolean().optional().describe('Whether to attempt opening the extension popup directly (default: true)'),
  }),
  execute: async ({ message, undoLabel, badgeText, openPopup }) => {
    const label = undoLabel || 'Undo';
    const badge = badgeText || 'UNDO';
    const shouldOpen = openPopup !== false;

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

    // Save active undo toast in storage
    await chrome.storage.local.set({ activeUndoToast: toastData });

    // Set extension action badge & title
    try {
      await chrome.action.setBadgeText({ text: badge });
      await chrome.action.setBadgeBackgroundColor({ color: '#d97706' }); // Warm amber
      await chrome.action.setTitle({ title: `${message} — Click to ${label}` });
    } catch {
      // ignore
    }

    // Attempt to open the extension popup bubble directly
    let popupOpened = false;
    if (shouldOpen && typeof chrome.action?.openPopup === 'function') {
      try {
        await chrome.action.openPopup();
        popupOpened = true;
      } catch {
        popupOpened = false;
      }
    }

    // If popup could not open, try injecting a small floating shadow-DOM banner into the active tab
    if (!popupOpened) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id && activeTab.url && /^https?:\/\//.test(activeTab.url)) {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: (msgText: string, btnText: string) => {
              const existing = document.getElementById('cap-undo-toast-host');
              if (existing) existing.remove();

              const host = document.createElement('div');
              host.id = 'cap-undo-toast-host';
              host.style.position = 'fixed';
              host.style.top = '16px';
              host.style.right = '16px';
              host.style.zIndex = '2147483647';
              host.style.fontFamily = 'system-ui, -apple-system, sans-serif';

              const shadow = host.attachShadow({ mode: 'open' });
              shadow.innerHTML = `
                <div style="background: #18181b; color: #fafafa; border: 1px solid #3f3f46; border-radius: 10px; padding: 10px 14px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 10px; font-size: 13px; max-width: 360px;">
                  <span style="flex: 1; line-height: 1.3;">${msgText}</span>
                  <button id="cap-undo-btn" style="background: #f59e0b; color: #000; font-weight: 600; border: none; border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 12px;">${btnText}</button>
                  <button id="cap-close-btn" style="background: transparent; color: #a1a1aa; border: none; font-size: 16px; cursor: pointer; padding: 0 4px;">&times;</button>
                </div>
              `;

              shadow.getElementById('cap-undo-btn')?.addEventListener('click', () => {
                chrome.runtime.sendMessage({ type: 'action-toast-undo' });
                host.remove();
              });
              shadow.getElementById('cap-close-btn')?.addEventListener('click', () => {
                chrome.runtime.sendMessage({ type: 'action-toast-dismiss' });
                host.remove();
              });

              document.body.appendChild(host);
              setTimeout(() => host.remove(), 12000);
            },
            args: [message, label],
          });
        }
      } catch {
        // In-page toast is best-effort
      }
    }

    return {
      success: true,
      message,
      undoLabel: label,
      badgeText: badge,
      popupOpened,
      hasSnapshot: !!snapshot,
    };
  },
});
