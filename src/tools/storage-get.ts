import { tool } from 'ai';
import { z } from 'zod';

const STATE_PREFIX = 'state:';

export const storageGet = tool({
  description:
    'Read a named blob of state the prompt previously saved via storage_set. Returns the value or null.',
  inputSchema: z.object({ key: z.string().min(1) }),
  execute: async ({ key }) => {
    const full = STATE_PREFIX + key;
    const got = await chrome.storage.local.get(full);
    return got[full] ?? null;
  },
});
