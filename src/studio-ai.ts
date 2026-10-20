/**
 * In-Browser AI Architect for Prompt in a Box Studio
 *
 * Provides multimodal inspiration analysis, extension scaffolding, and
 * iterative prompt refinement directly within the Chrome Extension.
 */

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { CAPABILITIES } from './capabilities';
import type { Provider } from './config';
import type { ExtensionProjectData } from './compiler';

export interface InspirationAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  text?: string;
  buffer?: Uint8Array;
}

export const generatedBlueprintSchema = z.object({
  name: z.string().describe('Catchy concise name for the extension (e.g. "Sorting Hat").'),
  slug: z.string().describe('URL-safe folder slug (e.g. "sorting-hat").'),
  description: z.string().describe('1-2 sentence description explaining the purpose.'),
  intentSummary: z.string().describe('Core problem solved and user interaction loop.'),
  alarmMinutes: z.number().default(30).describe('Periodic alarm interval (5, 15, 30, 60, or 0).'),
  permissions: z.array(z.string()).describe('Minimal required permissions (e.g. storage, alarms).'),
  optional_permissions: z.array(z.string()).describe('Optional on-demand permissions (e.g. tabs, tabGroups, scripting).'),
  agentSettings: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        hint: z.string(),
        type: z.enum(['boolean', 'select']),
        default: z.union([z.string(), z.boolean()]),
        options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
      })
    )
    .optional(),
  iconBrief: z.object({
    symbol: z.string().describe('Suggested glyph metaphor: spark, tabs, shield, folder, search, bookmark, wand, terminal.'),
    colors: z.array(z.string()).describe('2 hex color codes for gradient background, e.g. ["#8b5cf6", "#d946ef"].'),
    styleDescription: z.string().describe('Brief aesthetic description.'),
  }),
  promptMarkdown: z.string().describe('The complete production prompt.md including ```ui fenced block, code_mode batching rules, multi-window safety, and undo toasts.'),
});

function getModelInstance(provider: Provider, modelId: string, apiKey: string) {
  switch (provider) {
    case 'google': {
      const g = createGoogleGenerativeAI({ apiKey });
      return g(modelId || 'gemini-3.8-flash');
    }
    case 'anthropic': {
      const a = createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return a(modelId || 'claude-sonnet-5-5');
    }
    case 'openai': {
      const o = createOpenAI({ apiKey });
      return o(modelId || 'gpt-6.1-sol');
    }
  }
}

/**
 * Builds a capability reference markdown string from in-extension registry.
 */
export function buildStudioCapabilitySummary(): string {
  let doc = '### Available Browser Capabilities & Permissions:\n';
  for (const c of CAPABILITIES) {
    doc += `- \`${c.id}\` (permissions: [${c.permissions.join(', ')}]): ${c.hint} ${c.gates}\n`;
  }
  return doc;
}

/**
 * Analyzes multimodal inspiration + prompt instructions and generates a complete extension project.
 */
