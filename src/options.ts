/**
 * Options page: provider selection, API keys per provider, schedule,
 * optional permissions manager, and a full audit log of every action the agent has taken.
 *
 * Supports runtime policy locking via static config.json.
 */

import {
  getConfig,
  setConfig,
  getStaticConfig,
  isPolicyLocked,
  activeKey,
  PROVIDER_DEFAULTS,
  PROVIDER_MODELS,
  PROVIDER_LABELS,
  PROVIDER_ENDPOINTS,
  type Config,
  type Provider,
  type StaticConfig,
} from './config';
import type { AuditEntry, AuditIndexEntry } from './audit';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let currentConfig: Config;
let staticCfg: StaticConfig;
let currentProvider: Provider = 'anthropic';
let allAuditIndex: AuditIndexEntry[] = [];

async function loadUI(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  document.title = `${manifest.name} — Settings & Audit`;
  if ($('extName')) $('extName').textContent = manifest.name;
  if ($('versionBadge')) $('versionBadge').textContent = `v${manifest.version}`;

  staticCfg = await getStaticConfig();
  currentConfig = await getConfig();
  currentProvider = currentConfig.provider;

  // Policy indicator badge
  if (isPolicyLocked(staticCfg)) {
    const policyBadge = $('policyBadge');
    if (policyBadge) policyBadge.style.display = 'inline-flex';
  }

  // Feature toggles from policy
  applyFeatureGating();

  if (!currentConfig.onboarded) {
    const onboardingEl = $('onboarding');
    if (onboardingEl) onboardingEl.hidden = false;
  }

  renderProviderGrid();
  renderActiveProvider();
  renderProviderTools();
  renderSchedule();

  await refreshAudit();
  await renderOptionalPermissions();
  wireEventHandlers();
}

function applyFeatureGating(): void {
  const f = staticCfg.features;
  if (!f) return;

  if (f.showProviderSelector === false) {
    const el = $('providerFieldset');
    if (el) el.style.display = 'none';
  }
  if (f.showProviderTools === false) {
    const el = $('providerToolsFieldset');
    if (el) el.style.display = 'none';
  }
  if (f.showPermissionsManager === false) {
    const el = $('permissionsFieldset');
    if (el) el.style.display = 'none';
  }
  if (f.showSchedule === false) {
    const el = $('scheduleFieldset');
    if (el) el.style.display = 'none';
  }
  if (f.showAuditLog === false) {
    const el = $('auditSection');
    if (el) el.style.display = 'none';
  }
  if (f.allowExportAudit === false) {
    const el = $('exportAudit');
    if (el) el.style.display = 'none';
  }
  if (f.allowClearAudit === false) {
    const el = $('clearAudit');
    if (el) el.style.display = 'none';
  }
  if (f.allowManualRun === false) {
    const el = $('runNow');
    if (el) el.style.display = 'none';
  }
  if (f.allowSidePanel === false) {
    const el = $('navSidePanel');
    if (el) el.style.display = 'none';
  }
  if (f.allowArtifacts === false) {
    const el = $('navArtifacts');
    if (el) el.style.display = 'none';
  }
}

// ─── Optional Permissions Manager ───────────────────────────────────

const PERMISSION_DESCRIPTIONS: Record<string, { label: string; desc: string }> = {
  tabs: { label: 'Tabs Management', desc: 'Interact with open browser tabs, query/group/move them.' },
  scripting: { label: 'Tab Scripting & Screenshot', desc: 'Read page text and capture DOM screenshots.' },
  bookmarks: { label: 'Bookmarks', desc: 'Search, create, list, and delete browser bookmarks.' },
  history: { label: 'History', desc: 'Search user browser history.' },
  downloads: { label: 'Downloads', desc: 'Download files and search download history.' },
  contextMenus: { label: 'Context Menus', desc: 'Create and respond to right-click menu items.' },
  idle: { label: 'Idle State', desc: 'Detect when the system/browser is idle.' },
  readingList: { label: 'Reading List', desc: 'Add pages to or query the browser Reading List.' },
  webNavigation: { label: 'Web Navigation', desc: 'Receive navigation events inside tabs.' },
  clipboardWrite: { label: 'Clipboard Write', desc: 'Copy text to the clipboard in the background.' },
};

function getHostPermissionDef(origin: string): { label: string; desc: string } {
  if (origin === '<all_urls>') {
    return { label: 'All Websites', desc: 'Allows the agent to read/act on any website you navigate to.' };
  }
  return { label: origin, desc: `Access and script pages on ${origin}.` };
}

