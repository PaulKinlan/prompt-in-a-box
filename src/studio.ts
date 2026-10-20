/**
 * Prompt in a Box Studio & Compiler Frontend
 *
 * Full-featured in-extension IDE for creating, editing, live testing,
 * and packaging standalone Chrome Extensions.
 */

import { getConfig, type Config } from './config';
import { CAPABILITIES } from './capabilities';
import { UIRenderer, extractUIBlockFromPrompt } from './ui-renderer';
import {
  compileExtensionProject,
  downloadBlob,
  exportUnpackedToDirectory,
  renderIconPngBlob,
  type ExtensionProjectData,
  type IconBrief,
} from './compiler';
import {
  generateExtensionFromInspiration,
  refinePromptWithAI,
  type InspirationAttachment,
} from './studio-ai';

// ─── Default Starter Templates ─────────────────────────────────────────

const SORTING_HAT_PROMPT = `# Sorting Hat — Intelligent Tab Organizer

Welcome to Sorting Hat! Keep your open tabs tidy, declutter windows, and group related research topics with one click.

\`\`\`ui
{
  "title": "Sorting Hat Dashboard",
  "theme": "glassmorphic",
  "components": [
    { "type": "header", "text": "Tab Organizer" },
    { "type": "text", "text": "Automatically cluster related tabs into colored groups per window." },
    {
      "type": "metrics",
      "metrics": [
        { "label": "Open Tabs", "value": "18", "subvalue": "across 2 windows" },
        { "label": "Groups", "value": "3", "subvalue": "research & docs" }
      ]
    },
    { "type": "alert", "intent": "info", "text": "Ready to sort and organize tabs." },
    {
      "type": "button",
      "id": "btn_sort_tabs",
      "text": "🪄 Sort & Group Tabs Now",
      "intent": "info",
      "action": "trigger-run",
      "payload": { "command": "sort_tabs" }
    },
    { "type": "divider" },
    {
      "type": "action-history",
      "id": "recent_actions",
      "text": "Recent Actions & Undo",
      "limit": 15,
      "showUndoAll": true,
      "undoAllLabel": "Undo Last Action",
      "emptyText": "No actions taken yet."
    }
  ]
}
\`\`\`

## High-Speed Execution via \`code_mode\`
When inspecting or grouping tabs, ALWAYS run an async script via \`code_mode\` instead of taking dozens of serial tool turns.
1. Use \`Promise.all(tabs.map(async tab => ...))\` for parallel data gathering.
2. Check \`tab.canScript\` from \`tab_list\` before calling \`tab_read\`. Skip non-scriptable tabs (discarded, chrome://, or blocked origins) and classify by domain/title.
3. Skip \`tab_read\` on obvious domains (YouTube, GitHub, Google Drive/Mail, Figma, Slack, Jira).
4. Never group tabs across different browser windows. Scope tab operations to \`windowId\`.
5. Never touch or move \`pinned\` or \`active\` tabs.
6. Call \`action_toast({ message: "Tabs grouped successfully", undoLabel: "Undo", badgeText: "UNDO", openPopup: true })\` after batch mutations.
`;

const BOOKMARK_GARDENER_PROMPT = `# Bookmark Gardener — Clean & Organize Links

Declutter your bookmarks, detect duplicate URLs, and archive dead links safely.

\`\`\`ui
{
  "title": "Bookmark Gardener",
  "theme": "default",
  "components": [
    { "type": "header", "text": "Bookmark Hygiene" },
    { "type": "text", "text": "Inspect your bookmarks library to eliminate duplicates and organize folders." },
    {
      "type": "metrics",
      "metrics": [
        { "label": "Total Bookmarks", "value": "142", "subvalue": "in 6 folders" },
        { "label": "Duplicates Found", "value": "0", "subvalue": "all clean" }
      ]
    },
    { "type": "alert", "intent": "success", "text": "Bookmark library is healthy and clean." },
    {
      "type": "button",
      "id": "btn_scan_bookmarks",
      "text": "🌿 Scan & Tidy Bookmarks",
      "intent": "success",
      "action": "trigger-run",
      "payload": { "command": "scan_bookmarks" }
    },
    { "type": "divider" },
    {
      "type": "action-history",
      "id": "recent_actions",
      "text": "Action Journal",
      "limit": 10,
      "showUndoAll": true,
      "undoAllLabel": "Undo Changes"
    }
  ]
}
\`\`\`

## Guidelines
- Call \`bookmark_list\` and \`bookmark_search\` to examine bookmarks.
- Always ask or confirm before deleting bookmarks, or provide instant undo via \`action_toast\`.
`;

