/**
 * In-Browser AI Architect for Prompt in a Box Studio
 *
 * Provides multimodal inspiration analysis, extension scaffolding, and
 * iterative prompt refinement directly within the Chrome Extension.
 */

import { generateText, generateImage, Output } from 'ai';
import { z } from 'zod';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { CAPABILITIES } from './capabilities';
import type { Provider } from './config';
import type { ExtensionProjectData, IconBrief } from './compiler';

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
  host_permissions: z
    .array(z.string())
    .default(['<all_urls>'])
    .describe('URL match patterns this extension needs access to, e.g. ["<all_urls>"] or ["https://github.com/*"].'),
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
   - Provide a visually stunning popup/sidepanel UI with:
     - \`theme\`: "glassmorphic" (iOS/visionOS frosted blur), "neon-dark" (cyber neon), "warm-editorial" (warm editorial paper), "compact" (dense utilitarian), or "default" (clean SaaS).
     - \`themeConfig\`: optional \`{ accentColor: "#...", backgroundGradient: "...", blurPx: 16 }\`.
     - \`layoutMode\`: "stack", "bento-grid" (2-column cards), "two-column", "tabbed", "chat-first", or "compact-feed".
     - Rich dynamic components:
       - Inputs: \`select\`, \`switch\`, \`radio\`, \`checkbox\`, \`textarea\`, \`password\`, \`date-time\`, \`file\`, \`slider\` (use \`storageKey\` to persist dynamic values).
       - Agent & Tasks: \`chat\` (user talks directly to extension agent), \`task-list\` (checkable action queue), \`summary\`, \`button\`, \`action-history\` (\`showUndoAll: true\`, \`undoAllLabel: "Undo Action"\`, \`limit: 15\`).
       - Containers & Display: \`card\`, \`carousel\`, \`metrics\`, \`table\`, \`dialog\`, \`menu\`, \`alert\`, \`icon\`.
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
    host_permissions: blueprint.host_permissions || ['<all_urls>'],
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

// ─── Conversational AI Refinement & Debugging Chat ──────────────────────

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  changeSummary?: string;
  timestamp?: number;
}

export const chatRefinementSchema = z.object({
  reply: z.string().describe('Clear, friendly conversational response diagnosing the issue or explaining changes made.'),
  updatedPromptMarkdown: z
    .string()
    .optional()
    .describe('Full updated prompt.md content if changes to the prompt or ```ui block are needed. Omit if unchanged.'),
  updatedOptionalPermissions: z
    .array(z.string())
    .optional()
    .describe('Updated optional_permissions list if capability changes are needed. Omit if unchanged.'),
  updatedHostPermissions: z
    .array(z.string())
    .optional()
    .describe('Updated host_permissions list (e.g. ["<all_urls>"]) if URL match patterns changed. Omit if unchanged.'),
  changeSummary: z
    .string()
    .optional()
    .describe('Concise 1-line summary of changes applied to the project (e.g. "Fixed code_mode timeout, added tab.canScript check, and granted <all_urls>").'),
});

export type ChatRefinementResult = z.infer<typeof chatRefinementSchema>;

/**
 * Multi-turn conversational AI refinement for extension projects.
 * Takes the current project, chat history, user request (or error message), and optional test logs.
 */
