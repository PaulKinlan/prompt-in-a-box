/**
 * Chrome event source registry.
 *
 * Every row below is one Chrome event we can subscribe to. For each:
 *
 *   id            — stable name the prompt sees in the queue
 *   permission    — which manifest permission gates it (null if always-on)
 *   triggersRun   — true if the event should wake an agent run NOW;
 *                   false means it queues for the next scheduled tick
 *   isAvailable   — checks whether the underlying Chrome API namespace and event exist
 *   subscribe     — attaches the real Chrome listener, given a dispatch
 *                   callback. Returns an unsubscribe function.
 *
 * Safe-by-default: If an API is not available (optional permission ungranted or blocked),
 * isAvailable returns false and subscribe returns a no-op function without throwing.
 */

export type DispatchFn = (event: { source: string; triggersRun: boolean; payload: unknown }) => void;

interface ReadingListEntry {
  url: string;
  title: string;
  hasBeenRead: boolean;
  creationTime?: number;
  lastUpdateTime?: number;
}
interface ReadingListListener {
  addListener(cb: (entry: ReadingListEntry) => void): void;
  removeListener(cb: (entry: ReadingListEntry) => void): void;
}
interface ReadingListApi {
  onEntryAdded?: ReadingListListener;
  onEntryUpdated?: ReadingListListener;
  onEntryRemoved?: ReadingListListener;
}
function readingListApi(): ReadingListApi | undefined {
  return (chrome as unknown as { readingList?: ReadingListApi }).readingList;
}

export interface EventSource {
  id: string;
  permission: string | null;
  triggersRun: boolean;
  isAvailable: () => boolean;
  subscribe: (dispatch: DispatchFn) => () => void;
}

/** Helper: build a guarded EventSource declaratively. */
function source(
  id: string,
  permission: string | null,
  triggersRun: boolean,
  getEventObj: () => { addListener: (...args: any[]) => void; removeListener: (...args: any[]) => void } | undefined,
  install: (emit: (payload: unknown) => void) => () => void,
): EventSource {
  return {
    id,
    permission,
    triggersRun,
    isAvailable: () => {
      try {
        const ev = getEventObj();
        return Boolean(ev && typeof ev.addListener === 'function');
      } catch {
        return false;
      }
    },
    subscribe(dispatch) {
      try {
        const ev = getEventObj();
        if (!ev || typeof ev.addListener !== 'function') {
          return () => {};
        }
        return install((payload) => dispatch({ source: id, triggersRun, payload }));
      } catch {
        return () => {};
      }
    },
  };
}

// ─── Immediate-trigger sources ─────────────────────────────────────

