import { tool } from 'ai';
import { z } from 'zod';

export const tabList = tool({
  description:
    'List the user\'s open browser tabs across windows. Enriched with domain, protocol, canScript, discarded, and group metadata. Optionally filter by query, windowId, currentWindow, or ungroupedOnly.',
  inputSchema: z.object({
    query: z.string().optional().describe('Substring to filter tabs by title or URL (case-insensitive).'),
    windowId: z.number().optional().describe('Filter tabs to a specific window ID.'),
    currentWindow: z.boolean().optional().describe('If true, only list tabs in the currently focused window.'),
    ungroupedOnly: z.boolean().optional().describe('If true, only return tabs that do not belong to any tab group.'),
    includePinned: z.boolean().optional().describe('Whether to include pinned tabs (default true).'),
  }),
  execute: async ({ query, windowId, currentWindow, ungroupedOnly, includePinned }) => {
    const queryInfo: chrome.tabs.QueryInfo = {};
    if (windowId !== undefined) queryInfo.windowId = windowId;
    if (currentWindow) queryInfo.currentWindow = true;

    const tabs = await chrome.tabs.query(queryInfo);
    let rows = tabs.map((t) => {
      const urlStr = t.url || t.pendingUrl || '';
      let domain = '';
      let protocol = '';
      let canScript = false;

      if (urlStr) {
        try {
          const parsed = new URL(urlStr);
          protocol = parsed.protocol;
          domain = parsed.hostname.toLowerCase().replace(/^www\./i, '');
          const isWeb = protocol === 'http:' || protocol === 'https:';
          const isWebStore = domain.includes('chromewebstore') || urlStr.includes('chrome.google.com/webstore');
          canScript = isWeb && !isWebStore && !t.discarded;
        } catch {
          // ignore invalid url
        }
      }

      return {
        id: t.id,
        tabId: t.id,
        title: t.title ?? '',
        url: urlStr,
        domain,
        protocol,
        canScript,
        active: t.active ?? false,
        pinned: t.pinned ?? false,
        discarded: t.discarded ?? false,
        audible: t.audible ?? false,
        status: t.status ?? 'complete',
        groupId: t.groupId ?? -1,
        index: t.index,
        windowId: t.windowId,
        incognito: t.incognito,
        lastAccessed: t.lastAccessed ?? null,
      };
    });

    if (includePinned === false) {
      rows = rows.filter((r) => !r.pinned);
    }

    if (ungroupedOnly) {
      rows = rows.filter((r) => r.groupId === -1 || r.groupId === undefined);
    }

    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q) ||
          r.domain.toLowerCase().includes(q),
      );
    }

    return rows;
  },
});
