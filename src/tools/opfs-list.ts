import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../storage/opfs';

export const opfsList = tool({
  description:
    'List entries in a directory in the extension\'s sandboxed file system (OPFS). Use an empty path to list the root.',
  inputSchema: z.object({ path: z.string().optional() }),
  execute: async ({ path }) => {
    try {
      return { ok: true as const, entries: await opfs.list(path ?? '') };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
