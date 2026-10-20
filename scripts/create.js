#!/usr/bin/env node
/**
 * Prompt in a Box — Advanced Extension Scaffolder
 *
 * Scaffolds new extensions into `examples/<slug>/` using:
 * - Latest Gemini 4 (gemini-4-argon) and Gemini 3.8 (gemini-3.8-flash) models with automatic fallback.
 * - Multimodal inspiration analysis from images (screenshots/mockups/diagrams), SVGs, PDFs,
 *   documents, directories, or URLs.
 * - Complete, canonical project capability scanning (all 76+ tools and 28+ Chrome events).
 * - Ultra-robust prompt generation incorporating declarative UI (```ui), code_mode batching,
 *   multi-window safety, agentSettings, action history & undo toasts.
 * - Deterministic manifest.json and config.json generation matching Manifest V3 security standards.
 * - Automatic bespoke AI icon generation matching the inspiration's visual theme.
 *
 * Usage:
 *   npm run create "Clean tabs by topic"
 *   npm run create mockup.png "Build a tab manager inspired by this design"
 *   npm run create -- --from ./spec.md --pro
 *   npm run create -- --from https://example.com/screenshot.png --use
 */

import fs from 'node:fs';
import path from 'node:path';
import { generateText } from 'ai';
import { resolveGeminiModelId, runWithModelFallback, GEMINI_MODELS } from './lib/ai-models.js';
import { generateCapabilityReference, generateCompactCapabilitySummary } from './lib/registry-scanner.js';
import { parseInspirationArgs, loadInspirationItem, analyzeInspirationAndIntent } from './lib/inspiration.js';
import { generateIcons } from './lib/icons.js';

const ROOT_DIR = process.cwd();

function printHelp() {
  console.log(`
🚀 Prompt in a Box — Extension Scaffolder

Usage:
  npm run create "<idea>" [options]
  npm run create <path-to-image-or-file> ["<instructions>"] [options]

Options:
  --from, -i, --image, --file <path-or-url>  Inspiration source (repeatable for multiple files/images)
  --model <id>                                Gemini model (gemini-4-argon, gemini-3.8-flash, etc.)
  --pro, -p                                   Shortcut for flagship Gemini 4 (gemini-4-argon)
  --flash, -f                                 Shortcut for fast multimodal Gemini 3.8 (gemini-3.8-flash)
  --slug <slug>                               Override the target example folder name
  --dry-run                                   Analyze intent and output blueprint without writing files
  --use                                       Automatically activate the new example in workspace root
  --pack                                      Automatically build & package standalone example zip
  --no-icons                                  Skip icon generation
  --help, -h                                  Show this help message

Examples:
  npm run create "A smart tab organizer that groups tabs by research topic"
  npm run create design-mockup.png "Make an extension with this dashboard layout"
  npm run create -- --from ./spec.md --pro --use
  npm run create icon.png "Bookmark hygiene assistant" --pack
`);
}

async function getStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
  });
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generates the full prompt.md body using Gemini.
 */
