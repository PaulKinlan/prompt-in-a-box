/**
 * Self-Mutation Event Guard
 *
 * Tracks recent browser state mutations initiated by the agent (tabs, tab groups,
 * bookmarks, downloads, windows, and target URLs) with short TTLs so Chrome events
 * caused by the agent's own tool calls can be recognized and suppressed before
 * triggering feedback loops.
 */

export const DEFAULT_MUTATION_TTL_MS = 5000;

const mutatedTabs = new Map<number, number>();
const mutatedTabUrls = new Map<string, number>();
const mutatedGroups = new Map<number, number>();
const mutatedBookmarks = new Map<string, number>();
const mutatedBookmarkUrls = new Map<string, number>();
const mutatedDownloads = new Map<number, number>();
const mutatedDownloadUrls = new Map<string, number>();
const mutatedWindows = new Map<number, number>();

function pruneExpired<K>(map: Map<K, number>, now: number): void {
  for (const [key, expiresAt] of map) {
    if (expiresAt <= now) {
      map.delete(key);
    }
  }
}

function recordEntries<K>(map: Map<K, number>, keys: Iterable<K>, ttlMs: number): void {
  const now = Date.now();
  pruneExpired(map, now);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
  const expiresAt = now + ttlMs;
  for (const key of keys) {
    const prev = map.get(key);
    if (prev === undefined || expiresAt > prev) {
      map.set(key, expiresAt);
    }
  }
}

function hasActiveEntry<K>(map: Map<K, number>, key: K): boolean {
  const now = Date.now();
  pruneExpired(map, now);
  const expiresAt = map.get(key);
  return expiresAt !== undefined && expiresAt > now;
}

function normalizeUrlForGuard(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).href;
  } catch {
    return trimmed;
  }
}

function toFiniteIds(input: number | number[]): number[] {
  const arr = Array.isArray(input) ? input : [input];
  return arr.filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id >= 0);
}

function toStringIds(input: string | string[]): string[] {
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean);
}

function toNormalizedUrls(urls?: string[]): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    const norm = normalizeUrlForGuard(u);
    if (norm) out.push(norm);
  }
  return out;
}

export function markAgentTabMutation(
  tabIds: number | number[],
  opts?: { urls?: string[]; ttlMs?: number },
): void {
  const ttl = opts?.ttlMs ?? DEFAULT_MUTATION_TTL_MS;
  const ids = toFiniteIds(tabIds);
  const urls = toNormalizedUrls(opts?.urls);
  recordEntries(mutatedTabs, ids, ttl);
  if (urls.length > 0) {
    recordEntries(mutatedTabUrls, urls, ttl);
  }
}

export function markAgentGroupMutation(
  groupIds: number | number[],
  ttlMs: number = DEFAULT_MUTATION_TTL_MS,
): void {
  const ids = toFiniteIds(groupIds);
  recordEntries(mutatedGroups, ids, ttlMs);
}

export function markAgentBookmarkMutation(
  ids: string | string[],
  opts?: { urls?: string[]; ttlMs?: number },
): void {
  const ttl = opts?.ttlMs ?? DEFAULT_MUTATION_TTL_MS;
  const cleanIds = toStringIds(ids);
  const urls = toNormalizedUrls(opts?.urls);
  recordEntries(mutatedBookmarks, cleanIds, ttl);
  if (urls.length > 0) {
    recordEntries(mutatedBookmarkUrls, urls, ttl);
  }
}

export function markAgentDownloadMutation(
  ids: number | number[],
  opts?: { urls?: string[]; ttlMs?: number },
): void {
  const ttl = opts?.ttlMs ?? DEFAULT_MUTATION_TTL_MS;
  const cleanIds = toFiniteIds(ids);
  const urls = toNormalizedUrls(opts?.urls);
  recordEntries(mutatedDownloads, cleanIds, ttl);
  if (urls.length > 0) {
    recordEntries(mutatedDownloadUrls, urls, ttl);
  }
}

export function markAgentWindowMutation(
  windowIds: number | number[],
  ttlMs: number = DEFAULT_MUTATION_TTL_MS,
): void {
  const ids = toFiniteIds(windowIds);
  recordEntries(mutatedWindows, ids, ttlMs);
}

export function clearMutationGuards(): void {
  mutatedTabs.clear();
  mutatedTabUrls.clear();
  mutatedGroups.clear();
  mutatedBookmarks.clear();
  mutatedBookmarkUrls.clear();
  mutatedDownloads.clear();
  mutatedDownloadUrls.clear();
  mutatedWindows.clear();
}

const READ_ONLY_BROWSER_TOOLS = new Set([
  'tab_list',
  'tab_read',
  'tab_screenshot',
  'tab_group_list',
  'window_list',
  'bookmark_list',
  'bookmark_search',
  'download_list',
]);

const URL_MUTATING_TAB_TOOLS = new Set([
  'tab_open',
  'tab_navigate',
  'tab_duplicate',
  'window_create',
]);