const STARTER_PROJECTS: ExtensionProjectData[] = [
  {
    id: 'sorting-hat',
    name: 'Sorting Hat Tab Organizer',
    slug: 'sorting-hat',
    version: '1.0.0',
    description: 'Smart tab organizer that automatically groups related research topics with live action history and instant undo.',
    prompt: SORTING_HAT_PROMPT,
    alarmMinutes: 30,
    permissions: ['storage', 'alarms'],
    optional_permissions: ['tabs', 'tabGroups', 'scripting'],
    agentSettings: [
      { id: 'auto_sort', label: 'Auto-sort on schedule', hint: 'Sort tabs periodically', type: 'boolean', default: true },
      { id: 'group_color', label: 'Color theme', hint: 'Default group color', type: 'select', default: 'purple', options: [{ label: 'Purple', value: 'purple' }, { label: 'Blue', value: 'blue' }] }
    ],
    iconBrief: { symbol: 'wand', colors: ['#8b5cf6', '#d946ef'], styleDescription: 'Magic wand with purple gradient' },
    includeStudio: false,
  },
  {
    id: 'bookmark-gardener',
    name: 'Bookmark Gardener',
    slug: 'bookmark-gardener',
    version: '1.0.0',
    description: 'Declutters browser bookmarks, finds duplicate URLs, and organizes links cleanly.',
    prompt: BOOKMARK_GARDENER_PROMPT,
    alarmMinutes: 60,
    permissions: ['storage', 'alarms'],
    optional_permissions: ['bookmarks'],
    iconBrief: { symbol: 'bookmark', colors: ['#10b981', '#06b6d4'], styleDescription: 'Emerald green bookmark' },
    includeStudio: false,
  },
];

// ─── Studio State ──────────────────────────────────────────────────────

let projects: ExtensionProjectData[] = [];
let currentProject: ExtensionProjectData = STARTER_PROJECTS[0];
let activeEditorTab: 'prompt' | 'manifest' | 'config' | 'tools' = 'prompt';
let activeStudioOverride = false;
let attachments: InspirationAttachment[] = [];
let uiRenderer: UIRenderer | null = null;
let currentConfig: Config | null = null;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const $input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const $textarea = (id: string): HTMLTextAreaElement => document.getElementById(id) as HTMLTextAreaElement;
const $select = (id: string): HTMLSelectElement => document.getElementById(id) as HTMLSelectElement;
const $btn = (id: string): HTMLButtonElement => document.getElementById(id) as HTMLButtonElement;

// ─── Initialization ────────────────────────────────────────────────────

async function initStudio(): Promise<void> {
  currentConfig = await getConfig();

  // Load projects from storage or seed defaults
  const stored = await chrome.storage.local.get(['studioProjects', 'activeStudioProjectId', 'studioLiveOverride']);
  if (Array.isArray(stored.studioProjects) && stored.studioProjects.length > 0) {
    projects = stored.studioProjects;
  } else {
    projects = [...STARTER_PROJECTS];
    await chrome.storage.local.set({ studioProjects: projects });
  }

  const activeId = stored.activeStudioProjectId || projects[0]?.id;
  currentProject = projects.find((p) => p.id === activeId) || projects[0];

  const liveOverride = stored.studioLiveOverride as { enabled?: boolean; projectId?: string } | undefined;
  activeStudioOverride = Boolean(liveOverride?.enabled && liveOverride.projectId === currentProject.id);

  setupPermissionsList();
  renderProjectDropdown();
  loadProjectIntoUI(currentProject);
  updateActiveOverrideButton();
  setupEventListeners();
  setupDragAndDrop();
  renderToolsReference();
  updateLiveUiPreview();
  renderIcons();
}

// ─── Permissions List Rendering ────────────────────────────────────────

function setupPermissionsList(): void {
  const container = $('permissionsCheckboxList');
  container.innerHTML = '';

  for (const cap of CAPABILITIES) {
    const row = document.createElement('label');
    row.style.cssText = 'display: flex; align-items: flex-start; gap: 8px; font-size: 11.5px; font-weight: normal; cursor: pointer; padding: 4px; border-radius: 4px;';
    row.title = cap.hint + ' ' + cap.gates;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = cap.id;
    cb.id = `perm_${cap.id}`;
    cb.style.marginTop = '2px';

    const isReq = (currentProject.permissions || []).includes(cap.id);
    const isOpt = (currentProject.optional_permissions || []).includes(cap.id);
    cb.checked = isReq || isOpt;

    cb.addEventListener('change', () => {
      savePermissionsFromCheckboxes();
    });

    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `<strong>${cap.label}</strong> <span style="font-size: 10px; color: var(--color-text-muted);">(\`${cap.permissions.join(', ')}\`)</span>`;

    row.appendChild(cb);
    row.appendChild(info);
    container.appendChild(row);
  }
}

