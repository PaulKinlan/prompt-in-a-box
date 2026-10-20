/**
 * Multimodal Inspiration Loader & Intent Analyzer
 *
 * Ingests inspiration from screenshots, design mockups, SVG files, spec docs,
 * existing extensions, directories, or URLs, and performs deep multimodal analysis
 * with Gemini to extract intent, UX layout, triggers, tools, and visual identity.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { runWithModelFallback, GEMINI_MODELS } from './ai-models.js';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TEXT_EXTS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.ts',
  '.js',
  '.jsx',
  '.tsx',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
]);

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Extracts inspiration paths and text prompts from CLI args.
 */
export function parseInspirationArgs(args) {
  const inspirationTargets = [];
  const textWords = [];
  let explicitModel = null;
  let explicitSlug = null;
  let dryRun = false;
  let autoUse = false;
  let autoPack = false;
  let skipIcons = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      return { showHelp: true };
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--use') {
      autoUse = true;
      continue;
    }
    if (arg === '--pack') {
      autoPack = true;
      continue;
    }
    if (arg === '--no-icons' || arg === '--no-icon') {
      skipIcons = true;
      continue;
    }
    if (arg === '--pro' || arg === '-p') {
      explicitModel = GEMINI_MODELS.PRO;
      continue;
    }
    if (arg === '--flash' || arg === '-f') {
      explicitModel = GEMINI_MODELS.FLASH;
      continue;
    }
    if (arg.startsWith('--model=')) {
      explicitModel = arg.slice(8);
      continue;
    }
    if (arg === '--model' && i + 1 < args.length) {
      explicitModel = args[++i];
      continue;
    }
    if (arg.startsWith('--slug=')) {
      explicitSlug = arg.slice(7);
      continue;
    }
    if (arg === '--slug' && i + 1 < args.length) {
      explicitSlug = args[++i];
      continue;
    }
    if (
      arg.startsWith('--from=') ||
      arg.startsWith('--inspiration=') ||
      arg.startsWith('--image=') ||
      arg.startsWith('--file=')
    ) {
      inspirationTargets.push(arg.split('=')[1]);
      continue;
    }
    if (
      (arg === '--from' || arg === '--inspiration' || arg === '--image' || arg === '--file' || arg === '-i') &&
      i + 1 < args.length
    ) {
      inspirationTargets.push(args[++i]);
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    // Positional argument: if it matches a path on disk, consider it inspiration
    const resolvedPath = path.resolve(process.cwd(), arg);
    if (fs.existsSync(resolvedPath)) {
      inspirationTargets.push(arg);
    } else {
      textWords.push(arg);
    }
  }

  return {
    showHelp: false,
    inspirationTargets,
    userPrompt: textWords.join(' ').trim(),
    explicitModel,
    explicitSlug,
    dryRun,
    autoUse,
    autoPack,
    skipIcons,
  };
}

/**
 * Loads inspiration items into structured records.
 */