interface PermissionResult {
  ok: boolean;
  error?: string;
}

function checkPermission(perm: string, isHost: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.permissions.contains(
      isHost ? { origins: [perm] } : { permissions: [perm as chrome.runtime.ManifestPermission] },
      (result) => {
        void chrome.runtime.lastError;
        resolve(Boolean(result));
      }
    );
  });
}

function requestPermission(perm: string, isHost: boolean): Promise<PermissionResult> {
  return new Promise((resolve) => {
    chrome.permissions.request(
      isHost ? { origins: [perm] } : { permissions: [perm as chrome.runtime.ManifestPermission] },
      (granted) => {
        const err = chrome.runtime.lastError;
        resolve({ ok: Boolean(granted), error: err?.message });
      }
    );
  });
}

function removePermission(perm: string, isHost: boolean): Promise<PermissionResult> {
  return new Promise((resolve) => {
    chrome.permissions.remove(
      isHost ? { origins: [perm] } : { permissions: [perm as chrome.runtime.ManifestPermission] },
      (removed) => {
        const err = chrome.runtime.lastError;
        resolve({ ok: Boolean(removed), error: err?.message });
      }
    );
  });
}

function permissionErrorText(action: 'grant' | 'remove', label: string, err?: string): string {
  if (err && err.includes('must be called in response to a user action')) {
    return `Browser rejected ${action} for ${label}: requires direct user gesture.`;
  }
  return err ? `Failed to ${action} ${label}: ${err}` : `Could not ${action} ${label}.`;
}

async function renderOptionalPermissions(): Promise<void> {
  const manifest = chrome.runtime.getManifest();
  const optionalPermissions = manifest.optional_permissions ?? [];
  const optionalHostPermissions = manifest.optional_host_permissions ?? [];

  if (optionalPermissions.length === 0 && optionalHostPermissions.length === 0) {
    const fs = $('permissionsFieldset');
    if (fs) fs.hidden = true;
    return;
  }

  const loading = $('permissionsLoading');
  if (loading) loading.style.display = 'none';

  const apiContainer = $('apiPermissionsContainer');
  if (apiContainer) {
    apiContainer.innerHTML = '';
    for (const perm of optionalPermissions) {
      const def = PERMISSION_DESCRIPTIONS[perm] ?? {
        label: perm,
        desc: `Grant the ${perm} permission to unlock related tools.`,
      };
      const granted = await checkPermission(perm, false);

      const wrap = document.createElement('div');
      wrap.className = 'provider-tool';

      const id = `perm-${perm}`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = granted;

      input.addEventListener('change', async () => {
        if (input.checked) {
          const res = await requestPermission(perm, false);
          if (res.ok) {
            toast(`Granted ${def.label} permission`);
            await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
          } else {
            input.checked = false;
            toast(permissionErrorText('grant', def.label, res.error), 'error');
          }
        } else {
          const res = await removePermission(perm, false);
          if (res.ok) {
            toast(`Removed ${def.label} permission`);
            await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
          } else {
            input.checked = true;
            toast(permissionErrorText('remove', def.label, res.error), 'error');
          }
        }
      });

      const label = document.createElement('label');
      label.setAttribute('for', id);
      label.textContent = def.label;

      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = def.desc;

      label.appendChild(desc);
      wrap.appendChild(input);
      wrap.appendChild(label);
      apiContainer.appendChild(wrap);
    }
  }

  const hostContainer = $('hostPermissionsContainer');
  if (hostContainer) {
    hostContainer.innerHTML = '';
    if (optionalHostPermissions.length > 0) {
      const hostSec = $('hostPermissionsSection');
      if (hostSec) hostSec.style.display = 'block';

      for (const host of optionalHostPermissions) {
        const def = getHostPermissionDef(host);
        const granted = await checkPermission(host, true);

        const wrap = document.createElement('div');
        wrap.className = 'provider-tool';

        const id = `host-${host.replace(/[^a-zA-Z0-9]/g, '-')}`;
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = id;
        input.checked = granted;

        input.addEventListener('change', async () => {
          if (input.checked) {
            const res = await requestPermission(host, true);
            if (res.ok) {
              toast(`Granted ${def.label} permission`);
              await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
            } else {
              input.checked = false;
              toast(permissionErrorText('grant', def.label, res.error), 'error');
            }
          } else {
            const res = await removePermission(host, true);
            if (res.ok) {
              toast(`Removed ${def.label} permission`);
              await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
            } else {
              input.checked = true;
              toast(permissionErrorText('remove', def.label, res.error), 'error');
            }
          }
        });

        const label = document.createElement('label');
        label.setAttribute('for', id);
        label.textContent = def.label;

        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = def.desc;

        label.appendChild(desc);
        wrap.appendChild(input);
        wrap.appendChild(label);
        hostContainer.appendChild(wrap);
      }
    }
  }
}