function savePermissionsFromCheckboxes(): void {
  const container = $('permissionsCheckboxList');
  const checked = Array.from(container.querySelectorAll<HTMLInputElement>('input:checked')).map((i) => i.value);

  // Core permissions required for background loop
  const core = new Set(['storage', 'alarms']);
  const optional: string[] = [];

  for (const id of checked) {
    if (!core.has(id)) {
      optional.push(id);
    }
  }

  currentProject.permissions = Array.from(core);
  currentProject.optional_permissions = optional;
  saveProject();
  if (activeEditorTab === 'manifest') renderCodeEditor();
}

function updatePermissionsCheckboxes(): void {
  const allProjectPerms = new Set([
    ...(currentProject.permissions || []),
    ...(currentProject.optional_permissions || []),
  ]);
  const inputs = $('permissionsCheckboxList').querySelectorAll<HTMLInputElement>('input');
  for (const inp of inputs) {
    inp.checked = allProjectPerms.has(inp.value);
  }
}

// ─── UI Sync & Project Management ──────────────────────────────────────

function renderProjectDropdown(): void {
  const sel = $('projectSelect') as HTMLSelectElement;
  sel.innerHTML = '';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (v${p.version || '1.0.0'})`;
    if (p.id === currentProject.id) opt.selected = true;
    sel.appendChild(opt);
  }
}

function loadProjectIntoUI(p: ExtensionProjectData): void {
  currentProject = p;
  $input('extNameInput').value = p.name || '';
  $input('extSlugInput').value = p.slug || '';
  $input('extAlarmInput').value = String(p.alarmMinutes ?? 30);
  $textarea('extDescInput').value = p.description || '';
  $('versionIndicator').textContent = `v${p.version || '1.0.0'}`;
  $input('checkIncludeStudio').checked = Boolean(p.includeStudio);
  $input('checkLockProvider').checked = Boolean(p.lockProvider);

  if (p.iconBrief) {
    if (p.iconBrief.colors?.[0]) $input('iconColor1').value = p.iconBrief.colors[0];
    if (p.iconBrief.colors?.[1]) $input('iconColor2').value = p.iconBrief.colors[1];
    if (p.iconBrief.symbol) $select('iconSymbolSelect').value = p.iconBrief.symbol;
  }

  updatePermissionsCheckboxes();
  renderCodeEditor();
  renderIcons();
  updateLiveUiPreview();
  checkOverrideStatus();
}

async function saveProject(): Promise<void> {
  currentProject.name = $input('extNameInput').value.trim() || 'Untitled Extension';
  currentProject.slug = $input('extSlugInput').value.trim() || 'untitled-extension';
  currentProject.alarmMinutes = parseInt($input('extAlarmInput').value, 10) || 30;
  currentProject.description = $textarea('extDescInput').value.trim();
  currentProject.includeStudio = $input('checkIncludeStudio').checked;
  currentProject.lockProvider = $input('checkLockProvider').checked;

  currentProject.iconBrief = {
    symbol: $select('iconSymbolSelect').value,
    colors: [$input('iconColor1').value, $input('iconColor2').value],
    styleDescription: `${$select('iconSymbolSelect').value} with gradient`,
  };

  if (activeEditorTab === 'prompt') {
    currentProject.prompt = $textarea('codeEditor').value;
  }

  const idx = projects.findIndex((p) => p.id === currentProject.id);
  if (idx >= 0) {
    projects[idx] = { ...currentProject };
  } else {
    projects.push(currentProject);
  }

  await chrome.storage.local.set({
    studioProjects: projects,
    activeStudioProjectId: currentProject.id,
  });

  // If live override is active, update it
  if (activeStudioOverride) {
    await applyLiveOverride(true);
  }

  flashSavedIndicator();
}

function flashSavedIndicator(): void {
  const el = $('projectSavedIndicator');
  el.style.display = 'inline';
  setTimeout(() => {
    el.style.display = 'none';
  }, 1500);
}

// ─── Live Extension Brain Override ─────────────────────────────────────

async function checkOverrideStatus(): Promise<void> {
  const stored = await chrome.storage.local.get('studioLiveOverride');
  const ov = stored.studioLiveOverride as { enabled?: boolean; projectId?: string } | undefined;
  activeStudioOverride = Boolean(ov?.enabled && ov.projectId === currentProject.id);
  updateActiveOverrideButton();
}

async function toggleLiveOverride(): Promise<void> {
  if (activeStudioOverride) {
    // Disable
    await chrome.storage.local.remove('studioLiveOverride');
    activeStudioOverride = false;
    showToast('Live extension override deactivated (using bundled prompt.md)', 'ok');
  } else {
    // Enable
    await applyLiveOverride(true);
    activeStudioOverride = true;
    showToast(`"${currentProject.name}" is now the live prompt for this extension!`, 'ok');
  }
  updateActiveOverrideButton();
}

async function applyLiveOverride(enabled: boolean): Promise<void> {
  const overrideData = {
    enabled,
    projectId: currentProject.id,
    name: currentProject.name,
    version: currentProject.version,
    prompt: currentProject.prompt,
    config: {
      schedule: { defaultAlarmMinutes: currentProject.alarmMinutes },
      agentSettings: currentProject.agentSettings?.length
        ? {
            storageKey: `${currentProject.slug.replace(/-/g, '_')}_settings`,
            title: `${currentProject.name} Preferences`,
            fields: currentProject.agentSettings,
          }
        : undefined,
    },
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ studioLiveOverride: overrideData });
}

function updateActiveOverrideButton(): void {
  const btn = $('btnActivateLive');
  const text = $('activateLiveText');
  if (activeStudioOverride) {
    btn.classList.add('active');
    text.textContent = 'Active in Extension (Live)';
    btn.title = 'Click to deactivate live override and restore bundled prompt.md';
  } else {
    btn.classList.remove('active');
    text.textContent = 'Activate in Extension';
    btn.title = 'Click to run this project as the active prompt in the extension popup & background loop';
  }
}

// ─── Tabbed Code Editor ────────────────────────────────────────────────

function renderCodeEditor(): void {
  const editor = $('codeEditor') as HTMLTextAreaElement;
  const toolsRef = $('toolsRefView');
  const snippetBar = $('snippetBar');

  if (activeEditorTab === 'tools') {
    editor.style.display = 'none';
    snippetBar.style.display = 'none';
    toolsRef.style.display = 'block';
    return;
  }

  editor.style.display = 'block';
  toolsRef.style.display = 'none';

  if (activeEditorTab === 'prompt') {
    snippetBar.style.display = 'flex';
    editor.value = currentProject.prompt || '';
    editor.readOnly = false;
  } else if (activeEditorTab === 'manifest') {
    snippetBar.style.display = 'none';
    editor.readOnly = false;
    const manifestDraft = {
      manifest_version: 3,
      name: currentProject.name,
      version: currentProject.version,
      description: currentProject.description,
      permissions: currentProject.permissions,
      optional_permissions: currentProject.optional_permissions,
      prompt_in_a_box: {
        prompt: 'prompt.md',
        alarm_minutes: currentProject.alarmMinutes,
        default_provider: currentProject.defaultProvider || 'google',
        default_model: currentProject.defaultModel || 'gemini-3.8-flash',
      },
    };
    editor.value = JSON.stringify(manifestDraft, null, 2);
  } else if (activeEditorTab === 'config') {
    snippetBar.style.display = 'none';
    editor.readOnly = false;
    const configDraft = {
      version: currentProject.version,
      providers: { allowed: ['google', 'anthropic', 'openai'], default: 'google', lockProvider: currentProject.lockProvider },
      models: { default: currentProject.defaultModel || 'gemini-3.8-flash', lockModel: currentProject.lockModel },
      schedule: { defaultAlarmMinutes: currentProject.alarmMinutes, lockSchedule: false },
      ui: { showStudio: currentProject.includeStudio },
      agentSettings: currentProject.agentSettings || [],
    };
    editor.value = JSON.stringify(configDraft, null, 2);
  }

  updateEditorStatus();
}

function updateEditorStatus(): void {
  const text = $textarea('codeEditor').value;
  $('charCount').textContent = `${text.length} chars`;

  if (activeEditorTab === 'prompt') {
    const uiSchema = extractUIBlockFromPrompt(text);
    const uiEl = $('uiValidationStatus');
    if (uiSchema) {
      uiEl.textContent = `UI: Valid (${uiSchema.theme || 'default'})`;
      uiEl.style.color = 'var(--color-success)';
    } else {
      uiEl.textContent = 'UI: None / Incomplete';
      uiEl.style.color = 'var(--color-text-muted)';
    }

    const hasCodeMode = /code_mode/i.test(text);
    const cmEl = $('codeModeStatus');
    cmEl.textContent = hasCodeMode ? 'code_mode: Enabled' : 'code_mode: Missing';
    cmEl.style.color = hasCodeMode ? 'var(--color-success)' : 'var(--color-warning)';
  }
}

// ─── Live Declarative UI Preview ───────────────────────────────────────

function updateLiveUiPreview(): void {
  const container = $('renderedDynamicUi');
  const markdown = activeEditorTab === 'prompt' ? $textarea('codeEditor').value : currentProject.prompt;
  const schema = extractUIBlockFromPrompt(markdown);

  if (!schema) {
    container.innerHTML = `
      <div style="padding: 24px 16px; text-align: center; color: var(--color-text-muted); font-size: 12.5px;">
        <div style="font-size: 24px; margin-bottom: 8px;">🎨</div>
        <strong>No Declarative UI Block Found</strong>
        <p style="margin: 6px 0 12px; font-size: 11.5px;">Include a fenced <code>\`\`\`ui ... \`\`\`</code> JSON block in prompt.md to render an interactive dashboard.</p>
        <button id="btnInsertDefaultUi" class="btn btn-primary" style="font-size: 11.5px; padding: 5px 10px;">Insert Sample UI Block</button>
      </div>
    `;
    const btn = $('btnInsertDefaultUi');
    if (btn) {
      btn.addEventListener('click', () => insertSnippet('ui-block'));
    }
    return;
  }

  container.innerHTML = '';
  uiRenderer = new UIRenderer(container, 'studio-preview');
  uiRenderer.render(schema);
}