function normalizeToolNameForGuard(toolName: string): string {
  const stripped = toolName.replace(/^code_mode:/, '').trim();
  return stripped.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).toLowerCase();
}

function collectNumber(val: unknown, target: Set<number>): void {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
    target.add(val);
  }
}

function collectNumbersFromArray(val: unknown, target: Set<number>): void {
  if (!Array.isArray(val)) return;
  for (const item of val) {
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) {
      target.add(item);
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      collectNumber(obj.tabId, target);
      collectNumber(obj.id, target);
    }
  }
}

function collectUrls(val: unknown, target: Set<string>): void {
  if (typeof val === 'string' && val.trim().length > 0) {
    target.add(val.trim());
  } else if (Array.isArray(val)) {
    for (const item of val) {
      if (typeof item === 'string' && item.trim().length > 0) {
        target.add(item.trim());
      }
    }
  }
}

/**
 * Inspects mutating tool calls (`tab_*`, `window_*`, `bookmark_*`, `download_*`)
 * and extracts IDs and URLs from `args` and `result` (including arrays of results)
 * to automatically mark agent-originated browser mutations.
 */
export function recordToolMutationFromCall(
  toolName: string,
  args: unknown,
  result?: unknown,
): void {
  const name = normalizeToolNameForGuard(toolName);
  if (!name || READ_ONLY_BROWSER_TOOLS.has(name)) return;

  const isTabTool = name.startsWith('tab_');
  const isWindowTool = name.startsWith('window_');
  const isBookmarkTool = name.startsWith('bookmark_');
  const isDownloadTool = name.startsWith('download_');

  if (!isTabTool && !isWindowTool && !isBookmarkTool && !isDownloadTool) {
    return;
  }

  const tabIds = new Set<number>();
  const groupIds = new Set<number>();
  const windowIds = new Set<number>();
  const downloadIds = new Set<number>();
  const bookmarkIds = new Set<string>();
  const urls = new Set<string>();

  const isTabGroupTool = name === 'tab_group';

  const inspectValue = (val: unknown): void => {
    if (val === null || val === undefined) return;

    if (typeof val === 'number') {
      if (isTabTool && !isTabGroupTool) collectNumber(val, tabIds);
      else if (isWindowTool) collectNumber(val, windowIds);
      else if (isDownloadTool) collectNumber(val, downloadIds);
      return;
    }

    if (typeof val === 'string') {
      if (isBookmarkTool && val.trim()) bookmarkIds.add(val.trim());
      return;
    }

    if (Array.isArray(val)) {
      for (const item of val) {
        inspectValue(item);
      }
      return;
    }

    if (typeof val !== 'object') return;
    const obj = val as Record<string, unknown>;

    // Explicit typed keys across all tools
    collectNumber(obj.tabId, tabIds);
    collectNumber(obj.createdTabId, tabIds);
    collectNumber(obj.duplicatedTabId, tabIds);
    collectNumbersFromArray(obj.tabIds, tabIds);
    collectNumbersFromArray(obj.ungroupedTabIds, tabIds);
    collectNumbersFromArray(obj.tabs, tabIds);

    collectNumber(obj.groupId, groupIds);
    collectNumbersFromArray(obj.groupIds, groupIds);

    collectNumber(obj.windowId, windowIds);
    collectNumber(obj.createdWindowId, windowIds);
    collectNumbersFromArray(obj.windowIds, windowIds);

    collectNumber(obj.downloadId, downloadIds);
    collectNumbersFromArray(obj.downloadIds, downloadIds);

    if (typeof obj.bookmarkId === 'string' && obj.bookmarkId.trim()) {
      bookmarkIds.add(obj.bookmarkId.trim());
    }
    if (typeof obj.createdBookmarkId === 'string' && obj.createdBookmarkId.trim()) {
      bookmarkIds.add(obj.createdBookmarkId.trim());
    }

    // Disambiguate generic `id` / `ids` by tool domain
    if (isTabGroupTool) {
      collectNumber(obj.id, groupIds);
      collectNumbersFromArray(obj.ids, tabIds);
      if (Array.isArray(obj.groups)) {
        for (const g of obj.groups) {
          inspectValue(g);
        }
      }
    } else if (isTabTool) {
      collectNumber(obj.id, tabIds);
      collectNumbersFromArray(obj.ids, tabIds);
    } else if (isWindowTool) {
      collectNumber(obj.id, windowIds);
      collectNumbersFromArray(obj.ids, windowIds);
    } else if (isBookmarkTool) {
      if (typeof obj.id === 'string' && obj.id.trim()) {
        bookmarkIds.add(obj.id.trim());
      } else if (typeof obj.id === 'number' && Number.isFinite(obj.id)) {
        bookmarkIds.add(String(obj.id));
      }
      if (Array.isArray(obj.ids)) {
        for (const item of obj.ids) {
          if (typeof item === 'string' && item.trim()) bookmarkIds.add(item.trim());
        }
      }
    } else if (isDownloadTool) {
      collectNumber(obj.id, downloadIds);
      collectNumbersFromArray(obj.ids, downloadIds);
    }

    collectUrls(obj.url, urls);
    collectUrls(obj.urls, urls);
  };

  inspectValue(args);
  inspectValue(result);

  const urlList = Array.from(urls);

  if (tabIds.size > 0 || (URL_MUTATING_TAB_TOOLS.has(name) && urlList.length > 0)) {
    markAgentTabMutation(
      Array.from(tabIds),
      URL_MUTATING_TAB_TOOLS.has(name) && urlList.length > 0 ? { urls: urlList } : undefined,
    );
  }

  if (groupIds.size > 0) {
    markAgentGroupMutation(Array.from(groupIds));
  }

  if (windowIds.size > 0) {
    markAgentWindowMutation(Array.from(windowIds));
  }

  if (isBookmarkTool && (bookmarkIds.size > 0 || (name === 'bookmark_add' && urlList.length > 0))) {
    markAgentBookmarkMutation(
      Array.from(bookmarkIds),
      name === 'bookmark_add' && urlList.length > 0 ? { urls: urlList } : undefined,
    );
  }

  if (isDownloadTool && (downloadIds.size > 0 || urlList.length > 0)) {
    markAgentDownloadMutation(
      Array.from(downloadIds),
      urlList.length > 0 ? { urls: urlList } : undefined,
    );
  }
}