// ─── Provider-native tools ────────────────────────────────────────

interface ProviderToolDef {
  name: string;
  label: string;
  desc: string;
}

const PROVIDER_TOOLS_BY_PROVIDER: Record<Provider, ProviderToolDef[]> = {
  anthropic: [
    { name: 'web_search', label: 'Web search', desc: 'Anthropic-hosted web search. Results returned inline.' },
    { name: 'web_fetch', label: 'Web fetch', desc: 'Fetch a URL and return its content to the model.' },
    { name: 'code_execution', label: 'Code execution', desc: 'Python sandbox for computation, parsing, plotting.' },
  ],
  google: [
    { name: 'google_search', label: 'Google search', desc: 'Google-hosted grounded search with citations.' },
    { name: 'url_context', label: 'URL context', desc: 'Fetch URLs referenced in the prompt.' },
    { name: 'code_execution', label: 'Code execution', desc: 'Python sandbox the model can call.' },
  ],
  openai: [
    { name: 'web_search', label: 'Web search', desc: 'OpenAI web search (Responses API).' },
  ],
};

function renderProviderTools(): void {
  const grid = $('providerToolsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const defs = PROVIDER_TOOLS_BY_PROVIDER[currentProvider] || [];
  const disabled = new Set(currentConfig.disabledProviderTools);
  const isLocked = Boolean(staticCfg.providerTools?.lockProviderTools);

  for (const t of defs) {
    const wrap = document.createElement('div');
    wrap.className = 'provider-tool';
    const id = `pt-${t.name}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !disabled.has(t.name);
    if (isLocked) {
      input.disabled = true;
    } else {
      input.addEventListener('change', () => {
        const now = new Set(currentConfig.disabledProviderTools);
        if (input.checked) now.delete(t.name);
        else now.add(t.name);
        currentConfig = {
          ...currentConfig,
          disabledProviderTools: Array.from(now),
        };
      });
    }
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.textContent = t.label;
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = t.desc;
    label.appendChild(desc);
    wrap.appendChild(input);
    wrap.appendChild(label);
    grid.appendChild(wrap);
  }
}

function renderProviderGrid(): void {
  const grid = $('providerGrid');
  if (!grid) return;
  grid.innerHTML = '';

  const allowedProviders = (staticCfg.providers?.allowed && staticCfg.providers.allowed.length > 0)
    ? staticCfg.providers.allowed
    : (['anthropic', 'google', 'openai'] as Provider[]);

  const isLocked = Boolean(staticCfg.providers?.lockProvider);

  for (const key of allowedProviders) {
    const card = document.createElement('div');
    card.className = 'provider-card' + (key === currentProvider ? ' selected' : '');
    card.dataset.provider = key;

    const hasKey = Boolean(currentConfig.keys[key]?.trim());
    const keyBadgeHtml = hasKey
      ? `<div class="key-badge ready"><span class="dot"></span><span>Key saved</span></div>`
      : `<div class="key-badge missing"><span class="dot"></span><span>No key</span></div>`;

    card.innerHTML = `
      <div class="label-row">
        <div class="label">${PROVIDER_LABELS[key]}</div>
      </div>
      <div class="model">${PROVIDER_DEFAULTS[key].model}</div>
      ${keyBadgeHtml}
    `;

    if (!isLocked) {
      card.addEventListener('click', () => {
        currentProvider = key;
        renderProviderGrid();
        renderActiveProvider();
        renderProviderTools();
      });
    } else {
      card.style.cursor = 'default';
    }

    grid.appendChild(card);
  }
}

function renderActiveProvider(): void {
  const apiKeyInput = $('apiKey') as HTMLInputElement;
  if (apiKeyInput) {
    apiKeyInput.value = currentConfig.keys[currentProvider] ?? '';
  }

  const allowedModels = staticCfg.models?.allowed?.[currentProvider] ?? PROVIDER_MODELS[currentProvider] ?? [PROVIDER_DEFAULTS[currentProvider].model];
  const lockModel = Boolean(staticCfg.models?.lockModel);
  const strictSelect = staticCfg.models?.allowCustomModelInput === false || lockModel;

  const textInput = $('model') as HTMLInputElement;
  const selectEl = $('modelSelect') as HTMLSelectElement;
  const chipsContainer = $('modelChips');

  const currentModel =
    currentProvider === currentConfig.provider
      ? currentConfig.model
      : (staticCfg.models?.default || PROVIDER_DEFAULTS[currentProvider].model);

  if (strictSelect) {
    if (textInput) textInput.style.display = 'none';
    if (selectEl) {
      selectEl.style.display = 'block';
      selectEl.innerHTML = '';
      for (const m of allowedModels) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        if (m === currentModel) opt.selected = true;
        selectEl.appendChild(opt);
      }
      selectEl.disabled = lockModel;
    }
    if (chipsContainer) chipsContainer.innerHTML = '';
  } else {
    if (selectEl) selectEl.style.display = 'none';
    if (textInput) {
      textInput.style.display = 'block';
      textInput.value = currentModel;
    }

    // Datalist suggestions
    const datalist = $('modelOptions') as HTMLDataListElement;
    if (datalist) {
      datalist.innerHTML = '';
      for (const m of allowedModels) {
        const opt = document.createElement('option');
        opt.value = m;
        datalist.appendChild(opt);
      }
    }

    // Quick select chips
    if (chipsContainer) {
      chipsContainer.innerHTML = '';
      for (const m of allowedModels.slice(0, 5)) {
        const chip = document.createElement('span');
        chip.className = 'model-chip' + (m === currentModel ? ' active' : '');
        chip.textContent = m;
        chip.addEventListener('click', () => {
          textInput.value = m;
          const allChips = chipsContainer.querySelectorAll('.model-chip');
          allChips.forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
        });
        chipsContainer.appendChild(chip);
      }
    }
  }

  const hint = PROVIDER_DEFAULTS[currentProvider].hint +
    ` · key sent only to ${PROVIDER_ENDPOINTS[currentProvider]}`;
  const apiKeyHint = $('apiKeyHint');
  if (apiKeyHint) apiKeyHint.textContent = hint;
}

function renderSchedule(): void {
  const alarmInput = $('alarmMinutes') as HTMLInputElement;
  if (alarmInput) {
    alarmInput.value = String(currentConfig.alarmMinutes);
    if (staticCfg.schedule?.lockSchedule) {
      alarmInput.disabled = true;
    }
  }

  const presets = document.querySelectorAll('.preset-chip');
  presets.forEach((btn) => {
    const mins = Number((btn as HTMLElement).dataset.min);
    if (mins === currentConfig.alarmMinutes) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }

    if (staticCfg.schedule?.lockSchedule) {
      (btn as HTMLButtonElement).disabled = true;
    } else {
      btn.addEventListener('click', () => {
        if (alarmInput) alarmInput.value = String(mins);
        presets.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
    }
  });
}

function wireEventHandlers(): void {
  // Show / Hide API Key
  const toggleKeyBtn = $('toggleApiKey');
  const apiKeyInput = $('apiKey') as HTMLInputElement;
  if (toggleKeyBtn && apiKeyInput) {
    toggleKeyBtn.addEventListener('click', () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      toggleKeyBtn.textContent = isPassword ? 'Hide' : 'Show';
    });
  }

  // Side Panel open navigation
  const navSidePanelBtn = $('navSidePanel');
  if (navSidePanelBtn) {
    navSidePanelBtn.addEventListener('click', async () => {
      try {
        const win = await chrome.windows.getCurrent();
        if (win?.id && chrome.sidePanel?.open) {
          await chrome.sidePanel.open({ windowId: win.id });
        }
      } catch (err) {
        console.warn('Could not open side panel directly:', err);
      }
    });
  }

  // Save Settings
  const saveBtn = $('save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const patch = collectConfig();
      await setConfig({ ...patch, onboarded: true });
      await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
      currentConfig = await getConfig();
      const onboarding = $('onboarding');
      if (onboarding) onboarding.hidden = true;
      renderProviderGrid();
      toast('Settings saved successfully');
    });
  }

  // Test Connection
  const testBtn = $('test') as HTMLButtonElement;
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      try {
        const patch = collectConfig();
        const result = (await chrome.runtime.sendMessage({
          type: 'test-provider',
          config: patch,
        })) as AuditEntry;
        if (result.status === 'ok') {
          toast(`Test OK · ${result.steps} step${result.steps === 1 ? '' : 's'} · $${result.tokens.estimatedCost.toFixed(4)}`);
        } else {
          toast(result.summary || 'Test failed', 'error');
        }
        await refreshAudit();
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
      }
    });
  }

  // Run Now
  const runBtn = $('runNow') as HTMLButtonElement;
  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      runBtn.textContent = 'Running…';
      try {
        const result = (await chrome.runtime.sendMessage({
          type: 'run-now',
        })) as AuditEntry;
        toast(`Run complete · ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'}`);
        await refreshAudit();
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Agent Now';
      }
    });
  }

  // Audit Actions & Filters
  const refreshBtn = $('refreshAudit');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refreshAudit());

  const clearBtn = $('clearAudit');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Clear all audit history? This cannot be undone.')) return;
      await chrome.runtime.sendMessage({ type: 'clear-audit' });
      await refreshAudit();
      toast('Audit log cleared');
    });
  }

  const exportBtn = $('exportAudit');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const detailed: AuditEntry[] = [];
      for (const row of allAuditIndex) {
        const entry = (await chrome.runtime.sendMessage({
          type: 'get-audit-entry',
          runId: row.runId,
        })) as AuditEntry | null;
        if (entry) detailed.push(entry);
      }
      const blob = new Blob([JSON.stringify(detailed, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompt-in-a-box-audit-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  const statusFilter = $('auditStatusFilter') as HTMLSelectElement;
  const searchInput = $('auditSearch') as HTMLInputElement;

  if (statusFilter) statusFilter.addEventListener('change', () => applyAuditFilters());
  if (searchInput) searchInput.addEventListener('input', () => applyAuditFilters());
}

function collectConfig(): Partial<Config> {
  const alarmMinutes = Number(($('alarmMinutes') as HTMLInputElement).value) || 30;
  const apiKeyValue = ($('apiKey') as HTMLInputElement).value.trim();

  const strictSelect = staticCfg.models?.allowCustomModelInput === false || staticCfg.models?.lockModel;
  const model = strictSelect
    ? (($('modelSelect') as HTMLSelectElement)?.value || PROVIDER_DEFAULTS[currentProvider].model)
    : (($('model') as HTMLInputElement)?.value.trim() || PROVIDER_DEFAULTS[currentProvider].model);

  const keys: Record<Provider, string> = {
    ...currentConfig.keys,
    [currentProvider]: apiKeyValue,
  };
  return {
    provider: currentProvider,
    model,
    alarmMinutes,
    keys,
    disabledProviderTools: currentConfig.disabledProviderTools,
  };
}

// ─── Audit ─────────────────────────────────────────────────────────

async function refreshAudit(): Promise<void> {
  const index = (await chrome.runtime.sendMessage({
    type: 'get-audit-index',
  })) as AuditIndexEntry[];

  allAuditIndex = index || [];

  const ok = allAuditIndex.filter((r) => r.status === 'ok').length;
  const toolTotal = allAuditIndex.reduce((n, r) => n + r.toolCallCount, 0);
  const costTotal = allAuditIndex.reduce((c, r) => c + r.estimatedCost, 0);
  $('stat-runs').textContent = String(allAuditIndex.length);
  $('stat-ok').textContent = String(ok);
  $('stat-tools').textContent = String(toolTotal);
  $('stat-cost').textContent = '$' + costTotal.toFixed(4);

  applyAuditFilters();
}

function applyAuditFilters(): void {
  const statusFilter = ($('auditStatusFilter') as HTMLSelectElement)?.value || 'all';
  const query = (($('auditSearch') as HTMLInputElement)?.value || '').toLowerCase().trim();

  const filtered = allAuditIndex.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (query) {
      const matchSummary = (row.summary || '').toLowerCase().includes(query);
      const matchTrigger = (row.trigger || '').toLowerCase().includes(query);
      if (!matchSummary && !matchTrigger) return false;
    }
    return true;
  });

  const list = $('auditList');
  if (!list) return;
  list.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'audit-row';
    empty.style.opacity = '0.6';
    empty.style.padding = '16px 0';
    empty.style.textAlign = 'center';
    empty.textContent = allAuditIndex.length === 0
      ? 'No runs recorded yet. Hit “Run Agent Now” or wait for the scheduled alarm.'
      : 'No audit records match the current filter criteria.';
    list.appendChild(empty);
    return;
  }

  for (const row of filtered) {
    list.appendChild(renderAuditRow(row));
  }
}

