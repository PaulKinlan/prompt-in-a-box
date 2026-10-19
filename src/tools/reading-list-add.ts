import { tool } from 'ai';
import { z } from 'zod';
import { recordAction } from '../action-history';

// chrome.readingList isn't in @types/chrome yet. Duck-type the bits we use.
interface ReadingListApi {
  addEntry(entry: { url: string; title: string; hasBeenRead: boolean }): Promise<void>;
}
function api(): ReadingListApi {
  return (chrome as unknown as { readingList: ReadingListApi }).readingList;
}

export const readingListAdd = tool({
  description:
    "Add a URL to the user's reading list. Optionally mark it as already read.",
  inputSchema: z.object({
    url: z.string().url(),
    title: z.string().min(1),
    hasBeenRead: z.boolean().optional(),
  }),
  execute: async ({ url, title, hasBeenRead }) => {
    await api().addEntry({ url, title, hasBeenRead: hasBeenRead ?? false });

    await recordAction({
      toolName: 'reading_list_add',
      label: `Added to reading list: "${title}"`,
      detail: url,
      undo: {
        kind: 'reading_list_add',
        url,
      },
    });

    return { ok: true };
  },
});