// ─── Icon Generation & Canvas Preview ──────────────────────────────────

function renderIcons(): void {
  const brief: IconBrief = {
    symbol: $select('iconSymbolSelect').value,
    colors: [$input('iconColor1').value, $input('iconColor2').value],
  };

  const canvasSizes = [
    { id: 'iconCanvas128', size: 128 },
    { id: 'iconCanvas48', size: 48 },
    { id: 'iconCanvas32', size: 32 },
    { id: 'iconCanvas16', size: 16 },
  ];

  for (const { id, size } of canvasSizes) {
    const c = $(id) as HTMLCanvasElement;
    if (!c) continue;
    renderIconPngBlob(size, brief).then((png) => {
      const blob = new Blob([png as any], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }
}

// ─── Tools & Events Reference Tab ──────────────────────────────────────

function renderToolsReference(): void {
  const container = $('toolsRefView');
  let html = `<h3 style="margin-top: 0; font-size: 14px;">Extension Tools &amp; Permissions Catalog</h3>`;
  html += `<p style="color: var(--color-text-muted); font-size: 12px;">These real Chrome APIs and tools are mapped dynamically to manifest permissions.</p>`;

  for (const cap of CAPABILITIES) {
    html += `
      <div style="background: var(--color-card-base); border: 1px solid var(--color-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <strong style="color: var(--color-accent);">${cap.label}</strong>
          <code style="font-size: 11px; background: var(--color-card-muted); padding: 1px 5px; border-radius: 4px;">${cap.permissions.join(', ')}</code>
        </div>
        <div style="font-size: 11.5px; color: var(--color-text-secondary); margin-bottom: 6px;">${cap.hint}</div>
        <div style="font-size: 11px; font-family: var(--pib-font-mono); color: var(--color-text-muted); background: var(--color-bg-base); padding: 5px 8px; border-radius: 4px;">
          ${cap.gates}
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ─── Snippets ──────────────────────────────────────────────────────────

function insertSnippet(type: string): void {
  const editor = $('codeEditor') as HTMLTextAreaElement;
  let snippet = '';

  switch (type) {
    case 'ui-block':
      snippet = `\`\`\`ui\n{\n  "title": "${currentProject.name} Dashboard",\n  "theme": "glassmorphic",\n  "components": [\n    { "type": "header", "text": "Quick Actions" },\n    { "type": "text", "text": "Execute operations with instant undo." },\n    { "type": "metrics", "metrics": [{ "label": "Active Items", "value": "12" }] },\n    { "type": "button", "id": "btn_run", "text": "⚡ Run Task Now", "intent": "info", "action": "trigger-run" },\n    { "type": "action-history", "id": "recent_actions", "limit": 10, "showUndoAll": true }\n  ]\n}\n\`\`\`\n\n`;
      break;
    case 'code-mode':
      snippet = `\n### Parallel Batching via \`code_mode\`\nWhen performing multi-item operations (e.g. checking 20 tabs), call \`code_mode\` with an async script using \`Promise.all\`. Check \`tab.canScript\` before calling \`tab_read\`, and catch errors per tab.\n`;
      break;
    case 'undo-toast':
      snippet = `\nCall \`action_toast({ message: "Action complete", undoLabel: "Undo", badgeText: "UNDO", openPopup: true })\` after state changes to provide the user an instant single-click undo path.\n`;
      break;
    case 'action-history':
      snippet = `\nPreserve the \`action-history\` component in any \`ui_update\` calls to maintain the live undo log in the popup.\n`;
      break;
    case 'multi-window':
      snippet = `\nAlways scope tab manipulations to \`windowId\`. Never move or group tabs across browser windows. Never unpin pinned tabs.\n`;
      break;
    case 'lifecycle':
      snippet = `\n### Lifecycle Event Handling\n- \`install\`: Bootstrap state and register context menus.\n- \`ui-opened\`: Strictly read-only refresh via \`ui_update\`.\n- \`ui-interaction\`: Handle button clicks, perform actions, and update UI.\n- \`alarm\`: Process periodic background checks.\n`;
      break;
    case 'format-ui':
      formatUiBlock();
      return;
  }

  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const val = editor.value;
  editor.value = val.substring(0, start) + snippet + val.substring(end);
  editor.selectionStart = editor.selectionEnd = start + snippet.length;
  editor.focus();
  saveProject();
  updateLiveUiPreview();
  updateEditorStatus();
}

function formatUiBlock(): void {
  const editor = $('codeEditor') as HTMLTextAreaElement;
  const text = editor.value;
  const match = text.match(/```(?:ui|json\s+ui|json:ui)\s*\n([\s\S]*?)\n```/i);
  if (!match) {
    showToast('No UI block found to format', 'error');
    return;
  }
  try {
    const parsed = JSON.parse(match[1]);
    const formatted = '```ui\n' + JSON.stringify(parsed, null, 2) + '\n```';
    editor.value = text.replace(match[0], formatted);
    saveProject();
    updateLiveUiPreview();
    showToast('Formatted UI JSON block', 'ok');
  } catch (err) {
    showToast(`Invalid JSON in UI block: ${(err as Error).message}`, 'error');
  }
}

// ─── Drag & Drop Inspiration ───────────────────────────────────────────

function setupDragAndDrop(): void {
  const dropzone = $('dropzone');
  const fileInput = $('fileInput') as HTMLInputElement;

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) {
      handleFiles(Array.from(fileInput.files));
    }
  });

  // Support pasting image directly from clipboard
  window.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const f = items[i].getAsFile();
        if (f) pastedFiles.push(f);
      }
    }
    if (pastedFiles.length > 0) {
      handleFiles(pastedFiles);
      showToast(`Pasted ${pastedFiles.length} inspiration file(s)`, 'ok');
    }
  });
}