export async function chatRefineProjectWithAI({
  provider,
  modelId,
  apiKey,
  project,
  chatHistory = [],
  userMessage,
  recentLogsText,
  onProgress,
}: {
  provider: Provider;
  modelId: string;
  apiKey: string;
  project: ExtensionProjectData;
  chatHistory?: ChatTurn[];
  userMessage: string;
  recentLogsText?: string;
  onProgress?: (status: string) => void;
}): Promise<ChatRefinementResult> {
  onProgress?.(`Consulting AI Architect (${modelId})...`);

  const model = getModelInstance(provider, modelId, apiKey);
  const capabilitySummary = buildStudioCapabilitySummary();

  let systemPrompt = `You are the lead architect and prompt engineer for "prompt-in-a-box".
You are collaborating interactively with a developer to build, debug, and refine their Chrome Extension.
You have full authority to update prompt.md (including declarative \`\`\`ui block, code_mode batching, and lifecycle handling), optional_permissions, and host_permissions (including "<all_urls>").

### Non-Negotiable Architecture Rules:
1. When diagnosing errors (e.g. "cannot be scripted due to policy", "sandbox execution timed out", "readPage failed", or tool errors):
   - Check if \`tab.canScript\` from \`tab_list\` is checked before calling \`tab_read\`.
   - Skip restricted origins (chrome://, chrome-extension://, mail.google.com if restricted, etc.) and classify by domain/title.
   - For batching, use async scripts in \`code_mode\` with \`Promise.all\` and per-tab \`try/catch\`.
   - Ensure \`<all_urls>\` is in \`host_permissions\` if arbitrary web pages need to be inspected.
2. When updating prompt.md:
   - Always preserve or improve the \`\`\`ui ... \`\`\` block. You can specify theme ("glassmorphic", "neon-dark", "warm-editorial", "compact", "default"), themeConfig ({ accentColor, backgroundGradient, blurPx, cardOpacity, borderRadiusPx }), layoutMode ("stack", "bento-grid", "two-column", "tabbed", "chat-first", "compact-feed"), and rich components: select, switch, radio, checkbox, textarea, password, date-time, file, slider, chat, task-list, summary, card, carousel, metrics, table, dialog, menu, alert, icon, button, action-history (using storageKey for dynamic chrome.storage data persistence).
   - Preserve multi-window isolation (\`windowId\` scoping) and undo toasts.
3. Tool Fidelity: Only reference real tools from the Capability Reference.

${capabilitySummary}

### Current Extension Project:
- Name: "${project.name}"
- Description: "${project.description}"
- Required Permissions: [${project.permissions.join(', ')}]
- Optional Permissions: [${(project.optional_permissions || []).join(', ')}]
- Host Permissions (URLs): [${(project.host_permissions || ['<all_urls>']).join(', ')}]

### Current prompt.md:
\`\`\`markdown
${project.prompt}
\`\`\`
`;

  if (recentLogsText && recentLogsText.trim()) {
    systemPrompt += `\n### Recent Test Runner Logs / Errors from the Live Browser:\n\`\`\`\n${recentLogsText.trim().slice(-4000)}\n\`\`\`\n`;
  }

  const messages: any[] = [];
  messages.push({ role: 'system', content: systemPrompt });

  for (const turn of chatHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }

  messages.push({ role: 'user', content: userMessage });

  onProgress?.('Generating solution & project updates...');

  const providerOptions =
    provider === 'google'
      ? { google: { thinkingConfig: { thinkingLevel: 'low' } } }
      : undefined;

  const result = await generateText({
    model,
    output: Output.object({ schema: chatRefinementSchema }),
    messages,
    providerOptions: providerOptions as any,
  });

  return result.output;
}

// ─── AI Theme & Visual Styling ─────────────────────────────────────────

export const styleUiSchema = z.object({
  theme: z.enum(['default', 'glassmorphic', 'neon-dark', 'warm-editorial', 'compact']).default('glassmorphic'),
  accentColor: z.string().describe('Primary hex accent color, e.g. #3b82f6'),
  backgroundGradient: z.string().optional().describe('CSS background gradient string or color, e.g. linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)'),
  blurPx: z.number().optional().describe('Backdrop blur in pixels (8 to 24), e.g. 16'),
  cardOpacity: z.number().optional().describe('Card opacity 0.0 to 1.0, e.g. 0.85'),
  borderRadiusPx: z.number().optional().describe('Border radius in pixels, e.g. 10'),
  customCss: z.string().optional().describe('Subtle custom CSS rules'),
  themeSummary: z.string().describe('Brief 1-sentence aesthetic rationale.'),
});

export type GeneratedThemeStyle = z.infer<typeof styleUiSchema>;