export async function loadInspirationItem(target, log = console.log) {
  // 1. URL
  if (/^https?:\/\//i.test(target)) {
    try {
      log(`  🌐 Fetching inspiration from URL: ${target}...`);
      const res = await fetch(target);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';

      if (contentType.startsWith('image/')) {
        const arrayBuf = await res.arrayBuffer();
        return {
          kind: 'image',
          source: target,
          mediaType: contentType.split(';')[0],
          buffer: Buffer.from(arrayBuf),
        };
      } else {
        const text = await res.text();
        return {
          kind: 'text',
          source: target,
          text: text.slice(0, 100_000),
        };
      }
    } catch (err) {
      log(`  ⚠️ Failed to fetch URL inspiration "${target}": ${err.message}`);
      return null;
    }
  }

  // 2. Local File or Directory
  const fullPath = path.resolve(process.cwd(), target);
  if (!fs.existsSync(fullPath)) {
    log(`  ⚠️ Inspiration path not found: ${target}`);
    return null;
  }

  const stat = fs.statSync(fullPath);

  // Directory
  if (stat.isDirectory()) {
    log(`  📂 Inspecting inspiration directory: ${target}...`);
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    const collectedFiles = [];

    // Prioritize prompt.md, README.md, manifest.json, config.json, and images
    const priorityNames = ['prompt.md', 'README.md', 'manifest.json', 'config.json'];
    for (const p of priorityNames) {
      const pPath = path.join(fullPath, p);
      if (fs.existsSync(pPath)) {
        try {
          collectedFiles.push({
            name: p,
            text: fs.readFileSync(pPath, 'utf8').slice(0, 40_000),
          });
        } catch {}
      }
    }

    // Look for images in the folder
    for (const ent of entries) {
      if (ent.isFile() && IMAGE_EXTS.has(path.extname(ent.name).toLowerCase())) {
        try {
          const imgBuf = fs.readFileSync(path.join(fullPath, ent.name));
          return {
            kind: 'image',
            source: path.join(target, ent.name),
            mediaType: getMediaType(ent.name),
            buffer: imgBuf,
            contextFiles: collectedFiles,
          };
        } catch {}
      }
    }

    return {
      kind: 'directory',
      source: target,
      files: collectedFiles,
    };
  }

  // Single File
  const ext = path.extname(fullPath).toLowerCase();

  // SVG
  if (ext === '.svg') {
    log(`  🎨 Reading SVG inspiration: ${target}...`);
    try {
      const svgText = fs.readFileSync(fullPath, 'utf8');
      const pngBuffer = await sharp(Buffer.from(svgText))
        .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      return {
        kind: 'svg',
        source: target,
        text: svgText.slice(0, 40_000),
        mediaType: 'image/png',
        buffer: pngBuffer,
      };
    } catch (err) {
      return {
        kind: 'text',
        source: target,
        text: fs.readFileSync(fullPath, 'utf8').slice(0, 40_000),
      };
    }
  }

  // Raster Image
  if (IMAGE_EXTS.has(ext)) {
    log(`  🖼️ Loading image inspiration: ${target}...`);
    try {
      const rawBuf = fs.readFileSync(fullPath);
      // Ensure image is within safe limits for multimodal API
      const processedBuffer = await sharp(rawBuf)
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      return {
        kind: 'image',
        source: target,
        mediaType: 'image/png',
        buffer: processedBuffer,
      };
    } catch (err) {
      log(`  ⚠️ Failed to process image "${target}": ${err.message}`);
      return null;
    }
  }

  // PDF
  if (ext === '.pdf') {
    log(`  📄 Loading PDF inspiration: ${target}...`);
    try {
      const pdfBuf = fs.readFileSync(fullPath);
      return {
        kind: 'file',
        source: target,
        mediaType: 'application/pdf',
        buffer: pdfBuf,
      };
    } catch (err) {
      log(`  ⚠️ Failed to read PDF "${target}": ${err.message}`);
      return null;
    }
  }

  // Text / Code
  if (TEXT_EXTS.has(ext) || stat.size < 500_000) {
    log(`  📝 Reading document inspiration: ${target}...`);
    try {
      const text = fs.readFileSync(fullPath, 'utf8');
      return {
        kind: 'text',
        source: target,
        text: text.slice(0, 80_000),
      };
    } catch (err) {
      log(`  ⚠️ Failed to read text file "${target}": ${err.message}`);
      return null;
    }
  }

  return null;
}

/**
 * Zod Schema for the Architectural Intent Analysis.
 */