async function handleFiles(files: File[]): Promise<void> {
  for (const f of files) {
    const isImage = f.type.startsWith('image/');
    const isText = f.name.endsWith('.md') || f.name.endsWith('.txt') || f.name.endsWith('.json') || f.name.endsWith('.svg');

    if (isImage) {
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(f);
      });
      attachments.push({
        name: f.name,
        type: f.type || 'image/png',
        size: f.size,
        dataUrl,
      });
    } else if (isText) {
      const text = await f.text();
      attachments.push({
        name: f.name,
        type: f.type || 'text/plain',
        size: f.size,
        text,
      });
    }
  }
  renderAttachmentChips();
}

function renderAttachmentChips(): void {
  const container = $('attachmentChips');
  container.innerHTML = '';
  attachments.forEach((att, idx) => {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    if (att.dataUrl) {
      const thumb = document.createElement('img');
      thumb.src = att.dataUrl;
      chip.appendChild(thumb);
    }
    const nameSpan = document.createElement('span');
    nameSpan.textContent = att.name;
    chip.appendChild(nameSpan);

    const del = document.createElement('button');
    del.innerHTML = '&times;';
    del.addEventListener('click', () => {
      attachments.splice(idx, 1);
      renderAttachmentChips();
    });
    chip.appendChild(del);
    container.appendChild(chip);
  });
}

