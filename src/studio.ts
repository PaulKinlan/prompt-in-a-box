/**
 * Prompt in a Box Studio & Compiler Frontend
 *
 * Full-featured in-extension IDE for creating, editing, live testing,
 * and packaging standalone Chrome Extensions.
 */

import { getConfig, type Config } from './config';
import { CAPABILITIES } from './capabilities';
import { UIRenderer, extractUIBlockFromPrompt, sanitizeJsonStringLiterals, normalizeThemeName } from './ui-renderer';
import generatedExamples from './generated-examples.json';
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
  generateIconWithAI,
  generateThemeStyleWithAI,
  resolveImageModelId,
  DEFAULT_ICON_MODEL,
  chatRefineProjectWithAI,
  type InspirationAttachment,
  type ChatTurn,
} from './studio-ai';
import { type AgentLogEvent, type AgentLogChannel } from './logger';

// ─── Default Starter Templates ─────────────────────────────────────────

const SORTING_HAT_PROMPT = `# Sorting Hat — Intelligent Tab Organizer

Welcome to Sorting Hat! Keep your open tabs tidy, declutter windows, and group related research topics with one click.

\`\`\`ui
{
  "title": "Sorting Hat Dashboard",
  "theme": "compact",
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
      "text": "Sort & Group Tabs Now",
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
  "theme": "warm-paper",
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
      "text": "Scan & Tidy Bookmarks",
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
    host_permissions: ['<all_urls>'],
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
    host_permissions: ['<all_urls>'],
    iconBrief: { symbol: 'bookmark', colors: ['#10b981', '#06b6d4'], styleDescription: 'Emerald green bookmark' },
    includeStudio: false,
  },
];

// Merge generated examples catalog with starter projects, deduplicating by slug
const ALL_STARTER_TEMPLATES: ExtensionProjectData[] = (() => {
  const seen = new Set<string>();
  const list: ExtensionProjectData[] = [];
  const baseList: ExtensionProjectData[] = [
    ...STARTER_PROJECTS,
    ...(generatedExamples as any[]).map((ex) => ({
      id: ex.id || `example-${ex.slug}`,
      name: ex.name,
      slug: ex.slug,
      version: '1.0.0',
      description: ex.description,
      prompt: ex.prompt,
      alarmMinutes: ex.alarmMinutes ?? 30,
      permissions: ex.permissions || ['storage', 'alarms'],
      optional_permissions: ex.optional_permissions || [],
      host_permissions: ex.host_permissions || ['<all_urls>'],
      agentSettings: ex.agentSettings,
      uiConfig: ex.uiConfig,
      iconBrief: { symbol: 'spark', colors: ['#6366f1', '#a855f7'] },
      includeStudio: false,
    })),
  ];

  for (const item of baseList) {
    if (!seen.has(item.slug)) {
      seen.add(item.slug);
      list.push(item);
    }
  }
  return list;
})();

let slugManuallyEdited = false;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled-extension';
}

// ─── Studio State ──────────────────────────────────────────────────────

interface EditorUndoSnapshot {
  promptText: string;
  hostPermissions: string[];
  optionalPermissions: string[];
  tab: string;
}

interface ChatMessageWithUndo {
  role: 'user' | 'assistant';
  content: string;
  appliedChange?: {
    summary: string;
    undoSnapshot: EditorUndoSnapshot;
  };
}

let projects: ExtensionProjectData[] = [];
let currentProject: ExtensionProjectData = STARTER_PROJECTS[0];
let activeEditorTab: 'prompt' | 'manifest' | 'config' | 'tools' = 'prompt';
let activeStudioOverride = false;
let attachments: InspirationAttachment[] = [];
let uiRenderer: UIRenderer | null = null;
let currentConfig: Config | null = null;

// Editor Undo / Redo Stacks
const editorUndoStack: EditorUndoSnapshot[] = [];
const editorRedoStack: EditorUndoSnapshot[] = [];

// Structured Live Test Runner Telemetry Log Buffer
const runnerLogEntries: AgentLogEvent[] = [];

// Interactive AI Refine Chat History
const chatHistory: ChatTurn[] = [];
const chatUiMessages: ChatMessageWithUndo[] = [];

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
  renderHostPermissionsUI();
  updateUndoRedoButtons();
  renderRunnerLogs();
  renderChatMessages();
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

  const myGroup = document.createElement('optgroup');
  myGroup.label = 'My Projects';
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (v${p.version || '1.0.0'})`;
    if (p.id === currentProject.id) opt.selected = true;
    myGroup.appendChild(opt);
  }
  sel.appendChild(myGroup);

  const tplGroup = document.createElement('optgroup');
  tplGroup.label = `Starter Templates (${ALL_STARTER_TEMPLATES.length} Examples)...`;

  for (const tpl of ALL_STARTER_TEMPLATES) {
    const opt = document.createElement('option');
    opt.value = `template:${tpl.slug}`;
    opt.textContent = `+ ${tpl.name}`;
    tplGroup.appendChild(opt);
  }

  sel.appendChild(tplGroup);
}

function loadProjectIntoUI(p: ExtensionProjectData): void {
  currentProject = p;
  slugManuallyEdited = false;
  if (!currentProject.host_permissions || currentProject.host_permissions.length === 0) {
    currentProject.host_permissions = ['<all_urls>'];
  }
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
    if (p.iconBrief.artStyle) $select('iconArtStyleSelect').value = p.iconBrief.artStyle;
    if (p.iconBrief.styleDescription) $textarea('iconStyleInput').value = p.iconBrief.styleDescription;
    if (p.iconBrief.clipSquircle !== undefined) $input('iconClipSquircle').checked = p.iconBrief.clipSquircle;

    const modelVal = p.iconBrief.model || DEFAULT_ICON_MODEL;
    const modelOpts = Array.from($select('iconModelSelect').options).map((o) => o.value);
    if (modelOpts.includes(modelVal)) {
      $select('iconModelSelect').value = modelVal;
      $('iconCustomModelRow').style.display = 'none';
    } else {
      $select('iconModelSelect').value = 'custom';
      $input('iconCustomModelInput').value = modelVal;
      $('iconCustomModelRow').style.display = 'block';
    }

    const hasCustomImage = Boolean(p.iconBrief.customImageDataUrl && p.iconBrief.mode !== 'vector');
    $('iconModeBadge').textContent = hasCustomImage
      ? p.iconBrief.mode === 'upload'
        ? 'Uploaded Image'
        : `AI (${p.iconBrief.model || DEFAULT_ICON_MODEL})`
      : 'Vector Glyph';
    $('btnResetVectorIcon').style.display = hasCustomImage ? 'inline-flex' : 'none';
  } else {
    $select('iconModelSelect').value = DEFAULT_ICON_MODEL;
    $select('iconArtStyleSelect').value = 'flat-vector';
    $textarea('iconStyleInput').value = '';
    $('iconModeBadge').textContent = 'Vector Glyph';
    $('btnResetVectorIcon').style.display = 'none';
    $('iconCustomModelRow').style.display = 'none';
  }

  // Shell UI options
  const ui = p.uiConfig || {};
  $input('uiShowPopupHeader').checked = ui.showPopupHeader !== false;
  $input('uiShowStatusCard').checked = ui.showStatusCard !== false;
  $input('uiShowViewSwitcher').checked = ui.showViewSwitcher !== false;
  $input('uiShowCosts').checked = ui.showCosts !== false;
  $input('uiShowHistory').checked = ui.showHistory !== false;
  $input('uiAllowSidePanel').checked = ui.allowSidePanel !== false;
  $input('uiAllowArtifacts').checked = ui.allowArtifacts !== false;
  $input('uiShowScheduleSummary').checked = ui.showScheduleSummary !== false;

  // Visual Dashboard UI Toolbar
  const schema = extractUIBlockFromPrompt(p.prompt || '');
  if (schema) {
    if ($select('uiThemeSelect')) {
      $select('uiThemeSelect').value = normalizeThemeName(schema.theme || 'compact');
    }
    if ($select('uiLayoutModeSelect')) {
      $select('uiLayoutModeSelect').value = (schema as any).layoutMode || 'bento-grid';
    }
    if ($input('uiTitleInput')) {
      $input('uiTitleInput').value = schema.title || `${p.name} Dashboard`;
    }
    if (schema.themeConfig?.accentColor && $input('uiAccentColorInput')) {
      $input('uiAccentColorInput').value = schema.themeConfig.accentColor;
    }
  }

  updatePermissionsCheckboxes();
  renderHostPermissionsUI();
  renderCodeEditor();
  renderIcons();
  updateLiveUiPreview();
  checkOverrideStatus();
  if ($('chatActiveProjectName')) {
    $('chatActiveProjectName').textContent = p.name || 'Current Project';
  }
}