export const IMMEDIATE_SOURCES: EventSource[] = [
  source(
    'contextMenus.onClicked',
    'contextMenus',
    true,
    () => chrome.contextMenus?.onClicked,
    (emit) => {
      const h = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) =>
        emit({ info, tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null });
      chrome.contextMenus?.onClicked?.addListener(h);
      return () => {
        try {
          chrome.contextMenus?.onClicked?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'notifications.onClicked',
    'notifications',
    true,
    () => chrome.notifications?.onClicked,
    (emit) => {
      const h = (id: string) => emit({ notificationId: id });
      chrome.notifications?.onClicked?.addListener(h);
      return () => {
        try {
          chrome.notifications?.onClicked?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'notifications.onButtonClicked',
    'notifications',
    true,
    () => chrome.notifications?.onButtonClicked,
    (emit) => {
      const h = (id: string, buttonIndex: number) => emit({ notificationId: id, buttonIndex });
      chrome.notifications?.onButtonClicked?.addListener(h);
      return () => {
        try {
          chrome.notifications?.onButtonClicked?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'commands.onCommand',
    null,
    true,
    () => (chrome as unknown as { commands?: typeof chrome.commands }).commands?.onCommand,
    (emit) => {
      const api = (chrome as unknown as { commands?: typeof chrome.commands }).commands;
      if (!api?.onCommand) return () => {};
      const h = (command: string) => emit({ command });
      api.onCommand.addListener(h);
      return () => {
        try {
          api.onCommand?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'omnibox.onInputEntered',
    null,
    true,
    () => (chrome as unknown as { omnibox?: typeof chrome.omnibox }).omnibox?.onInputEntered,
    (emit) => {
      const api = (chrome as unknown as { omnibox?: typeof chrome.omnibox }).omnibox;
      if (!api?.onInputEntered) return () => {};
      const h = (text: string, disposition: `${chrome.omnibox.OnInputEnteredDisposition}`) =>
        emit({ text, disposition });
      api.onInputEntered.addListener(h);
      return () => {
        try {
          api.onInputEntered?.removeListener(h);
        } catch {}
      };
    },
  ),
];

// ─── Queued sources ────────────────────────────────────────────────

export const QUEUED_SOURCES: EventSource[] = [
  source(
    'tabs.onCreated',
    'tabs',
    false,
    () => chrome.tabs?.onCreated,
    (emit) => {
      const h = (tab: chrome.tabs.Tab) =>
        emit({ tabId: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId });
      chrome.tabs?.onCreated?.addListener(h);
      return () => {
        try {
          chrome.tabs?.onCreated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'tabs.onUpdated',
    'tabs',
    false,
    () => chrome.tabs?.onUpdated,
    (emit) => {
      const h = (tabId: number, info: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
        if (info.status && info.status !== 'complete') return;
        emit({ tabId, url: tab.url, title: tab.title, status: info.status });
      };
      chrome.tabs?.onUpdated?.addListener(h);
      return () => {
        try {
          chrome.tabs?.onUpdated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'tabs.onRemoved',
    'tabs',
    false,
    () => chrome.tabs?.onRemoved,
    (emit) => {
      const h = (tabId: number, info: chrome.tabs.OnRemovedInfo) =>
        emit({ tabId, windowId: info.windowId, isWindowClosing: info.isWindowClosing });
      chrome.tabs?.onRemoved?.addListener(h);
      return () => {
        try {
          chrome.tabs?.onRemoved?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'tabs.onActivated',
    'tabs',
    false,
    () => chrome.tabs?.onActivated,
    (emit) => {
      const h = (info: chrome.tabs.OnActivatedInfo) => emit({ tabId: info.tabId, windowId: info.windowId });
      chrome.tabs?.onActivated?.addListener(h);
      return () => {
        try {
          chrome.tabs?.onActivated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'bookmarks.onCreated',
    'bookmarks',
    false,
    () => chrome.bookmarks?.onCreated,
    (emit) => {
      const h = (id: string, node: chrome.bookmarks.BookmarkTreeNode) =>
        emit({ id, title: node.title, url: node.url ?? null, parentId: node.parentId ?? null });
      chrome.bookmarks?.onCreated?.addListener(h);
      return () => {
        try {
          chrome.bookmarks?.onCreated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'bookmarks.onChanged',
    'bookmarks',
    false,
    () => chrome.bookmarks?.onChanged,
    (emit) => {
      const h = (id: string, info: { title: string; url?: string }) => emit({ id, ...info });
      chrome.bookmarks?.onChanged?.addListener(h);
      return () => {
        try {
          chrome.bookmarks?.onChanged?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'bookmarks.onRemoved',
    'bookmarks',
    false,
    () => chrome.bookmarks?.onRemoved,
    (emit) => {
      const h = (id: string, info: { parentId: string; index: number; node: chrome.bookmarks.BookmarkTreeNode }) =>
        emit({ id, parentId: info.parentId, index: info.index });
      chrome.bookmarks?.onRemoved?.addListener(h);
      return () => {
        try {
          chrome.bookmarks?.onRemoved?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'history.onVisited',
    'history',
    false,
    () => chrome.history?.onVisited,
    (emit) => {
      const h = (item: chrome.history.HistoryItem) =>
        emit({ url: item.url, title: item.title, lastVisitTime: item.lastVisitTime });
      chrome.history?.onVisited?.addListener(h);
      return () => {
        try {
          chrome.history?.onVisited?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'history.onVisitRemoved',
    'history',
    false,
    () => chrome.history?.onVisitRemoved,
    (emit) => {
      const h = (removed: chrome.history.RemovedResult) =>
        emit({ allHistory: removed.allHistory, urls: removed.urls });
      chrome.history?.onVisitRemoved?.addListener(h);
      return () => {
        try {
          chrome.history?.onVisitRemoved?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'downloads.onCreated',
    'downloads',
    false,
    () => chrome.downloads?.onCreated,
    (emit) => {
      const h = (d: chrome.downloads.DownloadItem) =>
        emit({ downloadId: d.id, url: d.url, filename: d.filename, mime: d.mime });
      chrome.downloads?.onCreated?.addListener(h);
      return () => {
        try {
          chrome.downloads?.onCreated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'downloads.onChanged',
    'downloads',
    false,
    () => chrome.downloads?.onChanged,
    (emit) => {
      const h = (delta: chrome.downloads.DownloadDelta) => emit({ downloadId: delta.id, ...delta });
      chrome.downloads?.onChanged?.addListener(h);
      return () => {
        try {
          chrome.downloads?.onChanged?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'downloads.onErased',
    'downloads',
    false,
    () => chrome.downloads?.onErased,
    (emit) => {
      const h = (id: number) => emit({ downloadId: id });
      chrome.downloads?.onErased?.addListener(h);
      return () => {
        try {
          chrome.downloads?.onErased?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'windows.onCreated',
    null,
    false,
    () => chrome.windows?.onCreated,
    (emit) => {
      const h = (w: chrome.windows.Window) =>
        emit({ windowId: w.id, type: w.type, incognito: w.incognito });
      chrome.windows?.onCreated?.addListener(h);
      return () => {
        try {
          chrome.windows?.onCreated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'windows.onRemoved',
    null,
    false,
    () => chrome.windows?.onRemoved,
    (emit) => {
      const h = (id: number) => emit({ windowId: id });
      chrome.windows?.onRemoved?.addListener(h);
      return () => {
        try {
          chrome.windows?.onRemoved?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'windows.onFocusChanged',
    null,
    false,
    () => chrome.windows?.onFocusChanged,
    (emit) => {
      const h = (id: number) => emit({ windowId: id });
      chrome.windows?.onFocusChanged?.addListener(h);
      return () => {
        try {
          chrome.windows?.onFocusChanged?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'webNavigation.onCompleted',
    'webNavigation',
    false,
    () => (chrome as unknown as { webNavigation?: { onCompleted: chrome.events.Event<(d: unknown) => void> } }).webNavigation?.onCompleted,
    (emit) => {
      const real = (chrome as unknown as { webNavigation?: { onCompleted: chrome.events.Event<(d: unknown) => void> } }).webNavigation;
      if (!real?.onCompleted) return () => {};
      const h = (d: unknown) => {
        const details = d as { tabId?: number; url?: string; frameId?: number };
        if (details.frameId !== 0) return;
        emit({ tabId: details.tabId, url: details.url });
      };
      real.onCompleted.addListener(h);
      return () => {
        try {
          real.onCompleted?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'idle.onStateChanged',
    'idle',
    true,
    () => (chrome as unknown as { idle?: typeof chrome.idle }).idle?.onStateChanged,
    (emit) => {
      const api = (chrome as unknown as { idle?: typeof chrome.idle }).idle;
      if (!api?.onStateChanged) return () => {};
      try {
        api.setDetectionInterval?.(60);
      } catch {
        // ignore
      }
      const h = (state: `${chrome.idle.IdleState}`) => {
        emit({ state, isIdleWake: state === 'idle' });
      };
      api.onStateChanged.addListener(h);
      return () => {
        try {
          api.onStateChanged?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'readingList.onEntryAdded',
    'readingList',
    false,
    () => readingListApi()?.onEntryAdded,
    (emit) => {
      const listener = readingListApi()?.onEntryAdded;
      if (!listener) return () => {};
      const h = (entry: ReadingListEntry) =>
        emit({ url: entry.url, title: entry.title, hasBeenRead: entry.hasBeenRead });
      listener.addListener(h);
      return () => {
        try {
          listener.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'readingList.onEntryUpdated',
    'readingList',
    false,
    () => readingListApi()?.onEntryUpdated,
    (emit) => {
      const listener = readingListApi()?.onEntryUpdated;
      if (!listener) return () => {};
      const h = (entry: ReadingListEntry) =>
        emit({ url: entry.url, title: entry.title, hasBeenRead: entry.hasBeenRead });
      listener.addListener(h);
      return () => {
        try {
          listener.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'readingList.onEntryRemoved',
    'readingList',
    false,
    () => readingListApi()?.onEntryRemoved,
    (emit) => {
      const listener = readingListApi()?.onEntryRemoved;
      if (!listener) return () => {};
      const h = (entry: ReadingListEntry) => emit({ url: entry.url, title: entry.title });
      listener.addListener(h);
      return () => {
        try {
          listener.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'tabGroups.onCreated',
    'tabGroups',
    false,
    () => (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups?.onCreated,
    (emit) => {
      const api = (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
      if (!api?.onCreated) return () => {};
      const h = (g: chrome.tabGroups.TabGroup) =>
        emit({ groupId: g.id, title: g.title, color: g.color, windowId: g.windowId });
      api.onCreated.addListener(h);
      return () => {
        try {
          api.onCreated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'tabGroups.onUpdated',
    'tabGroups',
    false,
    () => (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups?.onUpdated,
    (emit) => {
      const api = (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
      if (!api?.onUpdated) return () => {};
      const h = (g: chrome.tabGroups.TabGroup) =>
        emit({ groupId: g.id, title: g.title, color: g.color, collapsed: g.collapsed });
      api.onUpdated.addListener(h);
      return () => {
        try {
          api.onUpdated?.removeListener(h);
        } catch {}
      };
    },
  ),
  source(
    'tabGroups.onRemoved',
    'tabGroups',
    false,
    () => (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups?.onRemoved,
    (emit) => {
      const api = (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
      if (!api?.onRemoved) return () => {};
      const h = (g: chrome.tabGroups.TabGroup) => emit({ groupId: g.id });
      api.onRemoved.addListener(h);
      return () => {
        try {
          api.onRemoved?.removeListener(h);
        } catch {}
      };
    },
  ),
];

export const ALL_SOURCES: EventSource[] = [...IMMEDIATE_SOURCES, ...QUEUED_SOURCES];
