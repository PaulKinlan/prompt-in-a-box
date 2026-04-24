import { tool } from 'ai';
import { z } from 'zod';
import { createArtifact } from '../artifacts';

/**
 * Create an artifact — a user-facing output the agent wants to surface
 * in the popup and artifacts browser. Use this instead of `opfs_write`
 * when the thing you're writing is meant for the human to read, view,
 * or browse.
 *
 * Good uses: summaries, digests, journal entries, meeting notes,
 * screenshots, extracted quotes, translations, reports.
 *
 * Keep using `opfs_write` / `storage_set` for internal state: cursors,
 * dedup keys, event logs, snapshots, settings the user never needs to
 * look at directly.
 */
export const artifactCreate = tool({
  description:
    "Save a user-facing output (an 'artifact') so it appears in the popup and artifacts browser. " +
    "Use for anything the human will want to read, view, or browse later. " +
    "For internal state (cursors, dedup keys, raw logs), use opfs_write / storage_set instead. " +
    "Images must be passed as base64 without the `data:` prefix.",
  inputSchema: z.object({
    kind: z
      .enum(['markdown', 'html', 'json', 'text', 'image-png', 'image-jpeg'])
      .describe("Content kind. Affects how the artifact is rendered in the browser."),
    title: z
      .string()
      .min(1)
      .max(200)
      .describe("Short, human-readable title. Shown in the list view."),
    content: z
      .string()
      .min(1)
      .describe(
        "Text content for text kinds; base64 (no data: URI prefix) for image kinds.",
      ),
    tags: z
      .array(z.string())
      .optional()
      .describe("Optional tags for filtering (e.g. ['summary', 'arxiv'])."),
    sourceUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional URL this artifact was derived from (the original page, event URL, etc.).",
      ),
  }),
  execute: async ({ kind, title, content, tags, sourceUrl }) => {
    try {
      const entry = await createArtifact({ kind, title, content, tags, sourceUrl });
      return {
        ok: true as const,
        artifactId: entry.artifactId,
        path: entry.path,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