function extractPayloadUrl(p: Record<string, unknown>): string {
  if (typeof p.url === 'string') {
    return normalizeUrlForGuard(p.url);
  }
  if (p.url && typeof p.url === 'object') {
    const curr = (p.url as Record<string, unknown>).current;
    if (typeof curr === 'string') {
      return normalizeUrlForGuard(curr);
    }
  }
  return '';
}

/**
 * Determines whether a Chrome event payload originated from a recent agent tool mutation.
 */
export function isSelfOriginatedEvent(source: string, payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;

  switch (source) {
    case 'tabs.onCreated':
    case 'tabs.onUpdated':
    case 'webNavigation.onCompleted': {
      const tabId = typeof p.tabId === 'number' ? p.tabId : typeof p.id === 'number' ? p.id : undefined;
      if (tabId !== undefined && hasActiveEntry(mutatedTabs, tabId)) {
        return true;
      }
      const normUrl = extractPayloadUrl(p);
      if (normUrl && hasActiveEntry(mutatedTabUrls, normUrl)) {
        return true;
      }
      return false;
    }

    case 'tabs.onRemoved':
    case 'tabs.onActivated': {
      const tabId = typeof p.tabId === 'number' ? p.tabId : typeof p.id === 'number' ? p.id : undefined;
      return tabId !== undefined && hasActiveEntry(mutatedTabs, tabId);
    }

    case 'tabGroups.onCreated':
    case 'tabGroups.onUpdated':
    case 'tabGroups.onRemoved': {
      const groupId =
        typeof p.groupId === 'number' ? p.groupId : typeof p.id === 'number' ? p.id : undefined;
      return groupId !== undefined && hasActiveEntry(mutatedGroups, groupId);
    }

    case 'bookmarks.onCreated':
    case 'bookmarks.onChanged':
    case 'bookmarks.onRemoved': {
      const id =
        typeof p.id === 'string'
          ? p.id.trim()
          : typeof p.id === 'number'
            ? String(p.id)
            : '';
      if (id && hasActiveEntry(mutatedBookmarks, id)) {
        return true;
      }
      const normUrl = extractPayloadUrl(p);
      if (normUrl && hasActiveEntry(mutatedBookmarkUrls, normUrl)) {
        return true;
      }
      return false;
    }

    case 'downloads.onCreated':
    case 'downloads.onChanged':
    case 'downloads.onErased': {
      const downloadId =
        typeof p.downloadId === 'number'
          ? p.downloadId
          : typeof p.id === 'number'
            ? p.id
            : undefined;
      if (downloadId !== undefined && hasActiveEntry(mutatedDownloads, downloadId)) {
        return true;
      }
      const normUrl = extractPayloadUrl(p);
      if (normUrl && hasActiveEntry(mutatedDownloadUrls, normUrl)) {
        return true;
      }
      return false;
    }

    case 'windows.onCreated':
    case 'windows.onRemoved':
    case 'windows.onFocusChanged': {
      const windowId =
        typeof p.windowId === 'number'
          ? p.windowId
          : typeof p.id === 'number'
            ? p.id
            : undefined;
      return windowId !== undefined && hasActiveEntry(mutatedWindows, windowId);
    }

    case 'history.onVisited': {
      const normUrl = extractPayloadUrl(p);
      return Boolean(normUrl && hasActiveEntry(mutatedTabUrls, normUrl));
    }

    default:
      return false;
  }
}

/**
 * Recognizes Chrome runtime errors indicating that a target tab, group, window,
 * or bookmark was already closed/removed prior to or during tool execution.
 */
export function isMissingResourceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /no tab with id|no group with id|no tab group with id|no window with id|can't find bookmark|cannot find bookmark|can't find parent bookmark|not found/i.test(
    msg,
  );
}
