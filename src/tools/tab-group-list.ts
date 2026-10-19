import { tool } from 'ai';
import { z } from 'zod';

export const tabGroupList = tool({
  description:
    'List all current browser tab groups across windows, including their groupId, title, color, collapsed state, and windowId.',
  inputSchema: z.object({
    windowId: z.number().optional().describe('Optional windowId filter.'),
  }),
  execute: async ({ windowId }) => {
    const query: chrome.tabGroups.QueryInfo = {};
    if (windowId !== undefined) query.windowId = windowId;
    const groups = await chrome.tabGroups.query(query);
    return groups.map((g) => ({
      id: g.id,
      groupId: g.id,
      title: g.title ?? '',
      color: g.color,
      collapsed: g.collapsed,
      windowId: g.windowId,
    }));
  },
});