async function generateRobustPrompt({
  apiKey,
  modelId,
  analysis,
  capabilityReference,
  log = console.log,
}) {
  log(`✍️ Generating robust, production-grade prompt.md with ${modelId}...`);

  const instructions = `You are the lead architect and prompt engineer of the "prompt-in-a-box" platform.
Your task is to write the complete, production-grade \`prompt.md\` file for a new Chrome Extension based on the following architectural blueprint.

### Extension Blueprint:
- **Name**: "${analysis.name}"
- **Slug**: "${analysis.slug}"
- **Description**: "${analysis.description}"
- **Intent & Core Problem**: ${analysis.intentSummary}
- **UI Structure**: ${JSON.stringify(analysis.visualAndUi, null, 2)}
- **Triggers & Events**: ${JSON.stringify(analysis.triggers, null, 2)}
- **Permissions**: Required: [${analysis.permissions.join(', ')}], Optional: [${analysis.optional_permissions.join(', ')}]
- **code_mode Batching Strategy**: ${analysis.codeModeStrategy}
- **User Settings (agentSettings)**: ${JSON.stringify(analysis.agentSettings, null, 2)}

---

### Non-Negotiable Requirements for \`prompt.md\`:

1. **Declarative UI Block (\`\`\`ui ... \`\`\`)**:
   - Begin immediately after the top title and intro paragraph with a valid fenced \`\`\`ui JSON block matching the blueprint's \`visualAndUi\` specification.
   - Use theme "${analysis.visualAndUi.theme}".
   - Include appropriate components: \`header\`, \`text\`, \`metrics\` (with key numbers), \`alert\` (status), \`button\` (action: "trigger-run" with descriptive payload and intent), and an \`action-history\` component (\`showUndoAll: true\`, \`undoAllLabel: "Undo Action"\`, \`limit: 15\`).

2. **User Preferences & Configurable Settings**:
   - Explicitly document how the prompt reads and honors the \`Current user-configured agent settings\` JSON block injected into the user message for every field declared in the blueprint's \`agentSettings\`.

3. **High-Speed Execution via \`code_mode\`**:
   - When inspecting multiple items or performing multi-step operations (e.g. reading tabs, grouping tabs, checking bookmarks), instruct the agent to execute an async JavaScript routine via \`code_mode\` rather than taking dozens of serial LLM tool turns.
   - Mandate \`Promise.all\` for parallel data gathering.
   - Explicitly instruct checking \`tab.canScript\` from \`tab_list\` before \`tab_read\`. Skip non-scriptable tabs (discarded, chrome://, or blocked pages) and classify by domain/title.
   - Skip \`tab_read\` on obvious domains (YouTube, GitHub, Google Drive/Mail, Figma, Slack, Jira).
   - Only call \`tab_read({ tabId: tab.id, maxLength: 500 })\` with \`try/catch\` on ambiguous pages.
   - Return clean summary objects at the end of the script.

4. **Multi-Window Isolation & Browser Etiquette**:
   - Explicitly instruct scoping operations to \`windowId\`. Never group or yank tabs across different browser windows.
   - Never touch or move \`pinned\` tabs.
   - Never move or disrupt the currently \`active\` tab.
   - When grouping tabs, preserve existing \`collapsed\` state. Never expand collapsed groups unless they contain the window's active tab.
   - Avoid creating 1-tab groups on automatic background runs.

5. **Trigger & Lifecycle State Machine**:
   - Explicitly cover all trigger scenarios:
     - \`install\` / \`update\` / \`startup\`: Idempotent bootstrap (register context menus using stable IDs, seed default state in \`storage_set\`).
     - \`ui-opened\`: Strictly read-only refresh of metrics and status via \`ui_update\`. Never execute destructive unprompted changes just from opening the popup.
     - \`ui-interaction\`: Handle button clicks matching the button IDs in the UI schema, execute the requested action, trigger an \`action_toast\`, and call \`ui_update\` with the new state.
     - \`event\` / \`alarm\`: Process drained Chrome events, respect idle state (\`idle_query\`), and exit early when nothing needs action.

6. **Action History, Undo Toasts & Storage**:
   - Call \`action_toast({ message, undoLabel: "Undo Action", badgeText: "UNDO", openPopup: true })\` after batch mutations.
   - Preserve the \`action-history\` component in any runtime \`ui_update\` calls.
   - Differentiate storage tiers: \`storage_get\` / \`storage_set\` for small state, \`opfs_read\` / \`opfs_write\` for large data, and \`artifact_create\` for user-facing deliverables.

7. **Tool Fidelity**:
   - ONLY reference real tools from the Capability Reference below. Never invent tools or parameters.

---
${capabilityReference}
---

Output ONLY the complete Markdown content for \`prompt.md\` (do not wrap in extra outer code fences).`;

  const responseText = await runWithModelFallback({
    apiKey,
    primaryModelId: modelId,
    fallbackModelId: GEMINI_MODELS.FLASH,
    log,
    runner: async (modelInstance) => {
      const { text } = await generateText({
        model: modelInstance,
        prompt: instructions,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: 'low',
            },
          },
        },
      });
      return text;
    },
  });

  return responseText.trim();
}

/**
 * Deterministically constructs examples/<slug>/manifest.json.
 */