// ─── AI Generation & Refinement Workflows ───────────────────────────────

async function handleAiGenerate(): Promise<void> {
  const promptText = $textarea('aiPromptInput').value.trim();
  if (!promptText && attachments.length === 0) {
    showToast('Please describe your idea or attach an inspiration screenshot', 'error');
    return;
  }

  const cfg = await getConfig();
  const provider = cfg.provider;
  const apiKey = cfg.keys[provider];
  if (!apiKey) {
    showToast(`No ${provider} API key configured. Open Settings to set one.`, 'error');
    return;
  }

  const modelId = $select('aiModelSelect').value;
  const progressEl = $('aiProgressText');
  progressEl.style.display = 'block';
  $btn('btnAiGenerate').disabled = true;

  try {
    const blueprint = await generateExtensionFromInspiration({
      provider,
      modelId,
      apiKey,
      userPrompt: promptText,
      attachments,
      onProgress: (status) => {
        progressEl.textContent = status;
      },
    });

    // Populate current project with generated blueprint
    if (blueprint.name) currentProject.name = blueprint.name;
    if (blueprint.slug) currentProject.slug = blueprint.slug;
    if (blueprint.description) currentProject.description = blueprint.description;
    if (blueprint.alarmMinutes !== undefined) currentProject.alarmMinutes = blueprint.alarmMinutes;
    if (blueprint.permissions) currentProject.permissions = blueprint.permissions;
    if (blueprint.optional_permissions) currentProject.optional_permissions = blueprint.optional_permissions;
    if (blueprint.agentSettings) currentProject.agentSettings = blueprint.agentSettings;
    if (blueprint.iconBrief) currentProject.iconBrief = blueprint.iconBrief;
    if (blueprint.prompt) currentProject.prompt = blueprint.prompt;

    loadProjectIntoUI(currentProject);
    await saveProject();

    showToast(`Generated "${currentProject.name}" extension!`, 'ok');
  } catch (err) {
    showToast(`AI Generation failed: ${(err as Error).message}`, 'error');
    console.error(err);
  } finally {
    progressEl.style.display = 'none';
    $btn('btnAiGenerate').disabled = false;
  }
}

