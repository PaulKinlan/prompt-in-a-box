import { tool } from 'ai';
import { z } from 'zod';

const DYNAMIC_UI_KEY = '__pib_dynamic_ui';

export const uiUpdate = tool({
  description:
    'Update the dynamic, declarative UI specification displayed in the popup or side panel. This enables the agent to completely redesign the runtime UI view dynamically with rich interactive components, themes, and layout modes.',
  inputSchema: z.object({
    title: z.string().describe('The title of the UI view displayed at the top of the popup or sidepanel.'),
    theme: z
      .enum(['default', 'glassmorphic', 'compact', 'neon-dark', 'warm-editorial'])
      .default('default')
      .describe('Visual theme styling to apply.'),
    layoutMode: z
      .enum(['stack', 'bento-grid', 'two-column', 'tabbed', 'chat-first', 'compact-feed'])
      .default('stack')
      .describe('Layout presentation mode (e.g. stack, 2-column bento-grid, tabbed sections, or chat-first).'),
    themeConfig: z
      .object({
        accentColor: z.string().optional().describe('CSS accent color (e.g. #6366f1).'),
        backgroundGradient: z.string().optional().describe('Custom CSS background gradient.'),
        cardOpacity: z.number().optional().describe('Card opacity 0.0 - 1.0.'),
        blurPx: z.number().optional().describe('Backdrop blur in px for glassmorphic theme.'),
        borderRadiusPx: z.number().optional().describe('Border radius in px.'),
        textColor: z.string().optional().describe('Main text color.'),
        customCss: z.string().optional().describe('Scoped custom CSS rules to inject.'),
      })
      .optional()
      .describe('Optional custom theme styling tokens.'),
    components: z.array(
      z.object({
        type: z
          .enum([
            'header',
            'text',
            'button',
            'alert',
            'toast',
            'list',
            'input',
            'textarea',
            'password',
            'select',
            'radio',
            'checkbox',
            'switch',
            'toggle',
            'date-time',
            'file',
            'slider',
            'metrics',
            'table',
            'key-value',
            'progress',
            'task-list',
            'chat',
            'summary',
            'card',
            'cards',
            'carousel',
            'dialog',
            'menu',
            'icon',
            'image',
            'action-list',
            'action-history',
            'divider',
          ])
          .describe('Component type to render.'),
        id: z.string().optional().describe('Unique identifier for interactive elements. Crucial for catching interaction event click/change callbacks.'),
        storageKey: z.string().optional().describe('Optional key in chrome.storage.local to automatically bind and hydrate dynamic data from.'),
        dataKey: z.string().optional().describe('Alias for storageKey for dynamic data binding.'),
        text: z.string().optional().describe('Text content of the element (headers, text, button labels, or alert texts).'),
        subtitle: z.string().optional().describe('Secondary subtitle or explanatory text.'),
        intent: z.enum(['info', 'success', 'warning', 'danger']).optional().describe('Styling intent for alerts or buttons.'),
        span: z.number().optional().describe('Grid column span in bento-grid layout (1 or 2).'),
        action: z
          .enum(['trigger-run', 'chrome-api', 'undo-last', 'undo-action', 'open-studio', 'chat-message', 'none'])
          .optional()
          .describe('Behavior on click: "trigger-run" alerts the agent loop, "chrome-api" runs a client-side Chrome API, "undo-last" reverts recent action, "open-studio" opens Studio, "chat-message" sends a message to the agent.'),
        actionId: z.string().optional().describe('The action ID to revert when action is "undo-action".'),
        apiMethod: z.string().optional().describe('The chrome API method name if action is chrome-api (e.g. "tabs.create" or "tabs.remove").'),
        apiArgs: z.array(z.string()).optional().describe('The arguments to pass to the chrome API method.'),
        placeholder: z.string().optional().describe('Placeholder text for inputs, textareas, selects, or chat box.'),
        value: z.any().optional().describe('Default or current value of the input/control.'),
        checked: z.boolean().optional().describe('Checked state for checkbox, switch, or toggle.'),
        options: z
          .array(
            z.union([
              z.string(),
              z.object({
                label: z.string(),
                value: z.string(),
                badge: z.string().optional(),
                description: z.string().optional(),
              }),
            ])
          )
          .optional()
          .describe('Options array for select, radio, or multi-checkbox components.'),
        variant: z.string().optional().describe('Visual variant (e.g. "segmented" for radio).'),
        rows: z.number().optional().describe('Visible rows for textarea.'),
        min: z.union([z.number(), z.string()]).optional().describe('Minimum value for slider or date-time.'),
        max: z.union([z.number(), z.string()]).optional().describe('Maximum value for slider or date-time.'),
        step: z.number().optional().describe('Step value for slider.'),
        unit: z.string().optional().describe('Display unit for slider (e.g. "%" or "tabs").'),
        mode: z.enum(['date', 'time', 'datetime-local']).optional().describe('Mode for date-time input.'),
        accept: z.string().optional().describe('MIME types accepted for file input.'),
        multiple: z.boolean().optional().describe('Allow multiple selection for select or file inputs.'),
        triggerOnChange: z.boolean().optional().describe('Automatically dispatch ui-interaction event to agent when user modifies value.'),
        persistToStorage: z.boolean().optional().describe('Whether to persist input state to chrome.storage.local across popup sessions.'),
        items: z.array(z.string()).optional().describe('Array of items to display when type is "list".'),
        tasks: z
          .array(
            z.object({
              id: z.string().optional(),
              text: z.string(),
              done: z.boolean().optional(),
              badge: z.string().optional(),
              detail: z.string().optional(),
            })
          )
          .optional()
          .describe('Array of tasks for interactive task-list component.'),
        allowAdd: z.boolean().optional().describe('Allow user to add tasks in task-list component.'),
        messages: z
          .array(
            z.object({
              role: z.enum(['user', 'assistant']),
              text: z.string(),
              timestamp: z.string().optional(),
            })
          )
          .optional()
          .describe('Messages for embedded agent chat component.'),
        suggestions: z.array(z.string()).optional().describe('Quick-reply suggestion chips for chat component.'),
        cards: z
          .array(
            z.object({
              title: z.string(),
              subtitle: z.string().optional(),
              text: z.string().optional(),
              badge: z.string().optional(),
              image: z.string().optional(),
              icon: z.string().optional(),
              action: z.string().optional(),
              payload: z.any().optional(),
            })
          )
          .optional()
          .describe('Cards array for card / cards grid component.'),
        slides: z
          .array(
            z.object({
              title: z.string(),
              subtitle: z.string().optional(),
              text: z.string().optional(),
              badge: z.string().optional(),
              image: z.string().optional(),
              actionLabel: z.string().optional(),
              action: z.string().optional(),
              payload: z.any().optional(),
            })
          )
          .optional()
          .describe('Slides array for carousel component.'),
        menuItems: z
          .array(
            z.object({
              id: z.string().optional(),
              label: z.string(),
              icon: z.string().optional(),
              shortcut: z.string().optional(),
              action: z.string().optional(),
              payload: z.any().optional(),
            })
          )
          .optional()
          .describe('Menu items for dropdown menu / command bar component.'),
        triggerLabel: z.string().optional().describe('Button label to trigger modal dialog overlay.'),
        iconName: z.string().optional().describe('Icon name for icon component (e.g. spark, tabs, shield, search, chat, check).'),
        src: z.string().optional().describe('Image source URL or data URI for image component.'),
        alt: z.string().optional().describe('Image alt text.'),
        caption: z.string().optional().describe('Image caption.'),
        dismissible: z.boolean().optional().describe('Whether alert or toast can be dismissed by user.'),
        durationMs: z.number().optional().describe('Auto-dismiss timeout in ms for toast.'),
        payload: z.any().optional().describe('Custom state or data payload to pass back to the agent on interaction click events.'),
        limit: z.number().optional().describe('Max entries to show when type is "action-history". Default 15.'),
        showUndoAll: z.boolean().optional().describe('Whether to show a prominent Undo All / Undo Last button in action-history. Default true.'),
        undoAllLabel: z.string().optional().describe('Label for the Undo All button. Default "Undo Last Action".'),
        emptyText: z.string().optional().describe('Text to display when list or action history is empty.'),
        metrics: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
              subvalue: z.string().optional(),
            })
          )
          .optional()
          .describe('List of stat cards to display in a grid when type is "metrics".'),
        actions: z
          .array(
            z.object({
              id: z.string().optional(),
              label: z.string(),
              detail: z.string().optional(),
              timestamp: z.string().optional(),
              undoable: z.boolean().optional(),
              undone: z.boolean().optional(),
            })
          )
          .optional()
          .describe('List of custom action rows when type is "action-list".')
      })
    ).describe('List of interface components to lay out sequentially or in a bento-grid.')
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
