import { tool } from 'ai';
import { z } from 'zod';

export const alarmList = tool({
  description: "List all Chrome alarms currently registered for this extension, including the agent's own scheduling alarm.",
  inputSchema: z.object({}),
  execute: async () => {
    const alarms = await chrome.alarms.getAll();
    return alarms.map((a) => ({
      name: a.name,
      scheduledTime: a.scheduledTime,
      periodInMinutes: a.periodInMinutes ?? null,
    }));
  },
});
