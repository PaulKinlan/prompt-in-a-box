import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

export const bookmarkRemove = tool({
  description:
    'Delete a bookmark or folder by id. Set recursive=true to delete non-empty folders.',
  inputSchema: z.object({
    id: z.string().min(1),
    recursive: z.boolean().optional(),
  }),
  execute: async ({ id, recursive }) => {
    const removedNodes: Array<{ parentId?: string; index?: number; title: string; url?: string }> = [];

    try {
      const nodes = await chrome.bookmarks.get(id);
      for (const n of nodes) {
        removedNodes.push({
          parentId: n.parentId,
          index: n.index,
          title: n.title,
          url: n.url,
        });
      }
    } catch {
      // Ignore
    }

    if (recursive) {
      await chrome.bookmarks.removeTree(id);
    } else {
      await chrome.bookmarks.remove(id);
    }

    if (removedNodes.length > 0) {
      await recordAction({
        toolName: 'bookmark_remove',
        label: `Removed bookmark "${removedNodes[0].title}"`,
        detail: removedNodes[0].url || `Folder ID: ${id}`,
        undo: {
          kind: 'bookmark_remove',
          removedNodes,
        },
      });
    }

    return { ok: true };
  },
});
