/**
 * Dynamic Tool & Event Registry Scanner
 *
 * Scans the TypeScript source code of prompt-in-a-box (src/tools/ and src/events/)
 * to extract a complete, canonical catalogue of all granted tools, Zod schemas,
 * permissions, and Chrome event sources.
 */
import fs from 'node:fs';
import path from 'node:path';

const KNOWN_ALIASES = {
  run_code: 'code_mode',
  read_page: 'tab_read',
  get_state: 'storage_get',
  set_state: 'storage_set',
  notify: 'notification_show',
  undo_action: 'action_undo',
};

/**
 * Scans src/tools/index.ts and individual tool files to extract every real tool.
 */
export function scanTools(rootDir = process.cwd()) {
  const toolsDir = path.join(rootDir, 'src/tools');
  const indexFile = path.join(toolsDir, 'index.ts');

  if (!fs.existsSync(indexFile)) {
    return [];
  }

  const indexContent = fs.readFileSync(indexFile, 'utf8');

  // 1. Parse import statements to map symbol names to source filenames
  // e.g. import { findElements, clickElement } from './page-action';
  const importMap = new Map(); // symbol -> filename (relative to src/tools)
  const importRegex = /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/([^'"]+)['"]/g;
  let impMatch;
  while ((impMatch = importRegex.exec(indexContent)) !== null) {
    const rawSymbols = impMatch[1];
    const fileBase = impMatch[2];
    const symbols = rawSymbols
      .split(',')
      .map((s) => s.trim().replace(/^type\s+/, ''))
      .filter(Boolean);
    for (const sym of symbols) {
      importMap.set(sym, `${fileBase}.ts`);
    }
  }

  // 2. Parse TOOLS_BY_PERMISSION mapping
  // permission: { tool_name: symbolName, ... }
  const toolsToPermission = new Map(); // toolName -> { permission, symbolName }
  const blockRegex = /(['"]?[\w.-]+['"]?|__always__):\s*\{([\s\S]*?)\}/g;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(indexContent)) !== null) {
    let perm = blockMatch[1].replace(/['"]/g, '');
    const blockBody = blockMatch[2];
    const entryRegex = /(\w+):\s*(\w+)/g;
    let entryMatch;
    while ((entryMatch = entryRegex.exec(blockBody)) !== null) {
      const toolName = entryMatch[1];
      const symbolName = entryMatch[2];
      toolsToPermission.set(toolName, {
        permission: perm === '__always__' ? 'None (Always available)' : perm,
        symbolName,
      });
    }
  }

  // 3. Cache read tool files to extract descriptions and schemas
  const fileCache = new Map();
  function getFileContent(fileName) {
    if (!fileCache.has(fileName)) {
      const fullPath = path.join(toolsDir, fileName);
      if (fs.existsSync(fullPath)) {
        fileCache.set(fileName, fs.readFileSync(fullPath, 'utf8'));
      } else {
        fileCache.set(fileName, '');
      }
    }
    return fileCache.get(fileName);
  }

  const results = [];
  const seenCanonical = new Set();

  for (const [toolName, info] of toolsToPermission.entries()) {
    // If it's an alias, note it on the canonical tool instead of duplicating
    const isAlias = Boolean(KNOWN_ALIASES[toolName]);
    const canonicalName = KNOWN_ALIASES[toolName] || toolName;

    if (isAlias && seenCanonical.has(canonicalName)) {
      continue;
    }

    const fileName = importMap.get(info.symbolName);
    let description = 'Granted extension tool.';
    let parametersStr = 'No parameters';

    if (fileName) {
      const content = getFileContent(fileName);
      if (content) {
        // Find the definition: export const <symbolName> = tool({ ... })
        const symRegex = new RegExp(
          `(?:export\\s+const\\s+${info.symbolName}\\s*=\\s*tool\\s*\\(\\{[\\s\\S]*?\\}\\);?)`,
          'm',
        );
        const match = content.match(symRegex);
        const toolSnippet = match ? match[0] : content;

        // Extract description
        const descMatch = toolSnippet.match(/description:\s*['"`]([\s\S]*?)['"`]/);
        if (descMatch) {
          description = descMatch[1].trim().replace(/\s+/g, ' ');
        }

        // Extract inputSchema
        const schemaMatch = toolSnippet.match(/inputSchema:\s*(?:z|external_exports2)\.object\(\{([\s\S]*?)\}\)/);
        if (schemaMatch) {
          parametersStr = schemaMatch[1]
            .trim()
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .join('\n    ');
        }
      }
    }

    results.push({
      name: canonicalName,
      permission: info.permission,
      description,
      parameters: parametersStr,
      aliases: Object.entries(KNOWN_ALIASES)
        .filter(([, canon]) => canon === canonicalName)
        .map(([alias]) => alias),
    });

    seenCanonical.add(canonicalName);
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Scans src/events/registry.ts to extract all supported event triggers.
 */
export function scanEvents(rootDir = process.cwd()) {
  const registryFile = path.join(rootDir, 'src/events/registry.ts');
  if (!fs.existsSync(registryFile)) {
    return { immediate: [], queued: [] };
  }

  const content = fs.readFileSync(registryFile, 'utf8');
  const eventRegex = /source\(\s*['"]([^'"]+)['"]\s*,\s*(null|['"][^'"]+['"])\s*,\s*(true|false)/g;

  const immediate = [];
  const queued = [];

  let match;
  while ((match = eventRegex.exec(content)) !== null) {
    const id = match[1];
    const permRaw = match[2];
    const triggersRun = match[3] === 'true';
    const permission = permRaw === 'null' ? 'None (Always on)' : permRaw.replace(/['"]/g, '');

    const entry = { id, permission, triggersRun };
    if (triggersRun) {
      immediate.push(entry);
    } else {
      queued.push(entry);
    }
  }

  return { immediate, queued };
}

/**
 * Generates a concise capability summary table for fast intent analysis.
 */
export function generateCompactCapabilitySummary(rootDir = process.cwd()) {
  const tools = scanTools(rootDir);
  const events = scanEvents(rootDir);

  let doc = '# Available Extension Tools & Events Summary\n\n';
  doc += '### Granted Tools by Chrome Permission:\n';
  doc += '| Tool Name | Required Permission | Description |\n';
  doc += '|---|---|---|\n';
  for (const t of tools) {
    const aliasNote = t.aliases.length > 0 ? ` (alias: ${t.aliases.join(', ')})` : '';
    doc += `| \`${t.name}\` | \`${t.permission}\` | ${t.description}${aliasNote} |\n`;
  }

  doc += '\n### Immediate Events (wakes run immediately):\n';
  for (const ev of events.immediate) {
    doc += `- \`${ev.id}\` (permission: \`${ev.permission}\`)\n`;
  }

  doc += '\n### Queued Events (delivered on alarm ticks):\n';
  for (const ev of events.queued) {
    doc += `- \`${ev.id}\` (permission: \`${ev.permission}\`)\n`;
  }

  return doc;
}

/**
 * Generates an authoritative Markdown reference of the extension capabilities.
 */
export function generateCapabilityReference(rootDir = process.cwd(), relevantPermissions = null) {
  const tools = scanTools(rootDir);
  const events = scanEvents(rootDir);

  const permFilter = relevantPermissions
    ? new Set([...relevantPermissions, 'None (Always available)', '__always__'])
    : null;

  let doc = '# Prompt in a Box — Project Capabilities Reference\n\n';
  doc +=
    'Every tool below is mapped to its gating Chrome permission and parameter schema. When writing `prompt.md` and `manifest.json`, you **must only reference these exact tools, events, and parameters**.\n\n';

  doc += '## 1. Tool Registry (Available Tools)\n\n';
  doc += '| Tool Name | Required Chrome Permission | Description |\n';
  doc += '|---|---|---|\n';

  for (const t of tools) {
    const aliasNote = t.aliases.length > 0 ? ` *(aliases: ${t.aliases.map((a) => `\`${a}\``).join(', ')})*` : '';
    doc += `| \`${t.name}\` | \`${t.permission}\` | ${t.description}${aliasNote} |\n`;
  }

  doc += '\n### Detailed Tool Parameter Schemas\n\n';
  for (const t of tools) {
    if (permFilter && !permFilter.has(t.permission)) {
      continue;
    }
    doc += `#### \`${t.name}\`\n`;
    doc += `- **Required Permission**: \`${t.permission}\`\n`;
    doc += `- **Description**: ${t.description}\n`;
    if (t.aliases.length > 0) {
      doc += `- **Supported Aliases**: ${t.aliases.map((a) => `\`${a}\``).join(', ')}\n`;
    }
    doc += `- **Schema**:\n\`\`\`typescript\n${t.parameters}\n\`\`\`\n\n`;
  }

  doc += '## 2. Event Sources Registry\n\n';
  doc += 'The background service worker can subscribe to Chrome events and dispatch them to the agent prompt.\n\n';
  doc += '### Immediate Trigger Events (Wakes the agent run NOW)\n';
  doc += '| Event ID | Required Permission | Description |\n';
  doc += '|---|---|---|\n';
  for (const ev of events.immediate) {
    doc += `| \`${ev.id}\` | \`${ev.permission}\` | Fires immediately when user acts (context menu, notification click, command, omnibox, idle state) |\n`;
  }

  doc += '\n### Queued Ambient Events (Accumulate in queue and deliver on next tick/alarm)\n';
  doc += '| Event ID | Required Permission | Description |\n';
  doc += '|---|---|---|\n';
  for (const ev of events.queued) {
    doc += `| \`${ev.id}\` | \`${ev.permission}\` | Queues and is passed into the prompt as "Events since last run" |\n`;
  }

  doc += `
## 3. Declarative UI Specification (\`\`\`ui\`\`\`)

The extension's popup and sidepanel render dynamic UI views either declaratively from a fenced JSON block in \`prompt.md\` or dynamically via the \`ui_update\` tool.

\`\`\`json
\`\`\`ui
{
  "title": "Clean Extension Title",
  "theme": "glassmorphic", // "default" | "glassmorphic" | "compact"
  "components": [
    { "type": "header", "text": "Section Title" },
    { "type": "text", "text": "Descriptive subtitle or instruction" },
    {
      "type": "metrics",
      "metrics": [
        { "label": "Active Items", "value": "12", "subvalue": "across 2 windows" }
      ]
    },
    { "type": "alert", "intent": "info", "text": "Status notification" }, // "info" | "success" | "warning" | "danger"
    { "type": "input", "id": "search_filter", "text": "Filter query", "placeholder": "Search..." },
    {
      "type": "button",
      "id": "btn_action_now",
      "text": "⚡ Run Action Now",
      "intent": "info",
      "action": "trigger-run", // "trigger-run" | "chrome-api" | "undo-last" | "undo-action"
      "payload": { "command": "execute_task" }
    },
    { "type": "divider" },
    {
      "type": "action-history",
      "id": "recent_actions",
      "text": "Recent Actions",
      "limit": 15,
      "showUndoAll": true,
      "undoAllLabel": "Undo Last Action",
      "emptyText": "No actions recorded yet."
    }
  ]
}
\`\`\`
\`\`\`

## 4. Sandboxed Code Mode (\`code_mode\`) Best Practices

When dealing with batches of items (e.g. checking 20 tabs, filtering bookmarks, grouping multiple tabs), **do not make separate round-trip LLM tool calls**. Instead, call \`code_mode\` with an async script:
1. Use \`Promise.all(tabs.map(async tab => ...))\` for parallel execution.
2. Check \`tab.canScript\` before calling \`tab_read\`. Skip non-scriptable tabs (\`discarded\`, \`chrome://\`, blocked origins) and classify by domain/title.
3. Skip \`tab_read\` for unambiguous domains (YouTube, GitHub, Google Drive/Mail, Figma, Slack, Jira) to save latency.
4. Call \`tab_read({ tabId: tab.id, maxLength: 500 })\` with \`try/catch\` only on ambiguous pages.
5. Return a distilled summary array/object at the end of the script.
6. Reusable routines can be saved via \`saveAs: "routine_name"\` and re-executed via \`scriptName: "routine_name"\`.

## 5. Multi-Window, Etiquette & Reversible Undo Rules

- **Multi-Window Isolation**: Always preserve \`windowId\`. Never group or move tabs across different windows.
- **Respect User Focus**: Never move or disrupt the currently \`active\` tab.
- **Ignore Pinned Tabs**: Never unpin or rearrange tabs where \`pinned === true\`.
- **Preserve Group State**: When adding tabs to an existing group, maintain \`collapsed\` state. Never expand collapsed groups unless they contain the active tab.
- **Action Toast & Undo**: Call \`action_toast({ message, undoLabel: "Undo Action", badgeText: "UNDO", openPopup: true })\` after major operations.
`.trim();

  return doc;
}