async function handleAiRefine(): Promise<void> {
  const promptText = $textarea('aiPromptInput').value.trim();
  if (!promptText) {
    showToast('Enter instructions in the AI prompt box to refine your extension', 'error');
    return;
  }

  const cfg = await getConfig();
  const provider = cfg.provider;
  const apiKey = cfg.keys[provider];
  if (!apiKey) {
    showToast(`No ${provider} API key configured. Open Settings.`, 'error');
    return;
  }

  const modelId = $select('aiModelSelect').value;
  const progressEl = $('aiProgressText');
  progressEl.style.display = 'block';
  $btn('btnAiRefine').disabled = true;

  try {
    const updatedPrompt = await refinePromptWithAI({
      provider,
      modelId,
      apiKey,
      currentPrompt: currentProject.prompt,
      instructions: promptText,
      onProgress: (status) => {
        progressEl.textContent = status;
      },
    });

    currentProject.prompt = updatedPrompt;
    $textarea('codeEditor').value = updatedPrompt;
    await saveProject();
    updateLiveUiPreview();
    updateEditorStatus();
    showToast('Prompt successfully refined with AI!', 'ok');
  } catch (err) {
    showToast(`AI Refinement failed: ${(err as Error).message}`, 'error');
  } finally {
    progressEl.style.display = 'none';
    $btn('btnAiRefine').disabled = false;
  }
}

// ─── Export & Compile Handlers ─────────────────────────────────────────

async function handleCompileZip(): Promise<void> {
  await saveProject();
  showToast('Compiling extension package...', 'ok');
  try {
    const res = await compileExtensionProject(currentProject);
    const filename = `${currentProject.slug || 'extension'}-v${res.version}.zip`;
    downloadBlob(res.zipBlob, filename);
    showToast(`Packaged ${filename} (${(res.zipBlob.size / 1024).toFixed(1)} kB)!`, 'ok');
    $('versionIndicator').textContent = `v${res.version}`;
  } catch (err) {
    showToast(`Packaging failed: ${(err as Error).message}`, 'error');
    console.error(err);
  }
}

async function handleExportFolder(): Promise<void> {
  await saveProject();
  try {
    const res = await compileExtensionProject(currentProject);
    showToast('Select a destination directory on your disk...', 'ok');
    const folderRes = await exportUnpackedToDirectory(res.files, currentProject.slug);
    showToast(`Exported unpacked extension to folder "${folderRes.folderName}"! Click 'Extensions' to load it.`, 'ok');
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    showToast(`Folder export notice: ${(err as Error).message}`, 'error');
  }
}

// ─── Live Test Runner ──────────────────────────────────────────────────

async function runLiveTest(): Promise<void> {
  const trigger = $select('runnerTriggerSelect').value;
  const customUserMessage = $input('runnerCustomMessage').value.trim() || undefined;

  // Make sure live override is active so background executes this project's prompt
  await applyLiveOverride(true);
  activeStudioOverride = true;
  updateActiveOverrideButton();

  $btn('btnRunLiveTest').disabled = true;
  $('runnerConsole').innerHTML = '';
  appendRunnerLog('step-start', `Triggering live run (${trigger})...`);

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'studio-test-run',
      trigger,
      customUserMessage,
    });

    if (res?.error) {
      appendRunnerLog('error', `Run Error: ${res.error}`);
    } else {
      appendRunnerLog('run-complete', `Run complete (${res.status}) in ${res.steps || 1} steps:`, res.summary);
      if (res.tokens?.estimatedCost) {
        appendRunnerLog('step-start', `Cost: $${res.tokens.estimatedCost.toFixed(4)} | Tokens: ${res.tokens.input} in / ${res.tokens.output} out`);
      }
    }
  } catch (err) {
    appendRunnerLog('error', `Failed to execute: ${(err as Error).message}`);
  } finally {
    $btn('btnRunLiveTest').disabled = false;
    updateLiveUiPreview();
  }
}

