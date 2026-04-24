/**
 * Chrome event source registry.
 *
 * Every row below is one Chrome event we can subscribe to. For each:
 *
 *   id            — stable name the prompt sees in the queue
 *   permission    — which manifest permission gates it (null if always-on)
 *   triggersRun   — true if the event should wake an agent run NOW;
 *                   false means it queues for the next scheduled tick
 *   subscribe     — attaches the real Chrome listener, given a dispatch
 *                   callback. Returns an unsubscribe function.
 *
 * Immediate-trigger events are ones where the user expects the agent
 * to act in response to a specific action they just took (a context-
 * menu click, a keyboard shortcut, a notification click, an omnibox
 * command). Queued events are ambient world-state changes the agent
 * should know about on its next run (new tab opened, bookmark added,
 * download finished, history entry created).
 */

export type DispatchFn = (event: { source: string; triggersRun: boolean; payload: unknown }) => void;

// chrome.readingList is shipped at runtime but missing from the version
// of @types/chrome we depend on. Duck-type what we actually use.
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
  subscribe: (dispatch: DispatchFn) => () => void;
}

/** Helper: build an EventSource declaratively. */
function source(
  id: string,
  permission: string | null,
  triggersRun: boolean,
  install: (emit: (payload: unknown) => void) => () => void,
): EventSource {
  return {
    id,
    permission,
    triggersRun,
    subscribe(dispatch) {
      return install((payload) => dispatch({ source: id, triggersRun, payload }));
    },
  };
}

// ─── Immediate-trigger sources ─────────────────────────────────────

export const IMMEDIATE_SOURCES: EventSource[] = [
  source('contextMenus.onClicked', 'contextMenus', true, (emit) => {
    const h = (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) =>
      emit({ info, tab: tab ? { id: tab.id, url: tab.url, title: tab.title } : null });
    chrome.contextMenus.onClicked.addListener(h);
    return () => chrome.contextMenus.onClicked.removeListener(h);
  }),
  source('notifications.onClicked', 'notifications', true, (emit) => {
    const h = (id: string) => emit({ notificationId: id });
    chrome.notifications.onClicked.addListener(h);
    return () => chrome.notifications.onClicked.removeListener(h);
  }),
  source('notifications.onButtonClicked', 'notifications', true, (emit) => {
    const h = (id: string, buttonIndex: number) => emit({ notificationId: id, buttonIndex });
    chrome.notifications.onButtonClicked.addListener(h);
    return () => chrome.notifications.onButtonClicked.removeListener(h);
  }),
  source('commands.onCommand', null, true, (emit) => {
    // chrome.commands is always available if declared in manifest's
    // `commands` block (which we don't currently ship but can add).
    // Guard so subscribing is a no-op if it's not present.
    const api = (chrome as unknown as { commands?: typeof chrome.commands }).commands;
    if (!api) return () => {};
    const h = (command: string) => emit({ command });
    api.onCommand.addListener(h);
    return () => api.onCommand.removeListener(h);
  }),
  source('omnibox.onInputEntered', null, true, (emit) => {
    const api = (chrome as unknown as { omnibox?: typeof chrome.omnibox }).omnibox;
    if (!api) return () => {};
    const h = (text: string, disposition: chrome.omnibox.OnInputEnteredDisposition) =>
      emit({ text, disposition });
    api.onInputEntered.addListener(h);
    return () => api.onInputEntered.removeListener(h);
  }),
];

// ─── Queued sources ────────────────────────────────────────────────