function createExampleManifest(analysis) {
  const templatePath = path.join(ROOT_DIR, 'scripts/templates/manifest.json');
  let baseManifest = {};
  if (fs.existsSync(templatePath)) {
    try {
      baseManifest = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    } catch {}
  }

  const manifest = {
    ...baseManifest,
    manifest_version: 3,
    name: analysis.name,
    version: '1.0.0',
    description: analysis.description,
    prompt_in_a_box: {
      prompt: 'prompt.md',
      alarm_minutes: analysis.triggers?.alarmMinutes ?? 30,
      default_provider: 'google',
      default_model: GEMINI_MODELS.FLASH,
    },
    action: {
      ...(baseManifest.action || {}),
      default_title: analysis.name,
    },
  };

  // Merge permissions uniquely
  const corePerms = new Set(['storage', 'alarms', 'offscreen']);
  for (const p of analysis.permissions || []) {
    corePerms.add(p);
  }
  manifest.permissions = Array.from(corePerms);

  const optPerms = new Set(baseManifest.optional_permissions || []);
  for (const p of analysis.optional_permissions || []) {
    if (!corePerms.has(p)) optPerms.add(p);
  }
  manifest.optional_permissions = Array.from(optPerms);

  if (analysis.host_permissions && analysis.host_permissions.length > 0) {
    manifest.host_permissions = Array.from(new Set([...(manifest.host_permissions || []), ...analysis.host_permissions]));
  }
  if (analysis.optional_host_permissions && analysis.optional_host_permissions.length > 0) {
    manifest.optional_host_permissions = Array.from(
      new Set([...(manifest.optional_host_permissions || []), ...analysis.optional_host_permissions]),
    );
  }

  return manifest;
}

/**
 * Deterministically constructs examples/<slug>/config.json.
 */
function createExampleConfig(analysis) {
  const templatePath = path.join(ROOT_DIR, 'scripts/templates/config.json');
  let baseConfig = {};
  if (fs.existsSync(templatePath)) {
    try {
      baseConfig = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
    } catch {}
  }

  const config = {
    ...baseConfig,
    version: '1.0.0',
    providers: {
      allowed: ['google', 'anthropic', 'openai'],
      default: 'google',
      lockProvider: false,
    },
    models: {
      default: GEMINI_MODELS.FLASH,
      lockModel: false,
      allowCustomModelInput: true,
      allowed: {
        ...(baseConfig.models?.allowed || {}),
        google: [
          'gemini-3.8-flash',
          'gemini-4-argon',
          'gemini-3.7-flash',
          'gemini-3.6-flash',
          'gemini-3.5-flash',
          'gemini-3.5-flash-lite',
          'gemini-3.1-pro-preview',
          'gemini-3.1-flash-lite',
        ],
      },
    },
    schedule: {
      defaultAlarmMinutes: analysis.triggers?.alarmMinutes ?? 30,
      lockSchedule: false,
    },
  };

  if (analysis.agentSettings && analysis.agentSettings.length > 0) {
    config.agentSettings = {
      storageKey: `${analysis.slug.replace(/-/g, '_')}_settings`,
      title: `${analysis.name} Preferences`,
      fields: analysis.agentSettings.map((s) => ({
        id: s.id,
        label: s.label,
        hint: s.hint,
        type: s.type,
        default: s.defaultValue !== undefined ? s.defaultValue : s.default,
        ...(s.options && s.options.length > 0 ? { options: s.options } : {}),
      })),
    };
  }

  return config;
}

/**
 * Creates a clear, helpful README.md for the new example.
 */