async function saveProject(): Promise<void> {
  currentProject.name = $input('extNameInput').value.trim() || 'Untitled Extension';
  currentProject.slug = $input('extSlugInput').value.trim() || 'untitled-extension';
  const parsedAlarm = parseInt($input('extAlarmInput').value, 10);
  currentProject.alarmMinutes = Number.isNaN(parsedAlarm) ? 30 : Math.max(0, parsedAlarm);
  currentProject.description = $textarea('extDescInput').value.trim();
  currentProject.includeStudio = $input('checkIncludeStudio').checked;
  currentProject.lockProvider = $input('checkLockProvider').checked;

  const chosenModel =
    $select('iconModelSelect').value === 'custom'
      ? $input('iconCustomModelInput').value.trim() || DEFAULT_ICON_MODEL
      : $select('iconModelSelect').value;

  currentProject.iconBrief = {
    ...currentProject.iconBrief,
    model: chosenModel,
    artStyle: $select('iconArtStyleSelect').value as any,
    styleDescription: $textarea('iconStyleInput').value.trim(),
    symbol: $select('iconSymbolSelect').value,
    colors: [$input('iconColor1').value, $input('iconColor2').value],
    clipSquircle: $input('iconClipSquircle').checked,
  };

  currentProject.uiConfig = {
    showPopupHeader: $input('uiShowPopupHeader').checked,
    showStatusCard: $input('uiShowStatusCard').checked,
    showViewSwitcher: $input('uiShowViewSwitcher').checked,
    showCosts: $input('uiShowCosts').checked,
    showHistory: $input('uiShowHistory').checked,
    allowSidePanel: $input('uiAllowSidePanel').checked,
    allowArtifacts: $input('uiAllowArtifacts').checked,
    showScheduleSummary: $input('uiShowScheduleSummary').checked,
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
    await chrome.runtime.sendMessage({ type: 'reschedule-alarm' }).catch(() => {});
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
      ui: { ...(currentProject.uiConfig || {}), showStudio: true },
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
  await chrome.storage.local.set({
    studioLiveOverride: overrideData,
    alarmMinutes: currentProject.alarmMinutes,
  });
  await chrome.runtime.sendMessage({ type: 'reschedule-alarm' }).catch(() => {});
}

function updateActiveOverrideButton(): void {
  const btn = $('btnActivateLive');
  const text = $('activateLiveText');
  if (activeStudioOverride) {
    btn.classList.add('active');
    text.textContent = 'Active (Live)';
    btn.title = 'Click to deactivate live override and restore bundled prompt.md';
  } else {
    btn.classList.remove('active');
    text.textContent = 'Activate';
    btn.title = 'Click to run this project as the active prompt in the extension popup & background loop';
  }
}

// ─── Website & URL Access (host_permissions) ──────────────────────────

function renderHostPermissionsUI(): void {
  if (!currentProject.host_permissions) {
    currentProject.host_permissions = ['<all_urls>'];
  }

  const checkAll = $input('checkAllUrls');
  if (checkAll) {
    checkAll.checked = currentProject.host_permissions.includes('<all_urls>');
  }

  const container = $('hostPermissionsList');
  if (!container) return;
  container.innerHTML = '';

  const nonAllUrls = currentProject.host_permissions.filter((p) => p !== '<all_urls>');
  if (nonAllUrls.length === 0 && !currentProject.host_permissions.includes('<all_urls>')) {
    container.innerHTML = '<span style="font-size: 10.5px; color: var(--color-warning);">⚠️ No website origins granted. Tab reading and scripting will be restricted.</span>';
    return;
  }

  for (const pat of nonAllUrls) {
    const chip = document.createElement('div');
    chip.className = 'attachment-chip';
    chip.style.cssText = 'font-family: var(--pib-font-mono); font-size: 11px;';
    chip.innerHTML = `<span>${escapeHtml(pat)}</span>`;
    const btnDel = document.createElement('button');
    btnDel.innerHTML = '&times;';
    btnDel.title = `Remove ${pat}`;
    btnDel.addEventListener('click', () => {
      currentProject.host_permissions = (currentProject.host_permissions || []).filter((x) => x !== pat);
      saveProject();
      renderHostPermissionsUI();
      if (activeEditorTab === 'manifest') renderCodeEditor();
    });
    chip.appendChild(btnDel);
    container.appendChild(chip);
  }
}

// ─── Editor Undo / Redo ────────────────────────────────────────────────

function pushEditorUndoSnapshot(): void {
  const currentPrompt = activeEditorTab === 'prompt' ? $textarea('codeEditor').value : currentProject.prompt || '';
  editorUndoStack.push({
    promptText: currentPrompt,
    hostPermissions: [...(currentProject.host_permissions || ['<all_urls>'])],
    optionalPermissions: [...(currentProject.optional_permissions || [])],
    tab: activeEditorTab,
  });
  if (editorUndoStack.length > 50) {
    editorUndoStack.shift();
  }
  editorRedoStack.length = 0;
  updateUndoRedoButtons();
}

function updateUndoRedoButtons(): void {
  const undoBtn = $btn('btnEditorUndo');
  const redoBtn = $btn('btnEditorRedo');
  if (undoBtn) undoBtn.disabled = editorUndoStack.length === 0;
  if (redoBtn) redoBtn.disabled = editorRedoStack.length === 0;
}

function performEditorUndo(): void {
  if (editorUndoStack.length === 0) return;
  const currentPrompt = activeEditorTab === 'prompt' ? $textarea('codeEditor').value : currentProject.prompt || '';
  editorRedoStack.push({
    promptText: currentPrompt,
    hostPermissions: [...(currentProject.host_permissions || ['<all_urls>'])],
    optionalPermissions: [...(currentProject.optional_permissions || [])],
    tab: activeEditorTab,
  });

  const snap = editorUndoStack.pop()!;
  currentProject.prompt = snap.promptText;
  currentProject.host_permissions = snap.hostPermissions;
  currentProject.optional_permissions = snap.optionalPermissions;

  if (activeEditorTab === 'prompt') {
    $textarea('codeEditor').value = snap.promptText;
  }
  saveProject();
  updateLiveUiPreview();
  updateEditorStatus();
  renderHostPermissionsUI();
  updatePermissionsCheckboxes();
  updateUndoRedoButtons();
  showToast('Undo', 'ok');
}

function performEditorRedo(): void {
  if (editorRedoStack.length === 0) return;
  const currentPrompt = activeEditorTab === 'prompt' ? $textarea('codeEditor').value : currentProject.prompt || '';
  editorUndoStack.push({
    promptText: currentPrompt,
    hostPermissions: [...(currentProject.host_permissions || ['<all_urls>'])],
    optionalPermissions: [...(currentProject.optional_permissions || [])],
    tab: activeEditorTab,
  });

  const snap = editorRedoStack.pop()!;
  currentProject.prompt = snap.promptText;
  currentProject.host_permissions = snap.hostPermissions;
  currentProject.optional_permissions = snap.optionalPermissions;

  if (activeEditorTab === 'prompt') {
    $textarea('codeEditor').value = snap.promptText;
  }
  saveProject();
  updateLiveUiPreview();
  updateEditorStatus();
  renderHostPermissionsUI();
  updatePermissionsCheckboxes();
  updateUndoRedoButtons();
  showToast('Redo', 'ok');
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
      host_permissions: currentProject.host_permissions || ['<all_urls>'],
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
      ui: { ...(currentProject.uiConfig || {}), showStudio: currentProject.includeStudio },
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
        <div style="font-size: 13px; font-weight: 700; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em;">No UI Block Found</div>
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
  const brief: IconBrief = currentProject.iconBrief || {
    symbol: $select('iconSymbolSelect').value,
    colors: [$input('iconColor1').value, $input('iconColor2').value],
    clipSquircle: $input('iconClipSquircle').checked,
  };

  const dpr = window.devicePixelRatio || 1;
  const canvasConfigs = [
    { id: 'iconCanvas512', size: 512, displaySize: 56 },
    { id: 'iconCanvas128', size: 128, displaySize: 44 },
    { id: 'iconCanvas48', size: 48, displaySize: 32 },
    { id: 'iconCanvas16', size: 16, displaySize: 16 },
  ];

  for (const { id, size, displaySize } of canvasConfigs) {
    const c = $(id) as HTMLCanvasElement;
    if (!c) continue;

    c.width = Math.round(displaySize * dpr);
    c.height = Math.round(displaySize * dpr);
    c.style.width = `${displaySize}px`;
    c.style.height = `${displaySize}px`;

    renderIconPngBlob(size, brief).then((png) => {
      const blob = new Blob([png as any], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, c.width, c.height);
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  }
}

// ─── AI Icon Generation ────────────────────────────────────────────────

async function handleGenerateAiIcon(): Promise<void> {
  const cfg = await getConfig();
  const progressEl = $('iconAiProgressText');
  progressEl.style.display = 'block';
  $btn('btnGenerateAiIcon').disabled = true;

  try {
    await saveProject();
    const res = await generateIconWithAI({
      name: currentProject.name,
      description: currentProject.description,
      iconBrief: currentProject.iconBrief,
      keys: cfg.keys,
      onProgress: (status) => {
        progressEl.textContent = status;
      },
    });

    currentProject.iconBrief = {
      ...currentProject.iconBrief,
      customImageDataUrl: res.dataUrl,
      mode: 'ai',
      model: res.modelUsed,
    };

    $('iconModeBadge').textContent = `AI (${res.modelUsed})`;
    $('btnResetVectorIcon').style.display = 'inline-flex';
    renderIcons();
    await saveProject();
    showToast(`Generated AI icon with ${res.modelUsed}!`, 'ok');
  } catch (err) {
    showToast(`Icon generation failed: ${(err as Error).message}`, 'error');
    console.error(err);
  } finally {
    progressEl.style.display = 'none';
    $btn('btnGenerateAiIcon').disabled = false;
  }
}

// ─── Visual UI Mutator ─────────────────────────────────────────────────

function mutatePromptUiBlock(mutator: (uiObj: Record<string, any>) => void): void {
  pushEditorUndoSnapshot();
  const currentPrompt = activeEditorTab === 'prompt' ? $textarea('codeEditor').value : currentProject.prompt || '';
  const match = currentPrompt.match(/```(?:ui|json\s+ui|json:ui)\s*\n([\s\S]*?)\n```/i);

  let uiObj: Record<string, any>;
  if (match) {
    try {
      uiObj = JSON.parse(sanitizeJsonStringLiterals(match[1]));
    } catch {
      uiObj = {
        title: `${currentProject.name} Dashboard`,
        theme: 'glassmorphic',
        components: [],
      };
    }
  } else {
    uiObj = {
      title: `${currentProject.name} Dashboard`,
      theme: 'glassmorphic',
      components: [],
    };
  }

  if (!Array.isArray(uiObj.components)) {
    uiObj.components = Array.isArray(uiObj.layout) ? uiObj.layout : [];
  }

  mutator(uiObj);

  // Keep components and layout synced
  uiObj.layout = uiObj.components;

  const formattedBlock = '```ui\n' + JSON.stringify(uiObj, null, 2) + '\n```';
  let updatedPrompt: string;
  if (match) {
    updatedPrompt = currentPrompt.replace(match[0], formattedBlock);
  } else {
    updatedPrompt = `${formattedBlock}\n\n${currentPrompt}`;
  }

  currentProject.prompt = updatedPrompt;
  if (activeEditorTab === 'prompt') {
    $textarea('codeEditor').value = updatedPrompt;
  }
  updateLiveUiPreview();
  updateEditorStatus();
  saveProject();
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
  pushEditorUndoSnapshot();
  const editor = $('codeEditor') as HTMLTextAreaElement;
  let snippet = '';

  switch (type) {
    case 'ui-block':
      snippet = `\`\`\`ui\n{\n  "title": "${currentProject.name} Dashboard",\n  "theme": "compact",\n  "components": [\n    { "type": "header", "text": "Quick Actions" },\n    { "type": "text", "text": "Execute operations with instant undo." },\n    { "type": "metrics", "metrics": [{ "label": "Active Items", "value": "12" }] },\n    { "type": "button", "id": "btn_run", "text": "Run Task Now", "intent": "info", "action": "trigger-run" },\n    { "type": "action-history", "id": "recent_actions", "limit": 10, "showUndoAll": true }\n  ]\n}\n\`\`\`\n\n`;
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
  pushEditorUndoSnapshot();
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
    if (blueprint.host_permissions) currentProject.host_permissions = blueprint.host_permissions;
    if (blueprint.agentSettings) currentProject.agentSettings = blueprint.agentSettings;
    if (blueprint.iconBrief) {
      currentProject.iconBrief = {
        ...currentProject.iconBrief,
        ...blueprint.iconBrief,
        model: currentProject.iconBrief?.model || DEFAULT_ICON_MODEL,
        artStyle: currentProject.iconBrief?.artStyle || 'flat-vector',
        clipSquircle: currentProject.iconBrief?.clipSquircle !== false,
      };
    }
    if (blueprint.prompt) currentProject.prompt = blueprint.prompt;

    loadProjectIntoUI(currentProject);
    await saveProject();

    if ($input('iconAutoGenOnBlueprint').checked) {
      progressEl.textContent = 'Auto-generating AI icon with gemini-nano-banana-2.1...';
      try {
        await handleGenerateAiIcon();
      } catch (iconErr) {
        console.warn('Auto AI icon generation notice:', iconErr);
      }
    }

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

  pushEditorUndoSnapshot();

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

// ─── Live Test Runner & Structured Console ──────────────────────────────

async function runLiveTest(): Promise<void> {
  const trigger = $select('runnerTriggerSelect').value;
  const customUserMessage = $input('runnerCustomMessage').value.trim() || undefined;

  // Make sure live override is active so background executes this project's prompt
  await applyLiveOverride(true);
  activeStudioOverride = true;
  updateActiveOverrideButton();

  $btn('btnRunLiveTest').disabled = true;
  runnerLogEntries.length = 0;
  appendRunnerLog({
    id: `log-${Date.now()}`,
    runId: 'test-run',
    timestamp: Date.now(),
    channel: 'step-start',
    title: `Triggering live run (${trigger})...`,
  });

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'studio-test-run',
      trigger,
      customUserMessage,
    });

    if (res?.error) {
      appendRunnerLog({
        id: `log-${Date.now()}`,
        runId: 'test-run',
        timestamp: Date.now(),
        channel: 'error',
        title: `Run Error: ${res.error}`,
      });
    } else {
      appendRunnerLog({
        id: `log-${Date.now()}`,
        runId: 'test-run',
        timestamp: Date.now(),
        channel: 'run-complete',
        step: res.steps || 1,
        title: `Run complete (${res.status}) in ${res.steps || 1} steps: ${res.summary || ''}`,
        data: res,
      });
      if (res.tokens?.estimatedCost) {
        appendRunnerLog({
          id: `log-${Date.now()}`,
          runId: 'test-run',
          timestamp: Date.now(),
          channel: 'usage',
          title: `Cost: $${res.tokens.estimatedCost.toFixed(4)} | Tokens: ${res.tokens.input} in / ${res.tokens.output} out`,
          data: res.tokens,
        });
      }
    }
  } catch (err) {
    appendRunnerLog({
      id: `log-${Date.now()}`,
      runId: 'test-run',
      timestamp: Date.now(),
      channel: 'error',
      title: `Failed to execute: ${(err as Error).message}`,
    });
  } finally {
    $btn('btnRunLiveTest').disabled = false;
    updateLiveUiPreview();
  }
}

function appendRunnerLog(event: AgentLogEvent): void {
  runnerLogEntries.push(event);
  if (runnerLogEntries.length > 200) {
    runnerLogEntries.shift();
  }
  renderRunnerLogs();
}

function tryParseJson(str: unknown): unknown {
  if (typeof str !== 'string') return undefined;
  const trimmed = str.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function buildJsonTreeElement(data: unknown, keyName?: string, depth = 0, defaultOpen = true): HTMLElement {
  if (typeof data === 'string') {
    const parsed = tryParseJson(data);
    if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
      data = parsed;
    }
  }

  if (data === null || data === undefined) {
    const el = document.createElement('div');
    el.className = 'json-leaf';
    el.innerHTML = `${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}<span class="json-null">${data === null ? 'null' : 'undefined'}</span>`;
    return el;
  }

  if (typeof data === 'boolean') {
    const el = document.createElement('div');
    el.className = 'json-leaf';
    el.innerHTML = `${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}<span class="json-boolean">${data}</span>`;
    return el;
  }

  if (typeof data === 'number') {
    const el = document.createElement('div');
    el.className = 'json-leaf';
    el.innerHTML = `${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}<span class="json-number">${data}</span>`;
    return el;
  }

  if (typeof data === 'string') {
    const el = document.createElement('div');
    el.className = 'json-leaf';
    const isMultiLine = data.includes('\n');
    if (isMultiLine) {
      const details = document.createElement('details');
      details.className = 'json-node';
      details.innerHTML = `
        <summary class="json-summary">
          ${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}
          <span class="json-string">"${escapeHtml(data.slice(0, 45))}..." (${data.length} chars)</span>
        </summary>
        <pre style="margin: 4px 0 0 12px; font-size: 11px; white-space: pre-wrap; color: #86efac;">${escapeHtml(data)}</pre>
      `;
      return details;
    } else {
      el.innerHTML = `${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}<span class="json-string">"${escapeHtml(data)}"</span>`;
      return el;
    }
  }

  if (Array.isArray(data)) {
    const details = document.createElement('details');
    details.className = 'json-node';
    if (depth < 2 && defaultOpen) details.open = true;

    const count = data.length;
    const summary = document.createElement('summary');
    summary.className = 'json-summary';
    summary.innerHTML = `${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}<span>Array(${count})</span>`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.marginLeft = '12px';
    data.forEach((item, idx) => {
      body.appendChild(buildJsonTreeElement(item, `[${idx}]`, depth + 1, defaultOpen));
    });
    details.appendChild(body);
    return details;
  }

  if (typeof data === 'object') {
    const details = document.createElement('details');
    details.className = 'json-node';
    if (depth < 2 && defaultOpen) details.open = true;

    const keys = Object.keys(data as Record<string, unknown>);
    const summary = document.createElement('summary');
    summary.className = 'json-summary';
    summary.innerHTML = `${keyName ? `<span class="json-key">${escapeHtml(keyName)}: </span>` : ''}<span>{${keys.length} keys}</span>`;
    details.appendChild(summary);

    const body = document.createElement('div');
    body.style.marginLeft = '12px';
    for (const k of keys) {
      body.appendChild(buildJsonTreeElement((data as Record<string, unknown>)[k], k, depth + 1, defaultOpen));
    }
    details.appendChild(body);
    return details;
  }

  const fallback = document.createElement('div');
  fallback.className = 'json-leaf';
  fallback.textContent = String(data);
  return fallback;
}

function renderRunnerLogs(): void {
  const consoleEl = $('runnerConsole');
  if (!consoleEl) return;

  const filterChannel = ($select('logFilterSelect')?.value || 'all') as string;
  const filterSearch = ($input('logSearchInput')?.value || '').toLowerCase().trim();

  const filtered = runnerLogEntries.filter((log) => {
    if (filterChannel === 'error' && log.channel !== 'error') return false;
    if (filterChannel === 'tools' && log.channel !== 'tool-call' && log.channel !== 'tool-result') return false;
    if (filterChannel === 'steps' && log.channel !== 'step-start' && log.channel !== 'run-complete' && log.channel !== 'assistant') return false;

    if (filterSearch) {
      const matchTitle = (log.title || '').toLowerCase().includes(filterSearch);
      const matchBody = (log.body || '').toLowerCase().includes(filterSearch);
      const matchData = log.data ? JSON.stringify(log.data).toLowerCase().includes(filterSearch) : false;
      if (!matchTitle && !matchBody && !matchData) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    consoleEl.innerHTML = `<div style="color: #71717a; font-style: italic; padding: 12px;">${runnerLogEntries.length === 0 ? 'Live agent telemetry console ready. Click "Run Live Test" to simulate execution against real browser tabs & tools.' : 'No logs match current filter.'}</div>`;
    return;
  }

  consoleEl.innerHTML = '';
  for (const log of filtered) {
    const card = document.createElement('div');
    card.className = `log-card channel-${log.channel || 'step-start'}`;

    // Header
    const header = document.createElement('div');
    header.className = 'log-card-header';

    const meta = document.createElement('div');
    meta.className = 'log-meta';

    const badge = document.createElement('span');
    badge.className = `log-badge badge-${log.channel || 'step-start'}`;
    badge.textContent = log.channel || 'LOG';
    meta.appendChild(badge);

    if (log.step !== undefined) {
      const stepBadge = document.createElement('span');
      stepBadge.className = 'badge-tag';
      stepBadge.style.cssText = 'background: #27272a; color: #a1a1aa; font-size: 9.5px;';
      stepBadge.textContent = `Step ${log.step}`;
      meta.appendChild(stepBadge);
    }

    if (log.durationMs !== undefined) {
      const durBadge = document.createElement('span');
      durBadge.className = 'badge-tag';
      durBadge.style.cssText = 'background: #27272a; color: #a1a1aa; font-size: 9.5px;';
      durBadge.textContent = `${log.durationMs}ms`;
      meta.appendChild(durBadge);
    }

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(log.timestamp || Date.now()).toLocaleTimeString();
    meta.appendChild(time);

    header.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'log-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'log-btn';
    copyBtn.title = 'Copy this log entry';
    copyBtn.innerHTML = '📋 Copy';
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const payload = {
        channel: log.channel,
        step: log.step,
        durationMs: log.durationMs,
        title: log.title,
        body: log.body,
        data: log.data,
      };
      navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 1500);
      });
    });
    actions.appendChild(copyBtn);

    if (log.channel === 'error' || (typeof log.title === 'string' && log.title.toLowerCase().includes('error'))) {
      const fixBtn = document.createElement('button');
      fixBtn.className = 'log-btn fix-chat';
      fixBtn.title = 'Fix this error in AI Refine Chat';
      fixBtn.innerHTML = '🔧 Fix in Chat';
      fixBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openChatWithError(log);
      });
      actions.appendChild(fixBtn);
    }

    header.appendChild(actions);
    card.appendChild(header);

    // Title
    const title = document.createElement('div');
    title.className = 'log-title';
    title.textContent = log.title || '';
    card.appendChild(title);

    // Body
    if (log.body) {
      const parsedBody = tryParseJson(log.body);
      if (parsedBody && typeof parsedBody === 'object') {
        const tree = document.createElement('div');
        tree.className = 'json-tree';
        tree.appendChild(buildJsonTreeElement(parsedBody, undefined, 0, true));
        card.appendChild(tree);
      } else if (log.body.length > 200 || log.body.includes('\n')) {
        const bodyDetails = document.createElement('details');
        bodyDetails.className = 'json-node';
        bodyDetails.innerHTML = `
          <summary class="json-summary">Details (${log.body.length} chars)</summary>
          <pre style="margin: 4px 0 0; padding: 6px; background: #0d0d10; border-radius: 4px; font-size: 11px; white-space: pre-wrap; color: #cbd5e1;">${escapeHtml(log.body)}</pre>
        `;
        card.appendChild(bodyDetails);
      } else {
        const b = document.createElement('div');
        b.style.cssText = 'font-size: 11px; color: #a1a1aa; white-space: pre-wrap;';
        b.textContent = log.body;
        card.appendChild(b);
      }
    }

    // Data (Tree view)
    if (log.data !== undefined && log.data !== null) {
      const tree = document.createElement('div');
      tree.className = 'json-tree';
      tree.appendChild(buildJsonTreeElement(log.data, undefined, 0, true));
      card.appendChild(tree);
    }

    consoleEl.appendChild(card);
  }
}