function renderAuditRow(row: AuditIndexEntry): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'audit-row';

  const cols = document.createElement('div');
  cols.className = 'audit-cols';

  const when = new Date(row.startedAt).toLocaleString();
  const trigger = row.trigger || row.status;
  const tokens = row.totalTokens ? row.totalTokens.toLocaleString() : '—';

  cols.innerHTML = `
    <div>${escapeHtml(when)}</div>
    <div>${escapeHtml(trigger)}</div>
    <div class="status-${row.status}" title="${escapeHtml(row.summary)}">${escapeHtml(row.summary)}</div>
    <div>${row.toolCallCount}</div>
    <div>${tokens}</div>
    <div>$${row.estimatedCost.toFixed(4)}</div>
  `;

  const btn = document.createElement('button');
  btn.className = 'expand';
  btn.textContent = '▸';
  btn.title = 'Expand for full trace';
  btn.addEventListener('click', async () => {
    const existing = wrapper.querySelector('.audit-detail');
    if (existing) {
      existing.remove();
      btn.textContent = '▸';
      return;
    }
    btn.textContent = '▾';
    const detail = await loadDetail(row.runId);
    wrapper.appendChild(detail);
  });
  const btnCell = document.createElement('div');
  btnCell.appendChild(btn);
  cols.appendChild(btnCell);

  wrapper.appendChild(cols);
  return wrapper;
}