function createExampleReadme(analysis) {
  let doc = `# ${analysis.name}\n\n`;
  doc += `${analysis.description}\n\n`;

  doc += `## Core Intent\n${analysis.intentSummary}\n\n`;

  if (analysis.visualAndUi?.hasUi) {
    doc += `## Interactive Dynamic UI\n`;
    doc += `- **Theme**: \`${analysis.visualAndUi.theme}\`\n`;
    doc += `- **Title**: "${analysis.visualAndUi.suggestedTitle}"\n`;
    if (analysis.visualAndUi.keyMetrics?.length > 0) {
      doc += `- **Dashboard Metrics**: ${analysis.visualAndUi.keyMetrics.map((m) => `\`${m.label}\``).join(', ')}\n`;
    }
    if (analysis.visualAndUi.keyActions?.length > 0) {
      doc += `- **Actions**: ${analysis.visualAndUi.keyActions.map((a) => `\`${a.label}\` (${a.intent})`).join(', ')}\n`;
    }
    doc += `- **Action History & Undo**: Live-bound action journal with instant single-item and batch undo.\n\n`;
  }

  doc += `## Triggers & Scheduling\n`;
  doc += `- **Background Alarm**: Runs every \`${analysis.triggers.alarmMinutes}\` minutes (configurable in Settings)\n`;
  if (analysis.triggers.immediateEvents?.length > 0) {
    doc += `- **Immediate Events**: ${analysis.triggers.immediateEvents.map((e) => `\`${e}\``).join(', ')}\n`;
  }
  if (analysis.triggers.queuedEvents?.length > 0) {
    doc += `- **Ambient Queued Events**: ${analysis.triggers.queuedEvents.map((e) => `\`${e}\``).join(', ')}\n`;
  }
  doc += '\n';

  doc += `## Permissions\n`;
  doc += `- **Required**: ${analysis.permissions.map((p) => `\`${p}\``).join(', ') || 'none'}\n`;
  doc += `- **Optional**: ${analysis.optional_permissions.map((p) => `\`${p}\``).join(', ') || 'none'}\n\n`;

  if (analysis.agentSettings?.length > 0) {
    doc += `## User Preferences (\`agentSettings\`)\n`;
    doc += `Configured in the extension Popup, Side Panel, or Options page:\n`;
    for (const s of analysis.agentSettings) {
      doc += `- **\`${s.id}\`** (${s.type}, default: \`${JSON.stringify(s.default)}\`): ${s.hint || s.label}\n`;
    }
    doc += '\n';
  }

  doc += `## High-Speed Execution (\`code_mode\`)\n`;
  doc += `${analysis.codeModeStrategy}\n\n`;

  doc += `## How to Run & Test\n\n`;
  doc += `### Option A: Activate in the Root Workspace\n`;
  doc += `\`\`\`bash\nnpm run use ${analysis.slug}\nnpm run build\n\`\`\`\n\n`;

  doc += `### Option B: Build as a Standalone Extension Folder\n`;
  doc += `\`\`\`bash\nnpm run build ${analysis.slug}\n\`\`\`\n`;
  doc += `Load \`examples/${analysis.slug}\` directly in \`chrome://extensions\` (Developer mode → Load unpacked).\n\n`;

  doc += `### Option C: Build and Package a Standalone ZIP\n`;
  doc += `\`\`\`bash\nnpm run pack ${analysis.slug}\n\`\`\`\n`;
  doc += `Produces \`examples/${analysis.slug}/${analysis.slug}.zip\` ready for testing or Chrome Web Store distribution.\n`;

  return doc;
}

// ─── Main CLI Routine ──────────────────────────────────────────────────

