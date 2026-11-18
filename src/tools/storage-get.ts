import { tool } from 'ai';
import { z } from 'zod';
import { readStateValue } from '../storage/state-keys';

export const storageGet = tool({
  description:
    'Read a named blob of state the prompt previously saved via storage_set. If key is omitted, defaults to "default". Returns the value or null.',
  inputSchema: z.object({
    key: z.string().optional().describe('State key name. Defaults to "default".'),
  }),
  execute: async ({ key }) => {
    return await readStateValue(key);
  },
});