function openChatWithError(log: AgentLogEvent): void {
  $('tabChat').click();
  const input = $textarea('chatInput');
  const errorMsg = log.body || (log.data ? JSON.stringify(log.data) : log.title);
  input.value = `I got this error during testing: "${log.title}". Details: ${errorMsg}. Please fix the prompt, handle the edge case, and adjust permissions if needed.`;
  input.focus();
}

// ─── AI Refinement Chat ────────────────────────────────────────────────

function renderChatMessages(): void {
  const list = $('chatMessagesList');
  if (!list) return;

  list.innerHTML = '';
  // Welcome bubble
  const welcome = document.createElement('div');
  welcome.className = 'chat-bubble assistant';
  welcome.innerHTML = `
    <div><strong>AI Extension Architect</strong> is ready to collaborate on <strong>${escapeHtml(currentProject.name)}</strong>.</div>
    <div>You can ask me to debug errors from the Test Runner, optimize prompt batching via <code>code_mode</code>, add UI components, or manage URL access.</div>
    <div style="font-size: 11px; color: var(--color-text-muted);">Try asking: <em>"I get a timeout error on tabs, please optimize with code_mode"</em> or <em>"Grant access to all URLs and add an undo toast"</em>.</div>
  `;
  list.appendChild(welcome);

  for (let i = 0; i < chatUiMessages.length; i++) {
    const msg = chatUiMessages[i];
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${msg.role}`;

    const textDiv = document.createElement('div');
    textDiv.style.whiteSpace = 'pre-wrap';
    textDiv.textContent = msg.content;
    bubble.appendChild(textDiv);

    if (msg.appliedChange) {
      const applied = document.createElement('div');
      applied.className = 'chat-applied-badge';
      applied.innerHTML = `<span>✅ ${escapeHtml(msg.appliedChange.summary)}</span>`;

      const undoBtn = document.createElement('button');
      undoBtn.className = 'chip-btn';
      undoBtn.style.padding = '2px 6px';
      undoBtn.textContent = '↶ Undo';
      const snap = msg.appliedChange.undoSnapshot;
      undoBtn.addEventListener('click', () => {
        currentProject.prompt = snap.promptText;
        currentProject.host_permissions = snap.hostPermissions;
        currentProject.optional_permissions = snap.optionalPermissions;
        if (activeEditorTab === 'prompt') {
          $textarea('codeEditor').value = snap.promptText;
        }
        saveProject();
        updateLiveUiPreview();
        updateEditorStatus();
        renderHostPermissionsUI();
        updatePermissionsCheckboxes();
        undoBtn.disabled = true;
        undoBtn.textContent = 'Undone';
        showToast('Restored previous project state', 'ok');
      });
      applied.appendChild(undoBtn);
      bubble.appendChild(applied);
    }

    list.appendChild(bubble);
  }

  list.scrollTop = list.scrollHeight;
}

async function sendChatMessage(customText?: string): Promise<void> {
  const input = $textarea('chatInput');
  const userText = (customText || input.value).trim();
  if (!userText) return;

  const cfg = await getConfig();
  const provider = cfg.provider;
  const apiKey = cfg.keys[provider];
  if (!apiKey) {
    showToast(`No ${provider} API key configured. Open Settings.`, 'error');
    return;
  }

  input.value = '';
  chatUiMessages.push({ role: 'user', content: userText });
  chatHistory.push({ role: 'user', content: userText });
  renderChatMessages();

  const progressEl = $('chatProgressText');
  progressEl.style.display = 'block';
  $btn('btnChatSend').disabled = true;

  // Gather recent test runner logs if enabled
  let logsContext = '';
  if ($input('chatIncludeLogs').checked && runnerLogEntries.length > 0) {
    logsContext = runnerLogEntries
      .slice(-15)
      .map((e) => `[${e.channel}] ${e.title} ${e.body || ''} ${e.data ? JSON.stringify(e.data) : ''}`)
      .join('\n');
  }

  const modelId = $select('aiModelSelect').value;

  try {
    const result = await chatRefineProjectWithAI({
      provider,
      modelId,
      apiKey,
      project: currentProject,
      chatHistory: chatHistory.slice(-6),
      userMessage: userText,
      recentLogsText: logsContext,
      onProgress: (status) => {
        progressEl.textContent = status;
      },
    });

    let appliedSummary = result.changeSummary;
    let undoSnapshot: EditorUndoSnapshot | undefined;

    const hasChanges = Boolean(
      result.updatedPromptMarkdown ||
      result.updatedOptionalPermissions ||
      result.updatedHostPermissions
    );

    if (hasChanges) {
      undoSnapshot = {
        promptText: currentProject.prompt || '',
        hostPermissions: [...(currentProject.host_permissions || ['<all_urls>'])],
        optionalPermissions: [...(currentProject.optional_permissions || [])],
        tab: activeEditorTab,
      };
      pushEditorUndoSnapshot();

      if (result.updatedPromptMarkdown) {
        currentProject.prompt = result.updatedPromptMarkdown;
        if (activeEditorTab === 'prompt') {
          $textarea('codeEditor').value = result.updatedPromptMarkdown;
        }
      }

      if (result.updatedOptionalPermissions) {
        currentProject.optional_permissions = result.updatedOptionalPermissions;
        updatePermissionsCheckboxes();
      }

      if (result.updatedHostPermissions) {
        currentProject.host_permissions = result.updatedHostPermissions;
        renderHostPermissionsUI();
      }

      await saveProject();
      updateLiveUiPreview();
      updateEditorStatus();
      if (activeEditorTab === 'manifest') renderCodeEditor();
    }

    chatHistory.push({ role: 'assistant', content: result.reply });
    chatUiMessages.push({
      role: 'assistant',
      content: result.reply,
      appliedChange: hasChanges
        ? {
            summary: appliedSummary || 'Updated project configuration & prompt',
            undoSnapshot: undoSnapshot!,
          }
        : undefined,
    });
    renderChatMessages();
    showToast('AI response received', 'ok');
  } catch (err) {
    chatUiMessages.push({
      role: 'assistant',
      content: `❌ Error: ${(err as Error).message}`,
    });
    renderChatMessages();
    showToast(`AI chat failed: ${(err as Error).message}`, 'error');
  } finally {
    progressEl.style.display = 'none';
    $btn('btnChatSend').disabled = false;
  }
}

// ─── Intelligent UI Layout & Dynamic Components Suggester ──────────────

function suggestUiLayoutAndComponents(): void {
  const promptText = (currentProject.prompt || '').toLowerCase();
  const descText = (currentProject.description || '').toLowerCase();
  const fullText = `${currentProject.name} ${descText} ${promptText}`.toLowerCase();

  let recommendedLayout: 'stack' | 'bento-grid' | 'two-column' | 'tabbed' | 'chat-first' | 'compact-feed' = 'bento-grid';
  let recommendedTheme: 'compact' | 'warm-paper' | 'dark' | 'default' = 'compact';
  let accentColor = '#3b82f6';

  if (fullText.includes('chat') || fullText.includes('talk') || fullText.includes('assistant') || fullText.includes('conversation')) {
    recommendedLayout = 'chat-first';
    recommendedTheme = 'dark';
    accentColor = '#8b5cf6';
  } else if (fullText.includes('clean') || fullText.includes('dead') || fullText.includes('stale') || fullText.includes('tidy')) {
    recommendedLayout = 'stack';
    recommendedTheme = 'default';
    accentColor = '#10b981';
  } else if (fullText.includes('dark') || fullText.includes('cyber') || fullText.includes('hack') || fullText.includes('dev')) {
    recommendedLayout = 'bento-grid';
    recommendedTheme = 'dark';
    accentColor = '#06b6d4';
  } else if (fullText.includes('read') || fullText.includes('article') || fullText.includes('digest') || fullText.includes('summary')) {
    recommendedLayout = 'two-column';
    recommendedTheme = 'warm-paper';
    accentColor = '#d97706';
  } else if (fullText.includes('metric') || fullText.includes('quick') || fullText.includes('hygiene') || fullText.includes('feed')) {
    recommendedLayout = 'compact-feed';
    recommendedTheme = 'compact';
    accentColor = '#2563eb';
  }

  // Construct dynamic components tailored to extension
  const comps: any[] = [
    { type: 'header', text: currentProject.name },
    { type: 'text', text: currentProject.description || 'Extension agent is active.' },
  ];

  if (fullText.includes('tab') || fullText.includes('window') || fullText.includes('group')) {
    comps.push({
      type: 'metrics',
      metrics: [
        { label: 'Open Tabs', value: '18', subvalue: 'across 2 windows' },
        { label: 'Groups', value: '3', subvalue: 'active' },
      ],
    });
    comps.push({
      type: 'select',
      id: 'window_scope',
      label: 'Target Window',
      storageKey: 'selected_window',
      options: [
        { label: 'Current Window', value: 'current' },
        { label: 'All Windows', value: 'all' },
      ],
    });
    comps.push({
      type: 'task-list',
      id: 'tab_actions',
      label: 'Organize Queue',
      storageKey: 'tab_tasks',
      items: [
        { id: '1', title: 'Group GitHub & documentation tabs', done: false },
        { id: '2', title: 'Collapse inactive video tabs', done: true },
      ],
    });
    comps.push({
      type: 'button',
      id: `btn_sort_tabs_${Date.now().toString(36)}`,
      text: 'Sort & Group Tabs',
      intent: 'info',
      action: 'trigger-run',
    });
    comps.push({
      type: 'chat',
      id: 'agent_chat',
      label: 'Tab Assistant Chat',
      storageKey: 'agent_chat_log',
      placeholder: 'Tell agent how to sort your tabs...',
    });
  } else if (fullText.includes('bookmark')) {
    comps.push({
      type: 'metrics',
      metrics: [
        { label: 'Total Bookmarks', value: '142', subvalue: 'healthy' },
        { label: 'Duplicates', value: '0', subvalue: 'clean' },
      ],
    });
    comps.push({
      type: 'switch',
      id: 'auto_archive',
      label: 'Auto-archive dead links',
      storageKey: 'auto_archive_enabled',
      hint: 'Detect and archive 404 links during background alarm',
    });
    comps.push({
      type: 'button',
      id: `btn_scan_bookmarks_${Date.now().toString(36)}`,
      text: 'Scan & Clean Bookmarks',
      intent: 'success',
      action: 'trigger-run',
    });
  } else {
    comps.push({
      type: 'metrics',
      metrics: [
        { label: 'Status', value: 'Active', subvalue: 'monitoring' },
        { label: 'Schedule', value: `${currentProject.alarmMinutes}m`, subvalue: 'interval' },
      ],
    });
    comps.push({
      type: 'switch',
      id: 'auto_run_switch',
      label: 'Autonomous Schedule',
      storageKey: 'auto_run_enabled',
      hint: 'Run scheduled checks every interval',
    });
    comps.push({
      type: 'button',
      id: `btn_run_now_${Date.now().toString(36)}`,
      text: 'Run Operation',
      intent: 'info',
      action: 'trigger-run',
    });
    comps.push({
      type: 'chat',
      id: 'agent_chat',
      label: 'Agent Chat',
      storageKey: 'agent_chat_messages',
      placeholder: 'Send instruction or ask a question...',
    });
  }

  comps.push({
    type: 'action-history',
    id: 'history_log',
    text: 'Action Journal & Undo',
    limit: 15,
    showUndoAll: true,
    undoAllLabel: 'Undo Last Action',
  });

  mutatePromptUiBlock((ui) => {
    ui.title = `${currentProject.name} Dashboard`;
    ui.theme = recommendedTheme;
    ui.layoutMode = recommendedLayout;
    ui.themeConfig = {
      ...(ui.themeConfig || {}),
      accentColor,
    };
    ui.components = comps;
    ui.layout = comps;
  });

  if ($select('uiThemeSelect')) $select('uiThemeSelect').value = recommendedTheme;
  if ($select('uiLayoutModeSelect')) $select('uiLayoutModeSelect').value = recommendedLayout;
  if ($input('uiAccentColorInput')) $input('uiAccentColorInput').value = accentColor;
  if ($input('uiTitleInput')) $input('uiTitleInput').value = `${currentProject.name} Dashboard`;

  showToast(`Applied ${recommendedLayout} layout with ${recommendedTheme} theme!`, 'ok');
}

// ─── Event Listeners ───────────────────────────────────────────────────

function setupEventListeners(): void {
  // Project selection & new project & template cloning
  $('projectSelect').addEventListener('change', (e) => {
    const selVal = (e.target as HTMLSelectElement).value;
    if (selVal.startsWith('template:')) {
      const tplSlug = selVal.replace('template:', '');
      const base = ALL_STARTER_TEMPLATES.find((x) => x.slug === tplSlug) || STARTER_PROJECTS[0];
      const newP: ExtensionProjectData = {
        id: `project-${Date.now().toString(36)}`,
        name: base.name,
        slug: base.slug,
        version: '1.0.0',
        description: base.description,
        prompt: base.prompt,
        alarmMinutes: base.alarmMinutes ?? 30,
        permissions: [...(base.permissions || ['storage', 'alarms'])],
        optional_permissions: [...(base.optional_permissions || [])],
        host_permissions: [...(base.host_permissions || ['<all_urls>'])],
        agentSettings: base.agentSettings ? JSON.parse(JSON.stringify(base.agentSettings)) : undefined,
        iconBrief: base.iconBrief ? JSON.parse(JSON.stringify(base.iconBrief)) : { symbol: 'spark', colors: ['#6366f1', '#a855f7'] },
        uiConfig: base.uiConfig ? JSON.parse(JSON.stringify(base.uiConfig)) : undefined,
      };
      slugManuallyEdited = false;
      projects.push(newP);
      renderProjectDropdown();
      loadProjectIntoUI(newP);
      saveProject();
      showToast(`Loaded template "${base.name}"`, 'ok');
      return;
    }

    const p = projects.find((x) => x.id === selVal);
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
      prompt: `# New Custom Agent\n\n\`\`\`ui\n{\n  "title": "Agent Dashboard",\n  "theme": "compact",\n  "components": [\n    { "type": "header", "text": "Dashboard" },\n    { "type": "button", "id": "btn_go", "text": "Run", "intent": "info", "action": "trigger-run" }\n  ]\n}\n\`\`\`\n\nPerform actions through granted tools.\n`,
      alarmMinutes: 30,
      permissions: ['storage', 'alarms'],
      optional_permissions: ['tabs'],
      host_permissions: ['<all_urls>'],
      iconBrief: { symbol: 'spark', colors: ['#6366f1', '#a855f7'] },
    };
    slugManuallyEdited = false;
    projects.push(newP);
    renderProjectDropdown();
    loadProjectIntoUI(newP);
    saveProject();
    $input('extNameInput').focus();
    $input('extNameInput').select();
    showToast('Created new extension project', 'ok');
  });

  $('btnDeleteProject').addEventListener('click', async () => {
    if (projects.length <= 1) {
      showToast('Cannot delete the only remaining project', 'error');
      return;
    }
    const confirmed = confirm(`Are you sure you want to delete "${currentProject.name}"?`);
    if (!confirmed) return;

    const doomedId = currentProject.id;
    projects = projects.filter((p) => p.id !== doomedId);
    currentProject = projects[0];
    await chrome.storage.local.set({ studioProjects: projects, activeStudioProjectId: currentProject.id });
    renderProjectDropdown();
    loadProjectIntoUI(currentProject);
    showToast('Project deleted', 'ok');
  });

  // Editor Undo / Redo buttons
  $('btnEditorUndo').addEventListener('click', performEditorUndo);
  $('btnEditorRedo').addEventListener('click', performEditorRedo);

  // Keyboard shortcuts for Editor Undo / Redo
  $textarea('codeEditor').addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        performEditorRedo();
      } else {
        performEditorUndo();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
      e.preventDefault();
      performEditorRedo();
    }
  });

  // Website & URL Access (host_permissions) listeners
  $('checkAllUrls').addEventListener('change', () => {
    const isChecked = $input('checkAllUrls').checked;
    let list = currentProject.host_permissions ? [...currentProject.host_permissions] : [];
    if (isChecked && !list.includes('<all_urls>')) {
      list.unshift('<all_urls>');
    } else if (!isChecked) {
      list = list.filter((p) => p !== '<all_urls>');
    }
    currentProject.host_permissions = list;
    saveProject();
    renderHostPermissionsUI();
    if (activeEditorTab === 'manifest') renderCodeEditor();
  });

  $('btnAddHostPattern').addEventListener('click', () => {
    const inp = $input('hostPatternInput');
    const pat = inp.value.trim();
    if (!pat) return;
    let list = currentProject.host_permissions ? [...currentProject.host_permissions] : [];
    if (!list.includes(pat)) {
      list.push(pat);
      currentProject.host_permissions = list;
      saveProject();
      renderHostPermissionsUI();
      if (activeEditorTab === 'manifest') renderCodeEditor();
      showToast(`Added URL access pattern: ${pat}`, 'ok');
    }
    inp.value = '';
  });

  $input('hostPatternInput').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('btnAddHostPattern').click();
    }
  });

  document.querySelectorAll('[data-host-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-host-preset');
      if (!preset) return;
      let list = currentProject.host_permissions ? [...currentProject.host_permissions] : [];
      if (!list.includes(preset)) {
        list.push(preset);
        currentProject.host_permissions = list;
        saveProject();
        renderHostPermissionsUI();
        if (activeEditorTab === 'manifest') renderCodeEditor();
        showToast(`Added preset pattern: ${preset}`, 'ok');
      }
    });
  });

  // Top header buttons
  $('btnActivateLive').addEventListener('click', toggleLiveOverride);
  $('btnExportFolder').addEventListener('click', handleExportFolder);
  $('btnCompileZip').addEventListener('click', handleCompileZip);
  $('btnOpenExtensions').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions' });
  });

  // Extension Name and Slug inputs (live sync & auto-slug generation)
  $input('extSlugInput').addEventListener('input', () => {
    slugManuallyEdited = true;
    currentProject.slug = $input('extSlugInput').value.trim() || 'untitled-extension';
    saveProject();
    if (activeEditorTab === 'manifest') renderCodeEditor();
  });

  $input('extNameInput').addEventListener('input', () => {
    const rawVal = $input('extNameInput').value;
    currentProject.name = rawVal.trim() || 'Untitled Extension';
    if (!slugManuallyEdited) {
      const slugVal = slugify(currentProject.name);
      $input('extSlugInput').value = slugVal;
      currentProject.slug = slugVal;
    }
    const activeOpt = $select('projectSelect').querySelector<HTMLOptionElement>(`option[value="${currentProject.id}"]`);
    if (activeOpt) {
      activeOpt.textContent = `${currentProject.name} (v${currentProject.version || '1.0.0'})`;
    }
    if ($('chatActiveProjectName')) {
      $('chatActiveProjectName').textContent = currentProject.name;
    }
    if ($input('uiTitleInput')) {
      $input('uiTitleInput').value = `${currentProject.name} Dashboard`;
    }
    mutatePromptUiBlock((ui) => {
      ui.title = `${currentProject.name} Dashboard`;
    });
    saveProject();
    if (activeEditorTab === 'manifest' || activeEditorTab === 'config') renderCodeEditor();
  });

  // Metadata & Icon & UI inputs change listeners
  const metaInputs = [
    'extAlarmInput',
    'extDescInput',
    'iconColor1',
    'iconColor2',
    'iconSymbolSelect',
    'iconArtStyleSelect',
    'iconStyleInput',
    'iconClipSquircle',
    'iconCustomModelInput',
    'checkIncludeStudio',
    'checkLockProvider',
    'uiShowPopupHeader',
    'uiShowStatusCard',
    'uiShowViewSwitcher',
    'uiShowCosts',
    'uiShowHistory',
    'uiAllowSidePanel',
    'uiAllowArtifacts',
    'uiShowScheduleSummary',
  ];
  for (const id of metaInputs) {
    const el = $(id);
    if (!el) continue;
    const eventName = el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'color' ? 'change' : 'input';
    el.addEventListener(eventName, () => {
      saveProject();
      renderIcons();
      if (activeEditorTab === 'config') renderCodeEditor();
    });
  }

  // Icon LLM model selector
  $('iconModelSelect').addEventListener('change', () => {
    const isCustom = $select('iconModelSelect').value === 'custom';
    $('iconCustomModelRow').style.display = isCustom ? 'block' : 'none';
    saveProject();
  });

  // AI Icon Generation button
  $('btnGenerateAiIcon').addEventListener('click', handleGenerateAiIcon);

  // Upload Custom Icon Image
  $('btnUploadIcon').addEventListener('click', () => {
    $('iconUploadInput').click();
  });

  $('iconUploadInput').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      currentProject.iconBrief = {
        ...currentProject.iconBrief,
        customImageDataUrl: dataUrl,
        mode: 'upload',
      };
      $('iconModeBadge').textContent = 'Uploaded Image';
      $('btnResetVectorIcon').style.display = 'inline-flex';
      renderIcons();
      await saveProject();
      showToast('Custom icon image uploaded!', 'ok');
    };
    reader.readAsDataURL(file);
  });

  // Reset Icon to Procedural Vector
  $('btnResetVectorIcon').addEventListener('click', async () => {
    if (currentProject.iconBrief) {
      currentProject.iconBrief.mode = 'vector';
      delete currentProject.iconBrief.customImageDataUrl;
    }
    $('iconModeBadge').textContent = 'Vector Glyph';
    $('btnResetVectorIcon').style.display = 'none';
    renderIcons();
    await saveProject();
    showToast('Reset icon to procedural vector glyph', 'ok');
  });

  // Visual Dashboard UI Configurator toolbar
  $('uiThemeSelect').addEventListener('change', () => {
    const theme = $select('uiThemeSelect').value;
    mutatePromptUiBlock((ui) => {
      ui.theme = theme;
    });
  });

  $('uiLayoutModeSelect').addEventListener('change', () => {
    const layout = $select('uiLayoutModeSelect').value;
    mutatePromptUiBlock((ui) => {
      ui.layoutMode = layout;
    });
  });

  $('uiTitleInput').addEventListener('input', () => {
    const title = $input('uiTitleInput').value.trim();
    mutatePromptUiBlock((ui) => {
      ui.title = title;
    });
  });

  $('uiAccentColorInput').addEventListener('change', () => {
    const accent = $input('uiAccentColorInput').value;
    mutatePromptUiBlock((ui) => {
      ui.themeConfig = ui.themeConfig || {};
      ui.themeConfig.accentColor = accent;
    });
  });

  $('btnAiStyleUi').addEventListener('click', async () => {
    const cfg = await getConfig();
    const provider = cfg.provider;
    const apiKey = cfg.keys[provider];
    if (!apiKey) {
      showToast(`No ${provider} API key configured. Open Settings.`, 'error');
      return;
    }
    const notes = $input('uiThemeInspirationInput').value.trim();
    showToast('Consulting AI designer for theme...', 'ok');
    try {
      const style = await generateThemeStyleWithAI({
        provider,
        modelId: $select('aiModelSelect').value,
        apiKey,
        projectName: currentProject.name,
        projectDescription: currentProject.description,
        inspirationNotes: notes,
      });

      mutatePromptUiBlock((ui) => {
        ui.theme = style.theme;
        ui.themeConfig = {
          ...(ui.themeConfig || {}),
          accentColor: style.accentColor,
          backgroundGradient: style.backgroundGradient,
          blurPx: style.blurPx,
          cardOpacity: style.cardOpacity,
          borderRadiusPx: style.borderRadiusPx,
          customCss: style.customCss,
        };
      });

      $select('uiThemeSelect').value = style.theme;
      if (style.accentColor && $input('uiAccentColorInput')) {
        $input('uiAccentColorInput').value = style.accentColor;
      }
      showToast(`Styled: ${style.themeSummary || style.theme}`, 'ok');
    } catch (err) {
      showToast(`Style UI failed: ${(err as Error).message}`, 'error');
    }
  });

  $('btnSuggestUiLayout').addEventListener('click', () => {
    suggestUiLayoutAndComponents();
  });

  const addCompButtons = document.querySelectorAll('[data-add-ui-comp]');
  addCompButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const compType = btn.getAttribute('data-add-ui-comp');
      if (!compType) return;
      mutatePromptUiBlock((ui) => {
        switch (compType) {
          case 'select':
            ui.components.push({
              type: 'select',
              id: `select_${Date.now().toString(36)}`,
              label: 'Filter Category',
              storageKey: 'selected_category',
              options: [
                { label: 'All Items', value: 'all' },
                { label: 'Active', value: 'active' },
                { label: 'Archived', value: 'archived' },
              ],
            });
            break;
          case 'switch':
            ui.components.push({
              type: 'switch',
              id: `switch_${Date.now().toString(36)}`,
              label: 'Autonomous Sync',
              storageKey: 'auto_sync_enabled',
              hint: 'Automatically run on periodic alarms',
            });
            break;
          case 'radio':
            ui.components.push({
              type: 'radio',
              id: `radio_${Date.now().toString(36)}`,
              label: 'Grouping Priority',
              storageKey: 'group_priority',
              options: [
                { label: 'Domain', value: 'domain' },
                { label: 'Topic', value: 'topic' },
              ],
            });
            break;
          case 'checkbox':
            ui.components.push({
              type: 'checkbox',
              id: `check_${Date.now().toString(36)}`,
              label: 'Notify on completed run',
              storageKey: 'notify_on_complete',
            });
            break;
          case 'textarea':
            ui.components.push({
              type: 'textarea',
              id: `textarea_${Date.now().toString(36)}`,
              label: 'Custom Guidelines',
              storageKey: 'user_instructions',
              placeholder: 'Enter custom rules for agent execution...',
            });
            break;
          case 'password':
            ui.components.push({
              type: 'password',
              id: `secret_${Date.now().toString(36)}`,
              label: 'Secret Access Token',
              storageKey: 'user_secret_token',
              placeholder: 'Enter secret token...',
            });
            break;
          case 'date-time':
            ui.components.push({
              type: 'date-time',
              id: `datetime_${Date.now().toString(36)}`,
              label: 'Target Execution Time',
              storageKey: 'target_datetime',
            });
            break;
          case 'file':
            ui.components.push({
              type: 'file',
              id: `file_${Date.now().toString(36)}`,
              label: 'Attach Reference Spec',
              storageKey: 'attached_doc',
            });
            break;
          case 'slider':
            ui.components.push({
              type: 'slider',
              id: `slider_${Date.now().toString(36)}`,
              label: 'Batch Size Limit',
              storageKey: 'batch_limit',
              min: 5,
              max: 50,
              step: 5,
              defaultValue: 20,
            });
            break;
          case 'chat':
            ui.components.push({
              type: 'chat',
              id: 'agent_chat',
              label: 'Talk to Extension Agent',
              storageKey: 'chat_history',
              placeholder: 'Ask agent to inspect tabs or run a task...',
            });
            break;
          case 'task-list':
            ui.components.push({
              type: 'task-list',
              id: `tasks_${Date.now().toString(36)}`,
              label: 'Action Queue',
              storageKey: 'action_queue',
              items: [
                { id: '1', title: 'Inspect active tab', done: false },
                { id: '2', title: 'Process background items', done: true },
              ],
            });
            break;
          case 'summary':
            ui.components.push({
              type: 'summary',
              id: `summary_${Date.now().toString(36)}`,
              label: 'Execution Summary',
              text: 'All operations executed successfully. 0 errors detected.',
              intent: 'success',
            });
            break;
          case 'button':
            ui.components.push({
              type: 'button',
              id: `btn_action_${Date.now().toString(36)}`,
              text: 'Run Operation',
              intent: 'info',
              action: 'trigger-run',
            });
            break;
          case 'action-history':
            ui.components.push({
              type: 'action-history',
              id: 'recent_actions',
              text: 'Action History & Undo',
              limit: 15,
              showUndoAll: true,
              undoAllLabel: 'Undo Last Action',
            });
            break;
          case 'card':
            ui.components.push({
              type: 'card',
              id: `card_${Date.now().toString(36)}`,
              title: 'Status Overview',
              subtitle: 'System Health',
              content: 'Autonomous agent is idle and waiting for schedule trigger.',
            });
            break;
          case 'carousel':
            ui.components.push({
              type: 'carousel',
              id: `carousel_${Date.now().toString(36)}`,
              items: [
                { title: 'Window 1', description: '8 active tabs' },
                { title: 'Window 2', description: '4 active tabs' },
              ],
            });
            break;
          case 'metrics':
            ui.components.push({
              type: 'metrics',
              metrics: [{ label: 'Active Items', value: '12', subvalue: 'healthy' }],
            });
            break;
          case 'table':
            ui.components.push({
              type: 'table',
              columns: [
                { key: 'name', label: 'Item Name' },
                { key: 'status', label: 'Status' },
              ],
              rows: [
                { name: 'Alpha Task', status: 'Running' },
                { name: 'Beta Task', status: 'Idle' },
              ],
            });
            break;
          case 'dialog':
            ui.components.push({
              type: 'dialog',
              id: `dialog_${Date.now().toString(36)}`,
              title: 'Confirm Operation',
              message: 'Are you sure you want to execute batch processing?',
              triggerText: 'Review Action',
            });
            break;
          case 'menu':
            ui.components.push({
              type: 'menu',
              id: `menu_${Date.now().toString(36)}`,
              label: 'Quick Commands',
              items: [
                { label: 'Run Diagnostic', action: 'trigger-run' },
                { label: 'Clear History', action: 'trigger-run' },
              ],
            });
            break;
          case 'alert':
            ui.components.push({
              type: 'alert',
              intent: 'info',
              text: 'System is ready and operational.',
            });
            break;
          case 'icon':
            ui.components.push({
              type: 'icon',
              icon: 'spark',
              text: 'Autonomous AI Assistant',
            });
            break;
          case 'list':
            ui.components.push({
              type: 'list',
              items: [
                { title: 'First Task', subtitle: 'Completed 2m ago' },
                { title: 'Second Task', subtitle: 'Pending approval' },
              ],
            });
            break;
          case 'key-value':
            ui.components.push({
              type: 'key-value',
              items: [
                { key: 'Environment', value: 'Chrome MV3' },
                { key: 'Auto-Run', value: 'Enabled' },
              ],
            });
            break;
          case 'progress':
            ui.components.push({
              type: 'progress',
              label: 'Overall Progress',
              current: 65,
              max: 100,
            });
            break;
        }
      });
      showToast(`Added ${compType} component to UI block`, 'ok');
    });
  });

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

  // Right pane 3-subview switch
  $('tabPreview').addEventListener('click', () => {
    $('tabPreview').classList.add('active');
    $('tabRunner').classList.remove('active');
    $('tabChat').classList.remove('active');
    $('previewContainer').style.display = 'block';
    $('runnerContainer').style.display = 'none';
    $('chatContainer').style.display = 'none';
  });

  $('tabRunner').addEventListener('click', () => {
    $('tabRunner').classList.add('active');
    $('tabPreview').classList.remove('active');
    $('tabChat').classList.remove('active');
    $('previewContainer').style.display = 'none';
    $('runnerContainer').style.display = 'flex';
    $('chatContainer').style.display = 'none';
  });

  $('tabChat').addEventListener('click', () => {
    $('tabChat').classList.add('active');
    $('tabPreview').classList.remove('active');
    $('tabRunner').classList.remove('active');
    $('previewContainer').style.display = 'none';
    $('runnerContainer').style.display = 'none';
    $('chatContainer').style.display = 'flex';
    renderChatMessages();
  });

  // Log Toolbar Controls
  $('logFilterSelect').addEventListener('change', renderRunnerLogs);
  $('logSearchInput').addEventListener('input', renderRunnerLogs);

  $('btnExpandAllLogs').addEventListener('click', () => {
    const details = $('runnerConsole').querySelectorAll<HTMLDetailsElement>('details.json-node');
    details.forEach((d) => { d.open = true; });
  });

  $('btnCollapseAllLogs').addEventListener('click', () => {
    const details = $('runnerConsole').querySelectorAll<HTMLDetailsElement>('details.json-node');
    details.forEach((d) => { d.open = false; });
  });

  $('btnCopyAllLogs').addEventListener('click', () => {
    const formatted = runnerLogEntries.map((e) => {
      let str = `[${e.channel || 'log'}] ${e.title || ''}`;
      if (e.body) str += `\n${e.body}`;
      if (e.data) str += `\n${JSON.stringify(e.data, null, 2)}`;
      return str;
    }).join('\n\n---\n\n');
    navigator.clipboard.writeText(formatted || 'No logs').then(() => {
      showToast(`Copied ${runnerLogEntries.length} log entries to clipboard!`, 'ok');
    });
  });

  $('btnClearLogs').addEventListener('click', () => {
    runnerLogEntries.length = 0;
    renderRunnerLogs();
    showToast('Cleared logs', 'ok');
  });

  // AI Refine Chat Controls
  $('btnChatSend').addEventListener('click', () => sendChatMessage());

  $textarea('chatInput').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  $('btnClearChat').addEventListener('click', () => {
    chatHistory.length = 0;
    chatUiMessages.length = 0;
    renderChatMessages();
    showToast('Chat history cleared', 'ok');
  });

  document.querySelectorAll('[data-chat-suggest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const suggest = btn.getAttribute('data-chat-suggest');
      if (suggest) {
        sendChatMessage(suggest);
      }
    });
  });

  // AI Generator and Refine in Left Pane
  $('btnAiGenerate').addEventListener('click', handleAiGenerate);
  $('btnAiRefine').addEventListener('click', handleAiRefine);

  // Live test runner
  $('btnRunLiveTest').addEventListener('click', runLiveTest);

  // Listen for agent logs broadcast from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'agent-log' && msg.event) {
      appendRunnerLog(msg.event);
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