async function main() {
  const cliArgs = process.argv.slice(2);
  const parsedArgs = parseInspirationArgs(cliArgs);

  if (parsedArgs.showHelp) {
    printHelp();
    process.exit(0);
  }

  let userPrompt = parsedArgs.userPrompt;
  if (!userPrompt && !process.stdin.isTTY) {
    userPrompt = await getStdin();
  }

  if (!userPrompt && parsedArgs.inspirationTargets.length === 0) {
    console.error('❌ Error: Please provide an extension idea, inspiration file, or screenshot image.');
    printHelp();
    process.exit(1);
  }

  const apiKey =
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY environment variable is not set.');
    console.error('Please set it using: export GEMINI_API_KEY="your_api_key"');
    process.exit(1);
  }

  const modelId = resolveGeminiModelId(parsedArgs.explicitModel || process.env.GEMINI_MODEL || GEMINI_MODELS.FLASH);
  console.log(`\n✨ Prompt in a Box — Advanced Extension Scaffolder`);
  console.log(`🤖 Model:        ${modelId} (with auto-fallback to ${modelId === GEMINI_MODELS.PRO ? GEMINI_MODELS.FLASH : GEMINI_MODELS.PRO})`);

  // 1. Load Inspiration Items
  const inspirationItems = [];
  if (parsedArgs.inspirationTargets.length > 0) {
    console.log(`\n🎨 Loading inspiration targets (${parsedArgs.inspirationTargets.length})...`);
    for (const target of parsedArgs.inspirationTargets) {
      const item = await loadInspirationItem(target, (m) => console.log(m));
      if (item) {
        inspirationItems.push(item);
        console.log(`  ✓ Loaded [${item.kind}] from ${item.source}`);
      }
    }
  }

  // 2. Scan Workspace Capabilities
  console.log(`\n🔍 Scanning project tool and event registry...`);
  const compactSummary = generateCompactCapabilitySummary(ROOT_DIR);

  // 3. Deep Multimodal Intent & Architecture Analysis
  const analysis = await analyzeInspirationAndIntent({
    apiKey,
    modelId,
    fallbackModelId: modelId === GEMINI_MODELS.PRO ? GEMINI_MODELS.FLASH : GEMINI_MODELS.PRO,
    inspirationItems,
    userPrompt,
    capabilityReference: compactSummary,
    log: (m) => console.log(m),
  });

  const slug = parsedArgs.explicitSlug || slugify(analysis.slug || analysis.name);
  analysis.slug = slug;

  console.log(`\n📋 Inferred Extension Architecture:`);
  console.log(`  Name:                 ${analysis.name}`);
  console.log(`  Slug:                 examples/${slug}`);
  console.log(`  Description:          ${analysis.description}`);
  console.log(`  UI Theme & Title:     ${analysis.visualAndUi?.theme} — "${analysis.visualAndUi?.suggestedTitle}"`);
  console.log(`  Alarm Interval:       ${analysis.triggers?.alarmMinutes}m`);
  console.log(`  Required Permissions: ${analysis.permissions.join(', ') || 'none'}`);
  console.log(`  Optional Permissions: ${analysis.optional_permissions.join(', ') || 'none'}`);
  if (analysis.agentSettings?.length > 0) {
    console.log(`  Agent Settings:       ${analysis.agentSettings.map((s) => s.id).join(', ')}`);
  }
  console.log(`  Icon Symbol/Style:    ${analysis.iconBrief?.symbol} (${analysis.iconBrief?.styleDescription})`);

  if (parsedArgs.dryRun) {
    console.log(`\n🏁 Dry run complete! Files were not written.`);
    process.exit(0);
  }

  // 4. Create the target example directory
  const destDir = path.join(ROOT_DIR, 'examples', slug);
  fs.mkdirSync(destDir, { recursive: true });

  // 5. Generate deterministic manifest.json and config.json
  const manifestData = createExampleManifest(analysis);
  fs.writeFileSync(path.join(destDir, 'manifest.json'), JSON.stringify(manifestData, null, 2) + '\n', 'utf8');
  console.log(`\n📄 Written: examples/${slug}/manifest.json`);

  const configData = createExampleConfig(analysis);
  fs.writeFileSync(path.join(destDir, 'config.json'), JSON.stringify(configData, null, 2) + '\n', 'utf8');
  console.log(`⚙️ Written: examples/${slug}/config.json`);

  // 6. Generate README.md
  const readmeContent = createExampleReadme(analysis);
  fs.writeFileSync(path.join(destDir, 'README.md'), readmeContent, 'utf8');
  console.log(`📖 Written: examples/${slug}/README.md`);

  // 7. Generate rich, robust prompt.md with tailored capability reference
  const relevantPerms = Array.from(
    new Set([...(analysis.permissions || []), ...(analysis.optional_permissions || [])]),
  );
  const tailoredCapabilityRef = generateCapabilityReference(ROOT_DIR, relevantPerms);

  const promptContent = await generateRobustPrompt({
    apiKey,
    modelId,
    analysis,
    capabilityReference: tailoredCapabilityRef,
    log: (m) => console.log(m),
  });
  fs.writeFileSync(path.join(destDir, 'prompt.md'), promptContent + '\n', 'utf8');
  console.log(`📝 Written: examples/${slug}/prompt.md`);

  // 8. Generate Icons (AI generation with inspiration brief + procedural fallback)
  if (!parsedArgs.skipIcons) {
    console.log(`\n🎨 Generating bespoke icons for examples/${slug}...`);
    try {
      const iconRes = await generateIcons({
        name: analysis.name,
        description: analysis.description,
        destDir,
        iconBrief: analysis.iconBrief,
        log: (m) => console.log(m),
      });
      console.log(`  ✓ ${iconRes.source} icon set created (${iconRes.files.length} sizes)`);
    } catch (iconErr) {
      console.warn(`  ⚠️ Icon generation notice: ${iconErr.message}`);
    }
  }

  console.log(`\n🎉 Successfully created new extension: examples/${slug}!`);

  // 9. Post-creation actions
  if (parsedArgs.autoUse) {
    console.log(`\n🔄 Activating examples/${slug} in root workspace...`);
    const { execSync } = await import('node:child_process');
    execSync(`node scripts/use.js ${slug}`, { stdio: 'inherit' });
  }

  if (parsedArgs.autoPack) {
    console.log(`\n📦 Building & packaging examples/${slug}...`);
    const { execSync } = await import('node:child_process');
    execSync(`node scripts/pack.js ${slug}`, { stdio: 'inherit' });
  }

  if (!parsedArgs.autoUse && !parsedArgs.autoPack) {
    console.log(`\n👉 Next steps to test:`);
    console.log(`   1. Run in workspace root:    npm run use ${slug} && npm run build`);
    console.log(`   2. Or build as standalone:   npm run build ${slug}`);
    console.log(`   3. Or package to ZIP:        npm run pack ${slug}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Error creating extension:', err.message || err);
  process.exit(1);
});
