import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';
import { isMissingResourceError, markAgentBookmarkMutation } from '../events/mutation-guard';

function collectSubtreeIds(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  ids: Set<string>,
  urls: Set<string>,
): void {
  for (const node of nodes) {
    if (node.id) ids.add(node.id);
    if (node.url) urls.add(node.url);
    if (Array.isArray(node.children)) {
      collectSubtreeIds(node.children, ids, urls);
    }
  }
}

export const bookmarkRemove = tool({
  description:
    'Delete a bookmark or folder by id. Set recursive=true to delete non-empty folders.',
  inputSchema: z.object({
    id: z.string().min(1),
    recursive: z.boolean().optional(),
  }),
  execute: async ({ id, recursive }) => {
    const removedNodes: Array<{ parentId?: string; index?: number; title: string; url?: string }> = [];
    const idsToMark = new Set<string>([id]);
    const urlsToMark = new Set<string>();

    try {
      const nodes = await chrome.bookmarks.get(id);
      if (!nodes || nodes.length === 0) {
        return { ok: false, missing: true, id, error: `Can't find bookmark for id: ${id}` };
      }
      for (const n of nodes) {
        idsToMark.add(n.id);
        if (n.url) urlsToMark.add(n.url);
        removedNodes.push({
          parentId: n.parentId,
          index: n.index,
          title: n.title,
          url: n.url,
        });
      }
      if (recursive && typeof chrome.bookmarks.getSubTree === 'function') {
        try {
          const tree = await chrome.bookmarks.getSubTree(id);
          collectSubtreeIds(tree, idsToMark, urlsToMark);
        } catch {
          // Ignore subtree lookup errors
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, id, error: msg };
      }
      return { ok: false, id, error: msg };
    }

    markAgentBookmarkMutation(
      Array.from(idsToMark),
      urlsToMark.size > 0 ? { urls: Array.from(urlsToMark) } : undefined,
    );

    try {
      if (recursive) {
        await chrome.bookmarks.removeTree(id);
      } else {
        await chrome.bookmarks.remove(id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMissingResourceError(err)) {
        return { ok: false, missing: true, id, error: msg };
      }
      return { ok: false, id, error: msg };
    }

    markAgentBookmarkMutation(Array.from(idsToMark));

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

    return { ok: true, id };
  },
});
