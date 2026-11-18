import { tool } from 'ai';
import { z } from 'zod';
import { markAgentDownloadMutation } from '../events/mutation-guard';

export const downloadFile = tool({
  description:
    "Start a download of a URL. Optionally pin a filename (relative to the user's download directory) and a conflict strategy. Returns the new downloadId once Chrome accepts the request.",
  inputSchema: z.object({
    url: z.string().url(),
    filename: z
      .string()
      .optional()
      .describe('Suggested filename, relative to the downloads root. Cannot contain ".." segments.'),
    conflictAction: z.enum(['uniquify', 'overwrite', 'prompt']).optional(),
    saveAs: z.boolean().optional().describe('If true, prompt the user for a save location.'),
  }),
  execute: async ({ url, filename, conflictAction, saveAs }) => {
    markAgentDownloadMutation([], { urls: [url] });

    try {
      const id = await chrome.downloads.download({
        url,
        filename,
        conflictAction,
        saveAs,
      });
      markAgentDownloadMutation([id], { urls: [url] });
      return { ok: true, downloadId: id };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});