export async function generateExtensionFromInspiration({
  provider,
  modelId,
  apiKey,
  userPrompt,
  attachments = [],
  onProgress,
}: {
  provider: Provider;
  modelId: string;
  apiKey: string;
  userPrompt: string;
  attachments?: InspirationAttachment[];
  onProgress?: (status: string) => void;
}): Promise<Partial<ExtensionProjectData>> {
  onProgress?.(`Contacting ${provider} (${modelId})...`);

  const model = getModelInstance(provider, modelId, apiKey);
  const capabilitySummary = buildStudioCapabilitySummary();

  const parts: any[] = [];

  let textPrompt = `You are the lead architect and prompt engineer of the "prompt-in-a-box" platform.
Design a complete, production-grade Chrome Extension based on the inspiration and user instructions.

### Platform Architecture & Non-Negotiable Rules:
1. **Declarative UI (fenced \`\`\`ui block in prompt.md)**:
   - Provide a visually stunning popup/sidepanel UI with theme ("glassmorphic", "default", or "compact"), header, text, key metrics, alert status, trigger buttons, and an \`action-history\` component (\`showUndoAll: true\`, \`undoAllLabel: "Undo Action"\`, \`limit: 15\`).
2. **Speed & Efficiency via \`code_mode\`**:
   - For batch inspection or tab manipulation, instruct the agent to run an async script via \`code_mode\` with parallel \`Promise.all\`.
   - Always check \`tab.canScript\` from \`tab_list\` before calling \`tab_read\`. Skip discarded/restricted pages and classify by domain/title.
3. **Multi-Window Etiquette & Undo**:
   - Always scope tab actions to \`windowId\`. Never group across windows. Never touch pinned or active tabs.
   - Fire \`action_toast({ message, undoLabel: "Undo", badgeText: "UNDO", openPopup: true })\` after mutations.
4. **Permissions**:
   - Keep required permissions minimal (\`storage\`, \`alarms\`, \`offscreen\`). Place powerful capabilities in \`optional_permissions\` (\`tabs\`, \`tabGroups\`, \`scripting\`, \`bookmarks\`, etc.).
5. **Configurable Settings (\`agentSettings\`)**:
   - Define 2-3 user toggles or dropdowns.

${capabilitySummary}

User Request: "${userPrompt || '(Infer intent completely from attached inspiration)'}"
`;

  // Attach text files
  for (const att of attachments) {
    if (att.text) {
      textPrompt += `\n--- Inspiration Document: ${att.name} ---\n${att.text}\n`;
    }
  }

  parts.push({ type: 'text', text: textPrompt });

  // Attach image files (using base64 data URLs converted to Uint8Array)
  for (const att of attachments) {
    if (att.dataUrl && att.type.startsWith('image/')) {
      try {
        const base64Data = att.dataUrl.split(',')[1];
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        parts.push({
          type: 'file',
          data: bytes,
          mediaType: att.type,
        });
      } catch (err) {
        console.warn('Failed to parse attachment image:', err);
      }
    }
  }

  onProgress?.('Synthesizing extension blueprint and prompt.md...');

  const providerOptions =
    provider === 'google'
      ? { google: { thinkingConfig: { thinkingLevel: 'low' } } }
      : undefined;

  const result = await generateText({
    model,
    output: Output.object({ schema: generatedBlueprintSchema }),
    messages: [
      {
        role: 'user',
        content: parts,
      },
    ],
    providerOptions: providerOptions as any,
  });

  const blueprint = result.output;

  return {
    name: blueprint.name,
    slug: blueprint.slug || blueprint.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    version: '1.0.0',
    description: blueprint.description,
    alarmMinutes: blueprint.alarmMinutes ?? 30,
    permissions: blueprint.permissions,
    optional_permissions: blueprint.optional_permissions,
    agentSettings: blueprint.agentSettings || [],
    iconBrief: blueprint.iconBrief,
    prompt: blueprint.promptMarkdown,
    defaultProvider: provider,
    defaultModel: modelId,
  };
}

/**
 * Refines an existing prompt or adds features using AI instructions.
 */
export async function refinePromptWithAI({
  provider,
  modelId,
  apiKey,
  currentPrompt,
  instructions,
  onProgress,
}: {
  provider: Provider;
  modelId: string;
  apiKey: string;
  currentPrompt: string;
  instructions: string;
  onProgress?: (status: string) => void;
}): Promise<string> {
  onProgress?.('Refining prompt with AI...');

  const model = getModelInstance(provider, modelId, apiKey);
  const providerOptions =
    provider === 'google'
      ? { google: { thinkingConfig: { thinkingLevel: 'low' } } }
      : undefined;

  const promptMessage = `You are an expert prompt engineer for "prompt-in-a-box".
Review the current extension prompt.md and update it according to the user's instructions.
Preserve the declarative \`\`\`ui block, code_mode batching logic, multi-window safety, and life-cycle handlers while applying the requested changes.

### Current prompt.md:
\`\`\`markdown
${currentPrompt}
\`\`\`

### User Instructions for Changes:
"${instructions}"

Output ONLY the updated markdown text for prompt.md. Do not wrap in outer backtick blocks.`;

  const result = await generateText({
    model,
    prompt: promptMessage,
    providerOptions: providerOptions as any,
  });

  return result.text.trim();
}
