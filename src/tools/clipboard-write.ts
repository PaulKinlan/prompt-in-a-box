import { tool } from 'ai';
import { z } from 'zod';
import { sendToOffscreen } from '../offscreen-client';

export const clipboardWrite = tool({
  description:
    "Write text to the user's clipboard. Cap this at short snippets; anything over ~10KB is unusual and probably wrong.",
  inputSchema: z.object({
    text: z.string().max(100_000),
  }),
  execute: async ({ text }) => {
    await sendToOffscreen({
      target: 'offscreen',
      kind: 'clipboard-write-text',
      text,
    });
    return { ok: true, length: text.length };
  },
});