export async function generateThemeStyleWithAI({
  provider,
  modelId,
  apiKey,
  projectName,
  projectDescription,
  inspirationNotes,
  onProgress,
}: {
  provider: Provider;
  modelId: string;
  apiKey: string;
  projectName: string;
  projectDescription?: string;
  inspirationNotes?: string;
  onProgress?: (status: string) => void;
}): Promise<GeneratedThemeStyle> {
  onProgress?.(`Consulting AI designer (${provider} / ${modelId})...`);
  const model = getModelInstance(provider, modelId, apiKey);

  const prompt = `You are a world-class UI/UX design director specializing in modern browser extension interfaces.
Create a stunning visual theme for the Chrome Extension "${projectName}".
Extension description: "${projectDescription || '(No description)'}"
User aesthetic notes / theme inspiration: "${inspirationNotes || 'Modern sleek aesthetic'}"

Choose the best matching theme preset:
- 'glassmorphic': Frosted translucency, Apple visionOS / iOS blur, sleek glowing edges
- 'neon-dark': Deep cyber dark, high-contrast neon accents, glowing borders
- 'warm-editorial': Serif/paper warmth, refined cream/charcoal palette, literary craft
- 'compact': Dense utilitarian data layout, low padding, crisp borders
- 'default': Clean modern SaaS / Material You interface

Provide:
1. theme: One of the presets above.
2. accentColor: Hex color (e.g. #6366f1, #10b981, #f43f5e, #38bdf8).
3. backgroundGradient: Optional subtle CSS gradient.
4. blurPx: Optional glassmorphic blur (8 to 24).
5. cardOpacity: Optional card opacity (0.75 to 0.95).
6. borderRadiusPx: Optional border radius (4 to 14).
7. customCss: Optional subtle CSS overrides.
8. themeSummary: 1-sentence design rationale.
`;

  const providerOptions =
    provider === 'google'
      ? { google: { thinkingConfig: { thinkingLevel: 'low' } } }
      : undefined;

  const result = await generateText({
    model,
    output: Output.object({ schema: styleUiSchema }),
    messages: [{ role: 'user', content: prompt }],
    providerOptions: providerOptions as any,
  });

  return result.output;
}

// ─── AI Icon Generation ────────────────────────────────────────────────

export const DEFAULT_ICON_MODEL = 'gemini-nano-banana-2.1';

export function resolveImageModelId(raw?: string): string {
  if (!raw || typeof raw !== 'string') return DEFAULT_ICON_MODEL;
  const clean = raw.trim().toLowerCase();
  if (
    clean === 'gemini-nano-banana 2.1' ||
    clean === 'gemini-nano-banana-2.1' ||
    clean === 'nano-banana' ||
    clean === 'nano-banana-2.1' ||
    clean === 'banana'
  ) {
    return 'gemini-nano-banana-2.1';
  }
  if (clean === 'gemini-3.1-flash-image' || clean === 'gemini-3.1-flash-image-preview' || clean === '3.1-image') {
    return 'gemini-3.1-flash-image-preview';
  }
  if (clean === 'gemini-3-pro-image' || clean === 'gemini-3-pro-image-preview' || clean === '3-pro-image') {
    return 'gemini-3-pro-image-preview';
  }
  if (clean === 'gemini-2.5-flash-image' || clean === '2.5-image') {
    return 'gemini-2.5-flash-image';
  }
  if (clean === 'gpt-image-2.5-flare' || clean === 'gpt-image-2.5' || clean === 'flare') {
    return 'gpt-image-2.5-flare';
  }
  if (clean === 'gpt-image-1' || clean === 'gpt-image') {
    return 'gpt-image-1';
  }
  return raw.trim();
}

export const ART_STYLE_DESCRIPTIONS: Record<string, string> = {
  'flat-vector': 'Modern flat vector app icon, smooth diagonal gradient background, crisp geometric shapes, App Store / Material You quality',
  '3d-clay': '3D soft tactile clay render, studio lighting, smooth matte surfaces, playful depth, macOS Big Sur icon aesthetic',
  'glassmorphic': 'Frosted translucent glassmorphic layers, vibrant neon rim lighting, sleek dark-mode depth, modern UI icon',
  'isometric': '3D isometric miniature icon, clean architectural precision, vibrant lighting, centered composition',
  'minimal-line': 'Minimalist monoline geometric vector emblem, bold high-contrast strokes on a rich gradient background',
  'pixel-art': 'Crisp high-craft 32-bit pixel art icon, vibrant retro-modern palette, clean silhouette',
  'metallic': 'Sleek brushed dark titanium and chrome emblem, subtle specular highlights, pro developer tool aesthetic',
};

/**
 * Constructs an art-directed prompt for the image LLM from user-configured UI options.
 */
