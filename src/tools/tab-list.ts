import { tool } from 'ai';
import { z } from 'zod';

export const tabList = tool({
  description:
    'List the user\'s open browser tabs across all windows. Optionally filter by a substring that matches title or URL (case-insensitive).',
  inputSchema: z.object({
    query: z.string().optional().describe('Substring to filter tabs by title or URL'),
  }),
  execute: async ({ query }) => {
    const tabs = await chrome.tabs.query({});
    let rows = tabs.map((t) => ({
      tabId: t.id,
      title: t.title ?? '',
      url: t.url ?? '',
      active: t.active ?? false,
      pinned: t.pinned ?? false,
      windowId: t.windowId,
      incognito: t.incognito,
      lastAccessed: t.lastAccessed ?? null,
    }));
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q));
    }
    return rows;
  },
});