function appendRunnerLog(channel: string, title: string, data?: unknown): void {
  const consoleEl = $('runnerConsole');
  const div = document.createElement('div');
  div.className = `console-log ${channel}`;
  let text = `[${new Date().toLocaleTimeString()}] ${title}`;
  if (data) {
    text += '\n' + JSON.stringify(data, null, 2);
  }
  div.textContent = text;
  consoleEl.appendChild(div);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ─── Event Listeners ───────────────────────────────────────────────────

function setupEventListeners(): void {
  // Project selection & new project
  $('projectSelect').addEventListener('change', (e) => {
    const selId = (e.target as HTMLSelectElement).value;
    const p = projects.find((x) => x.id === selId);
    if (p) loadProjectIntoUI(p);
  });

  $('btnNewProject').addEventListener('click', () => {
    const id = `project-${Date.now().toString(36)}`;
    const newP: ExtensionProjectData = {
      id,
      name: 'New Custom Agent',
      slug: 'new-custom-agent',
      version: '1.0.0',
      description: 'An autonomous Chrome extension designed with Prompt in a Box.',
      prompt: `# New Custom Agent\n\n\`\`\`ui\n{\n  "title": "Agent Dashboard",\n  "theme": "glassmorphic",\n  "components": [\n    { "type": "header", "text": "Dashboard" },\n    { "type": "button", "id": "btn_go", "text": "⚡ Run", "intent": "info", "action": "trigger-run" }\n  ]\n}\n\`\`\`\n\nPerform actions through granted tools.\n`,
      alarmMinutes: 30,
      permissions: ['storage', 'alarms'],
      optional_permissions: ['tabs'],
      iconBrief: { symbol: 'spark', colors: ['#6366f1', '#a855f7'] },
    };
    projects.push(newP);
    renderProjectDropdown();
    loadProjectIntoUI(newP);
    saveProject();
    showToast('Created new extension project', 'ok');
  });

  $('btnTemplates').addEventListener('click', () => {
    const choice = prompt('Choose a starter template:\n1. Sorting Hat (Smart Tab Organizer)\n2. Bookmark Gardener\n(Enter 1 or 2):');
    if (choice === '1') {
      const p = { ...STARTER_PROJECTS[0], id: `sorting-hat-${Date.now().toString(36)}` };
      projects.push(p);
      renderProjectDropdown();
      loadProjectIntoUI(p);
      saveProject();
    } else if (choice === '2') {
      const p = { ...STARTER_PROJECTS[1], id: `bookmark-gardener-${Date.now().toString(36)}` };
      projects.push(p);
      renderProjectDropdown();
      loadProjectIntoUI(p);
      saveProject();
    }
  });

  // Top header buttons
  $('btnActivateLive').addEventListener('click', toggleLiveOverride);
  $('btnExportFolder').addEventListener('click', handleExportFolder);
  $('btnCompileZip').addEventListener('click', handleCompileZip);
  $('btnOpenExtensions').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions' });
  });

  // Metadata inputs change listeners
  const metaInputs = ['extNameInput', 'extSlugInput', 'extAlarmInput', 'extDescInput', 'iconColor1', 'iconColor2', 'iconSymbolSelect', 'checkIncludeStudio', 'checkLockProvider'];
  for (const id of metaInputs) {
    $(id).addEventListener('input', () => {
      saveProject();
      renderIcons();
    });
  }

  // Code editor tabs
  const tabs = document.querySelectorAll('.editor-tab');
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      activeEditorTab = t.getAttribute('data-tab') as any;
      renderCodeEditor();
    });
  });

  // Code editor typing
  $textarea('codeEditor').addEventListener('input', () => {
    if (activeEditorTab === 'prompt') {
      currentProject.prompt = $textarea('codeEditor').value;
      updateLiveUiPreview();
    }
    updateEditorStatus();
    saveProject();
  });

  // Snippet buttons
  const snippetButtons = document.querySelectorAll('.chip-btn');
  snippetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const snip = btn.getAttribute('data-snippet');
      if (snip) insertSnippet(snip);
    });
  });

  // Right pane subview switch
  $('tabPreview').addEventListener('click', () => {
    $('tabPreview').classList.add('active');
    $('tabRunner').classList.remove('active');
    $('previewContainer').style.display = 'block';
    $('runnerContainer').style.display = 'none';
  });

  $('tabRunner').addEventListener('click', () => {
    $('tabRunner').classList.add('active');
    $('tabPreview').classList.remove('active');
    $('previewContainer').style.display = 'none';
    $('runnerContainer').style.display = 'flex';
  });

  // AI buttons
  $('btnAiGenerate').addEventListener('click', handleAiGenerate);
  $('btnAiRefine').addEventListener('click', handleAiRefine);

  // Live test runner
  $('btnRunLiveTest').addEventListener('click', runLiveTest);

  // Listen for agent logs broadcast from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'agent-log' && msg.event) {
      appendRunnerLog(msg.event.channel || 'step-start', msg.event.title || '', msg.event.data);
    }
  });
}

function showToast(msg: string, type: 'ok' | 'error' = 'ok'): void {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  setTimeout(() => {
    t.className = 'toast';
  }, 3500);
}

// ─── Entry Point ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initStudio().catch((err) => {
    console.error('Studio initialization error:', err);
  });
});
