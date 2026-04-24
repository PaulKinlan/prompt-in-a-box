import { tool } from 'ai';
import { z } from 'zod';

export const tabGroup = tool({
  description:
    'Group tabs together. Pass `groupId` to add to an existing group, or omit and provide `title`/`color` to create a new group. Pass an empty tabIds with existing groupId to update the group\'s title/color.',
  inputSchema: z.object({
    tabIds: z.array(z.number()).describe('Tab ids to add to the group.'),
    groupId: z.number().optional().describe('Existing group id. Omit to create a new one.'),
    title: z.string().optional(),
    color: z
      .enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'])
      .optional(),
  }),
  execute: async ({ tabIds, groupId, title, color }) => {
    let finalGroupId = groupId;
    if (tabIds.length > 0) {
      finalGroupId = await chrome.tabs.group({ tabIds, groupId });
    }
    if (finalGroupId !== undefined && (title !== undefined || color !== undefined)) {
      await chrome.tabGroups.update(finalGroupId, { title, color });
    }
    return { groupId: finalGroupId };
  },
});
