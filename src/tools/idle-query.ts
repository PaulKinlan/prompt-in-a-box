import { tool } from 'ai';
import { z } from 'zod';

export const idleQuery = tool({
  description:
    'Query whether the user/system is currently "active", "idle", or "locked". Use this when Wait for Idle is enabled before performing background tab organization.',
  inputSchema: z.object({
    detectionIntervalInSeconds: z
      .number()
      .int()
      .min(15)
      .max(3600)
      .optional()
      .describe('Idle threshold in seconds (minimum 15, default 60).'),
  }),
  execute: async ({ detectionIntervalInSeconds }) => {
    const interval = Math.max(15, detectionIntervalInSeconds ?? 60);
    const state = await new Promise<chrome.idle.IdleState>((resolve) => {
      chrome.idle.queryState(interval, (s) => resolve(s));
    });
    return { state, detectionIntervalInSeconds: interval };
  },
});