export const inspirationAnalysisSchema = z.object({
  name: z
    .string()
    .describe('A catchy, professional, concise name for the extension (e.g. "Sorting Hat", "Tab Focus Shield").'),
  slug: z
    .string()
    .describe('A URL-safe slug for the folder name under examples/ (e.g. "sorting-hat", "tab-focus-shield").'),
  description: z
    .string()
    .describe('A crisp 1-2 sentence description explaining what the extension does and why it is useful.'),
  intentSummary: z
    .string()
    .describe('Deep synthesis of the core user goal, problem solved, and primary interaction loop.'),
  visualAndUi: z.object({
    hasUi: z.boolean().describe('Whether the extension should offer an interactive popup/sidepanel UI.'),
    theme: z.enum(['default', 'glassmorphic', 'compact']).default('glassmorphic'),
    suggestedTitle: z.string().describe('Title displayed at top of the popup/sidepanel.'),
    keyMetrics: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
          subvalue: z.string().optional(),
        }),
      )
      .describe('Key metrics to show on the dashboard (e.g. "Organized Tabs: 18", "Distractions Blocked: 4").'),
    keyActions: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          intent: z.enum(['info', 'success', 'warning', 'danger']),
          description: z.string(),
        }),
      )
      .describe('Primary buttons to render in the popup (e.g. id "btn_sort_now", label "🪄 Sort Tabs Now").'),
    keyInputs: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          placeholder: z.string(),
        }),
      )
      .optional(),
  }),
  triggers: z.object({
    alarmMinutes: z
      .number()
      .default(30)
      .describe('Background periodic interval in minutes (5, 15, 30, 60, or 0 to disable background alarm).'),
    immediateEvents: z
      .array(z.string())
      .describe('Events that wake the agent immediately (e.g. "contextMenus.onClicked", "idle.onStateChanged").'),
    queuedEvents: z
      .array(z.string())
      .describe('Ambient events to monitor (e.g. "tabs.onCreated", "tabs.onUpdated", "bookmarks.onCreated").'),
  }),
  permissions: z
    .array(z.string())
    .describe('Minimal required Chrome manifest permissions (e.g. "storage", "alarms", "offscreen").'),
  optional_permissions: z
    .array(z.string())
    .describe('Optional Chrome permissions requested on-demand (e.g. "tabs", "tabGroups", "scripting", "bookmarks").'),
  host_permissions: z
    .array(z.string())
    .default([])
    .describe('Required host permissions (e.g. specific API endpoints). Prefer empty array unless required.'),
  optional_host_permissions: z
    .array(z.string())
    .default(['<all_urls>'])
    .describe('Optional host permissions for arbitrary page reading/injection.'),
  codeModeStrategy: z
    .string()
    .describe('Exact strategy for how the agent will use code_mode to batch operations in parallel.'),
  agentSettings: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        hint: z.string(),
        type: z.enum(['boolean', 'select', 'text', 'number']),
        defaultValue: z.union([z.string(), z.boolean(), z.number()]).describe('Default value'),
        default: z.union([z.string(), z.boolean(), z.number()]).optional(),
        options: z
          .array(
            z.object({
              label: z.string(),
              value: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .describe('Custom user-configurable preferences rendered in Options & Popup/Sidepanel and injected into prompt.'),
  iconBrief: z.object({
    symbol: z.string().describe('Suggested glyph or icon metaphor (e.g. "funnel", "spark", "camera", "tabs").'),
    colors: z.array(z.string()).describe('Suggested colors or gradient themes matching the visual inspiration.'),
    styleDescription: z.string().describe('Descriptive style guidance for AI icon generation.'),
  }),
});

/**
 * Performs multimodal analysis of inspiration items + user guidance.
 */
export async function analyzeInspirationAndIntent({
  apiKey,
  modelId = GEMINI_MODELS.FLASH,
  fallbackModelId = GEMINI_MODELS.PRO,
  inspirationItems = [],
  userPrompt = '',
  capabilityReference = '',
  log = console.log,
}) {
  log(`🧠 Performing deep multimodal architecture analysis with ${modelId}...`);

  const parts = [];

  // 1. Text Instructions
  let textPrompt = `Analyze the following inspiration and user guidance for a new Chrome Extension built on the "prompt-in-a-box" platform.
Your goal is to infer a complete, robust architectural specification:
1. Identify the user's real goal, UX structure, and problem solved.
2. Determine if the visual inspiration (or user prompt) implies a dynamic dashboard UI (title, theme, metrics, buttons, inputs, undo).
3. Determine which Chrome APIs/tools are needed. Follow Manifest V3 security principles: keep required permissions minimal (storage, alarms, offscreen), and place powerful permissions under optional_permissions.
4. Define a concrete code_mode batching strategy so the extension runs fast with parallel Promise.all inspection instead of slow serial tool calls.
5. Define 2-4 thoughtful, user-configurable agentSettings fields (e.g. toggles, mode selects) that empower the user.
6. Provide an icon design brief matching the visual inspiration.

User Guidance: "${userPrompt || '(No text prompt provided — infer entire intent from inspiration assets)'}"
`;

  // Append Capability Reference
  textPrompt += `\n\n${capabilityReference}\n`;

  // 2. Attach Text/Directory Inspiration
  for (const item of inspirationItems) {
    if (item.kind === 'text') {
      textPrompt += `\n--- Inspiration Document: ${item.source} ---\n${item.text}\n`;
    } else if (item.kind === 'directory') {
      textPrompt += `\n--- Inspiration Directory: ${item.source} ---\n`;
      for (const f of item.files) {
        textPrompt += `\n[File: ${f.name}]\n${f.text}\n`;
      }
    } else if (item.kind === 'svg' && item.text) {
      textPrompt += `\n--- Inspiration SVG Markup: ${item.source} ---\n${item.text}\n`;
    }
  }

  parts.push({ type: 'text', text: textPrompt });

  // 3. Attach Multimodal Images & PDFs
  for (const item of inspirationItems) {
    if (item.kind === 'image' || item.kind === 'svg') {
      if (item.buffer) {
        parts.push({
          type: 'file',
          data: item.buffer,
          mediaType: item.mediaType || 'image/png',
        });
      }
    } else if (item.kind === 'file' && item.buffer) {
      parts.push({
        type: 'file',
        data: item.buffer,
        mediaType: item.mediaType || 'application/pdf',
      });
    }
  }

  const analysis = await runWithModelFallback({
    apiKey,
    primaryModelId: modelId,
    fallbackModelId,
    log,
    runner: async (modelInstance) => {
      const { output } = await generateText({
        model: modelInstance,
        output: Output.object({ schema: inspirationAnalysisSchema }),
        messages: [
          {
            role: 'user',
            content: parts,
          },
        ],
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: 'low',
            },
          },
        },
      });
      return output;
    },
  });

  return analysis;
}