async function loadDetail(runId: string): Promise<HTMLElement> {
  const entry = (await chrome.runtime.sendMessage({
    type: 'get-audit-entry',
    runId,
  })) as AuditEntry | null;
  const detail = document.createElement('div');
  detail.className = 'audit-detail';
  if (!entry) {
    detail.textContent = 'Detailed trace not found (OPFS may have been cleared).';
    return detail;
  }

  const header = document.createElement('h4');
  header.textContent = `Run ${entry.runId} · ${entry.provider}/${entry.model} · ${entry.trigger}`;
  detail.appendChild(header);

  if (entry.finalText) {
    const textH = document.createElement('h4');
    textH.textContent = 'Final text';
    detail.appendChild(textH);
    const pre = document.createElement('pre');
    pre.textContent = entry.finalText;
    detail.appendChild(pre);
  }

  const toolsH = document.createElement('h4');
  toolsH.textContent = `Tool calls (${entry.toolCalls.length})`;
  detail.appendChild(toolsH);

  if (entry.toolCalls.length === 0) {
    const p = document.createElement('div');
    p.style.opacity = '0.6';
    p.textContent = 'No tool calls on this run.';
    detail.appendChild(p);
  } else {
    for (const call of entry.toolCalls) {
      const card = document.createElement('div');
      card.className = 'tool-call';
      const name = document.createElement('div');
      name.className = 'tool-name';
      name.textContent = call.name + (call.blocked ? ' (blocked)' : '');
      const meta = document.createElement('div');
      meta.className = 'tool-meta';
      meta.textContent = new Date(call.at).toLocaleTimeString() +
        (call.durationMs !== undefined ? ` · ${call.durationMs} ms` : '');
      const args = document.createElement('pre');
      args.textContent = 'args: ' + stringify(call.args);
      const result = document.createElement('pre');
      result.textContent = 'result: ' + stringify(call.result);
      card.appendChild(name);
      card.appendChild(meta);
      card.appendChild(args);
      card.appendChild(result);
      detail.appendChild(card);
    }
  }

  if (entry.error) {
    const errH = document.createElement('h4');
    errH.textContent = 'Error';
    detail.appendChild(errH);
    const pre = document.createElement('pre');
    pre.textContent = entry.error;
    detail.appendChild(pre);
  }

  const tokensH = document.createElement('h4');
  tokensH.textContent = 'Tokens';
  detail.appendChild(tokensH);
  const tokensPre = document.createElement('pre');
  tokensPre.textContent = `input: ${entry.tokens.input}\noutput: ${entry.tokens.output}\nestimated cost: $${entry.tokens.estimatedCost.toFixed(6)}`;
  detail.appendChild(tokensPre);

  return detail;
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ─── Small UI helpers ─────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(text: string, kind: 'ok' | 'error' = 'ok'): void {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.className = `toast show ${kind}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 2500);
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}

void loadUI();
