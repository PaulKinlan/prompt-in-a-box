import { tool } from 'ai';
import { z } from 'zod';

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
    return { ok: true };
  },
});