export const QUEUED_SOURCES: EventSource[] = [
  source('tabs.onCreated', 'tabs', false, (emit) => {
    const h = (tab: chrome.tabs.Tab) => emit({ tabId: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId });
    chrome.tabs.onCreated.addListener(h);
    return () => chrome.tabs.onCreated.removeListener(h);
  }),
  source('tabs.onUpdated', 'tabs', false, (emit) => {
    const h = (tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      // Filter out the chatty status='loading' churn.
      if (info.status && info.status !== 'complete') return;
      emit({ tabId, url: tab.url, title: tab.title, status: info.status });
    };
    chrome.tabs.onUpdated.addListener(h);
    return () => chrome.tabs.onUpdated.removeListener(h);
  }),
  source('tabs.onRemoved', 'tabs', false, (emit) => {
    const h = (tabId: number, info: chrome.tabs.TabRemoveInfo) =>
      emit({ tabId, windowId: info.windowId, isWindowClosing: info.isWindowClosing });
    chrome.tabs.onRemoved.addListener(h);
    return () => chrome.tabs.onRemoved.removeListener(h);
  }),
  source('tabs.onActivated', 'tabs', false, (emit) => {
    const h = (info: chrome.tabs.TabActiveInfo) => emit({ tabId: info.tabId, windowId: info.windowId });
    chrome.tabs.onActivated.addListener(h);
    return () => chrome.tabs.onActivated.removeListener(h);
  }),
  source('bookmarks.onCreated', 'bookmarks', false, (emit) => {
    const h = (id: string, node: chrome.bookmarks.BookmarkTreeNode) =>
      emit({ id, title: node.title, url: node.url ?? null, parentId: node.parentId ?? null });
    chrome.bookmarks.onCreated.addListener(h);
    return () => chrome.bookmarks.onCreated.removeListener(h);
  }),
  source('bookmarks.onChanged', 'bookmarks', false, (emit) => {
    const h = (id: string, info: chrome.bookmarks.BookmarkChangeInfo) => emit({ id, ...info });
    chrome.bookmarks.onChanged.addListener(h);
    return () => chrome.bookmarks.onChanged.removeListener(h);
  }),
  source('bookmarks.onRemoved', 'bookmarks', false, (emit) => {
    const h = (id: string, info: chrome.bookmarks.BookmarkRemoveInfo) =>
      emit({ id, parentId: info.parentId, index: info.index });
    chrome.bookmarks.onRemoved.addListener(h);
    return () => chrome.bookmarks.onRemoved.removeListener(h);
  }),
  source('history.onVisited', 'history', false, (emit) => {
    const h = (item: chrome.history.HistoryItem) =>
      emit({ url: item.url, title: item.title, lastVisitTime: item.lastVisitTime });
    chrome.history.onVisited.addListener(h);
    return () => chrome.history.onVisited.removeListener(h);
  }),
  source('history.onVisitRemoved', 'history', false, (emit) => {
    const h = (removed: chrome.history.RemovedResult) =>
      emit({ allHistory: removed.allHistory, urls: removed.urls });
    chrome.history.onVisitRemoved.addListener(h);
    return () => chrome.history.onVisitRemoved.removeListener(h);
  }),
  source('downloads.onCreated', 'downloads', false, (emit) => {
    const h = (d: chrome.downloads.DownloadItem) =>
      emit({ downloadId: d.id, url: d.url, filename: d.filename, mime: d.mime });
    chrome.downloads.onCreated.addListener(h);
    return () => chrome.downloads.onCreated.removeListener(h);
  }),
  source('downloads.onChanged', 'downloads', false, (emit) => {
    const h = (delta: chrome.downloads.DownloadDelta) =>
      emit({ downloadId: delta.id, ...delta });
    chrome.downloads.onChanged.addListener(h);
    return () => chrome.downloads.onChanged.removeListener(h);
  }),
  source('downloads.onErased', 'downloads', false, (emit) => {
    const h = (id: number) => emit({ downloadId: id });
    chrome.downloads.onErased.addListener(h);
    return () => chrome.downloads.onErased.removeListener(h);
  }),
  source('windows.onCreated', null, false, (emit) => {
    const h = (w: chrome.windows.Window) =>
      emit({ windowId: w.id, type: w.type, incognito: w.incognito });
    chrome.windows.onCreated.addListener(h);
    return () => chrome.windows.onCreated.removeListener(h);
  }),
  source('windows.onRemoved', null, false, (emit) => {
    const h = (id: number) => emit({ windowId: id });
    chrome.windows.onRemoved.addListener(h);
    return () => chrome.windows.onRemoved.removeListener(h);
  }),
  source('windows.onFocusChanged', null, false, (emit) => {
    const h = (id: number) => emit({ windowId: id });
    chrome.windows.onFocusChanged.addListener(h);
    return () => chrome.windows.onFocusChanged.removeListener(h);
  }),
  source('webNavigation.onCompleted', 'webNavigation', false, (emit) => {
    const api = (chrome as unknown as { webNavigation?: chrome.webNavigation.WebNavigationEventFilter })
      .webNavigation as unknown as chrome.webNavigation.WebNavigationEvent<chrome.webNavigation.WebNavigationFramedCallbackDetails> | undefined;
    // Types are awkward here; fall through to the real API at runtime.
    const real = (chrome as unknown as { webNavigation?: { onCompleted: chrome.events.Event<(d: unknown) => void> } }).webNavigation;
    if (!real) return () => {};
    const h = (d: unknown) => {
      const details = d as { tabId?: number; url?: string; frameId?: number };
      if (details.frameId !== 0) return; // main frame only
      emit({ tabId: details.tabId, url: details.url });
    };
    real.onCompleted.addListener(h);
    void api;
    return () => real.onCompleted.removeListener(h);
  }),
  source('idle.onStateChanged', 'idle', false, (emit) => {
    const api = (chrome as unknown as { idle?: typeof chrome.idle }).idle;
    if (!api) return () => {};
    const h = (state: chrome.idle.IdleState) => emit({ state });
    api.onStateChanged.addListener(h);
    return () => api.onStateChanged.removeListener(h);
  }),
  source('readingList.onEntryAdded', 'readingList', false, (emit) => {
    const listener = readingListApi()?.onEntryAdded;
    if (!listener) return () => {};
    const h = (entry: ReadingListEntry) =>
      emit({ url: entry.url, title: entry.title, hasBeenRead: entry.hasBeenRead });
    listener.addListener(h);
    return () => listener.removeListener(h);
  }),
  source('readingList.onEntryUpdated', 'readingList', false, (emit) => {
    const listener = readingListApi()?.onEntryUpdated;
    if (!listener) return () => {};
    const h = (entry: ReadingListEntry) =>
      emit({ url: entry.url, title: entry.title, hasBeenRead: entry.hasBeenRead });
    listener.addListener(h);
    return () => listener.removeListener(h);
  }),
  source('readingList.onEntryRemoved', 'readingList', false, (emit) => {
    const listener = readingListApi()?.onEntryRemoved;
    if (!listener) return () => {};
    const h = (entry: ReadingListEntry) =>
      emit({ url: entry.url, title: entry.title });
    listener.addListener(h);
    return () => listener.removeListener(h);
  }),
  source('tabGroups.onCreated', null, false, (emit) => {
    const api = (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
    if (!api?.onCreated) return () => {};
    const h = (g: chrome.tabGroups.TabGroup) =>
      emit({ groupId: g.id, title: g.title, color: g.color, windowId: g.windowId });
    api.onCreated.addListener(h);
    return () => api.onCreated.removeListener(h);
  }),
  source('tabGroups.onUpdated', null, false, (emit) => {
    const api = (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
    if (!api?.onUpdated) return () => {};
    const h = (g: chrome.tabGroups.TabGroup) =>
      emit({ groupId: g.id, title: g.title, color: g.color, collapsed: g.collapsed });
    api.onUpdated.addListener(h);
    return () => api.onUpdated.removeListener(h);
  }),
  source('tabGroups.onRemoved', null, false, (emit) => {
    const api = (chrome as unknown as { tabGroups?: typeof chrome.tabGroups }).tabGroups;
    if (!api?.onRemoved) return () => {};
    const h = (g: chrome.tabGroups.TabGroup) => emit({ groupId: g.id });
    api.onRemoved.addListener(h);
    return () => api.onRemoved.removeListener(h);
  }),
];

export const ALL_SOURCES: EventSource[] = [...IMMEDIATE_SOURCES, ...QUEUED_SOURCES];