export function buildStudioIconPrompt({
  name,
  description,
  iconBrief,
}: {
  name: string;
  description?: string;
  iconBrief?: IconBrief;
}): string {
  const parts: string[] = [];
  const subject = [name, description].filter(Boolean).join(' — ');
  parts.push(`App icon for a Chrome browser extension: ${subject}.`);

  if (iconBrief?.styleDescription && iconBrief.styleDescription.trim()) {
    parts.push(`Visual subject & intent: ${iconBrief.styleDescription.trim()}.`);
  }

  const artStyleKey = iconBrief?.artStyle || 'flat-vector';
  const artStylePrompt = ART_STYLE_DESCRIPTIONS[artStyleKey] || ART_STYLE_DESCRIPTIONS['flat-vector'];
  parts.push(`Art style: ${artStylePrompt}.`);

  if (iconBrief?.symbol && iconBrief.symbol !== 'none') {
    parts.push(`Central subject / symbol motif: ${iconBrief.symbol}.`);
  }

  if (iconBrief?.colors && iconBrief.colors.length >= 2) {
    parts.push(`Color palette: ${iconBrief.colors.join(' and ')}.`);
  }

  parts.push(
    'Centered single bold emblem, generous padding inside frame, rounded-square icon composition, high contrast, clean edges. Absolutely NO text, NO words, NO letters, NO numbers, NO watermark.'
  );

  return parts.join(' ');
}

/**
 * Normalizes and downscales generated image bitmaps to a clean 512x512 PNG data URL.
 */
export async function downscaleImageDataUrl(
  rawBase64: string,
  mediaType = 'image/png',
  maxDim = 512
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (width > maxDim || height > maxDim) {
        if (width >= height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(`data:${mediaType};base64,${rawBase64}`);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png', 0.92));
    };
    img.onerror = () => resolve(`data:${mediaType};base64,${rawBase64}`);
    img.src = `data:${mediaType};base64,${rawBase64}`;
  });
}

/**
 * Generates an extension icon using an image LLM (gemini-nano-banana-2.1 by default).
 */
export async function generateIconWithAI({
  name,
  description,
  iconBrief,
  keys,
  onProgress,
}: {
  name: string;
  description?: string;
  iconBrief?: IconBrief;
  keys: Record<Provider, string>;
  onProgress?: (status: string) => void;
}): Promise<{ dataUrl: string; modelUsed: string; promptUsed: string }> {
  const modelId = resolveImageModelId(iconBrief?.model || DEFAULT_ICON_MODEL);
  const prompt = buildStudioIconPrompt({ name, description, iconBrief });

  const isOpenAI = /^gpt-image|^dall-e|^chatgpt-image/i.test(modelId);

  if (isOpenAI) {
    const apiKey = keys.openai;
    if (!apiKey) {
      throw new Error(
        'No OpenAI API key found. Please enter your OpenAI key in Settings to generate with OpenAI image models.'
      );
    }
    onProgress?.(`Generating AI icon with OpenAI (${modelId})...`);
    const openai = createOpenAI({ apiKey });
    const model = openai.imageModel(modelId as any);
    const { image } = await generateImage({
      model,
      prompt,
      n: 1,
      size: '1024x1024',
    });
    onProgress?.('Processing icon bitmap...');
    const dataUrl = await downscaleImageDataUrl(image.base64, image.mediaType || 'image/png', 512);
    return { dataUrl, modelUsed: modelId, promptUsed: prompt };
  } else {
    const apiKey = keys.google;
    if (!apiKey) {
      throw new Error(
        'No Google Gemini API key found. Please enter your Gemini API key in Settings to generate AI icons.'
      );
    }
    const google = createGoogleGenerativeAI({ apiKey });
    const modelsToTry = [
      modelId,
      'gemini-nano-banana-2.1',
      'gemini-3.1-flash-image-preview',
      'gemini-2.5-flash-image',
    ];
    const uniqueModels = [...new Set(modelsToTry)];

    let lastError: Error | null = null;
    for (const mId of uniqueModels) {
      try {
        onProgress?.(`Generating AI icon with Gemini (${mId})...`);
        const model = google.image(mId as any);
        const { image } = await generateImage({
          model,
          prompt,
          n: 1,
          aspectRatio: '1:1',
        });
        onProgress?.('Processing icon bitmap...');
        const dataUrl = await downscaleImageDataUrl(image.base64, image.mediaType || 'image/png', 512);
        return { dataUrl, modelUsed: mId, promptUsed: prompt };
      } catch (err) {
        lastError = err as Error;
        const msg = String((err as Error)?.message || err);
        const isAvailability = /not found|404|unsupported|not supported|quota|resource exhausted/i.test(msg);
        if (!isAvailability) {
          throw err;
        }
      }
    }
    throw lastError || new Error(`Failed to generate icon with Gemini (${modelId})`);
  }
}
