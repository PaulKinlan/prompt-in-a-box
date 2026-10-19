import { tool } from 'ai';
import { z } from 'zod';

const STATE_PREFIX = 'state:';

export const storageGet = tool({
  description:
    'Read a named blob of state the prompt previously saved via storage_set. If key is omitted, defaults to "default". Returns the value or null.',
  inputSchema: z.object({
    key: z.string().optional().describe('State key name. Defaults to "default".'),
  }),
  execute: async ({ key }) => {
    const k = key && key.trim() ? key.trim() : 'default';
    const full = STATE_PREFIX + k;
    const got = await chrome.storage.local.get(full);
    return got[full] ?? null;
  },
});
