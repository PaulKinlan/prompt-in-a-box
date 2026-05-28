import { tool } from 'ai';
import { z } from 'zod';

const DYNAMIC_UI_KEY = '__pib_dynamic_ui';

export const uiUpdate = tool({
  description:
    'Update the dynamic, declarative UI specification displayed in the popup or side panel. This enables the agent to completely redesign the runtime UI view dynamically.',
  inputSchema: z.object({
    title: z.string().describe('The title of the UI view displayed at the top of the popup or sidepanel.'),
    theme: z.enum(['default', 'glassmorphic', 'compact']).default('default').describe('Visual theme styling to apply.'),
    components: z.array(
      z.object({
        type: z.enum(['header', 'text', 'button', 'alert', 'list', 'input']),
        id: z.string().optional().describe('Unique identifier for interactive elements. Crucial for catching interaction event click callbacks.'),
        text: z.string().optional().describe('Text content of the element (headers, text, button labels, or alert texts).'),
        intent: z.enum(['info', 'success', 'warning', 'danger']).optional().describe('Styling intent for alerts or buttons.'),
        action: z.enum(['trigger-run', 'chrome-api', 'none']).optional().describe('Behavior on click: "trigger-run" alerts the agent loop, "chrome-api" directly runs a client-side Chrome API, "none" is static.'),
        apiMethod: z.string().optional().describe('The chrome API method name if action is chrome-api (e.g. "tabs.create" or "tabs.remove").'),
        apiArgs: z.array(z.any()).optional().describe('The arguments to pass to the chrome API method (e.g., [{ "url": "https://google.com" }]).'),
        placeholder: z.string().optional().describe('Placeholder text for input components.'),
        items: z.array(z.string()).optional().describe('Array of items to display when type is "list".'),
        payload: z.any().optional().describe('Custom state or data payload to pass back to the agent on interaction click events.')
      })
    ).describe('List of interface components to lay out sequentially.')
  }),
  execute: async (schema) => {
    await chrome.storage.local.set({ [DYNAMIC_UI_KEY]: schema });
    // Attempt to broadcast to open popup or sidepanel views in real-time
    try {
      chrome.runtime.sendMessage({ type: 'ui-state-updated', ui: schema }).catch(() => {});
    } catch (_) {
      // Ignored if no views are actively listening
    }
    return { ok: true, message: 'UI updated successfully.' };
  },
});
