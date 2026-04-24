import { tool } from 'ai';
import { z } from 'zod';

export const alarmClear = tool({
  description:
    "Clear a named alarm. Do NOT clear 'prompt-in-a-box-tick' — that's the agent's own scheduling alarm and removing it will stop the extension.",
  inputSchema: z.object({ name: z.string().min(1) }),
  execute: async ({ name }) => {
    const wasCleared = await chrome.alarms.clear(name);
    return { cleared: wasCleared };
  },
});
