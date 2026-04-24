import { tool } from 'ai';
import { z } from 'zod';

export const bookmarkList = tool({
  description:
    'List children of a bookmark folder. Omit parentId to start at the root. Returns an array of nodes; folders have no url.',
  inputSchema: z.object({
    parentId: z.string().optional().describe('Bookmark node id. Omit to list root.'),
  }),
  execute: async ({ parentId }) => {
    const children = await chrome.bookmarks.getChildren(parentId ?? '0');
    return children.map((n) => ({
      id: n.id,
      title: n.title,
      url: n.url ?? null,
      isFolder: !n.url,
      dateAdded: n.dateAdded ?? null,
    }));
  },
});
