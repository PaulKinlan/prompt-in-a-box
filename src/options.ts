/**
 * Options page: provider selection, API keys per provider, schedule,
 * optional permissions manager, and a full audit log of every action the agent has taken.
 *
 * Supports runtime policy locking via static config.json and granular UI flags.
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
import {
  CAPABILITY_GROUPS,
  CAPABILITIES,
  isRequiredCapability,
  checkCapability,
  requestCapability,
  removeCapability,
} from './capabilities';
import type { AuditEntry, AuditIndexEntry } from './audit';
import { printAgentLogToConsole } from './logger';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let currentConfig: Config;
let staticCfg: StaticConfig;
let currentProvider: Provider = 'google';
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
  if (isPolicyLocked(staticCfg) && currentConfig.ui?.showPolicyBadge !== false) {
    const policyBadge = $('policyBadge');
    if (policyBadge) policyBadge.style.display = 'inline-flex';
  }

  // Feature toggles from policy and granular UI flags
  applyFeatureGating();

  if (!currentConfig.onboarded && currentConfig.ui?.showOnboardingBanner !== false) {
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

function setDisplay(id: string, value: string): void {
  const el = $(id);
  if (el) el.style.display = value;
}

function applyFeatureGating(): void {
  const f = staticCfg.features;
  if (f) {
    if (f.showProviderSelector === false) setDisplay('providerFieldset', 'none');
    if (f.showProviderTools === false) setDisplay('providerToolsFieldset', 'none');
    if (f.showPermissionsManager === false) setDisplay('permissionsFieldset', 'none');
    if (f.showSchedule === false) setDisplay('scheduleFieldset', 'none');
    if (f.showAuditLog === false) setDisplay('auditSection', 'none');
    if (f.allowExportAudit === false) setDisplay('exportAudit', 'none');
    if (f.allowClearAudit === false) setDisplay('clearAudit', 'none');
    if (f.allowManualRun === false) setDisplay('runNow', 'none');
    if (f.allowSidePanel === false) setDisplay('navSidePanel', 'none');
    if (f.allowArtifacts === false) setDisplay('navArtifacts', 'none');
  }

  // Granular UI config flags
  const ui = currentConfig.ui;
  if (ui) {
    if (ui.showStudio === true) setDisplay('navStudio', '');
    else setDisplay('navStudio', 'none');
    if (ui.showProviderSelector === false) setDisplay('providerFieldset', 'none');
    if (ui.showApiKeyInput === false) setDisplay('apiKeyFieldGroup', 'none');
    if (ui.showModelSelector === false) setDisplay('modelFieldGroup', 'none');
    if (ui.showProviderTools === false) setDisplay('providerToolsFieldset', 'none');
    if (ui.showPermissionsManager === false) setDisplay('permissionsFieldset', 'none');
    if (ui.showSchedule === false) setDisplay('scheduleFieldset', 'none');
    if (ui.showAuditLog === false) setDisplay('auditSection', 'none');
    if (ui.showAuditStats === false) setDisplay('stats', 'none');
    if (ui.showAuditFilters === false) setDisplay('auditSearch', 'none');
    if (ui.allowClearAudit === false) setDisplay('clearAudit', 'none');
    if (ui.allowExportAudit === false) setDisplay('exportAudit', 'none');
    if (ui.showHistory === false) setDisplay('auditList', 'none');
    if (ui.showVersionBadge === false) setDisplay('versionBadge', 'none');
    if (ui.showPolicyBadge === false) setDisplay('policyBadge', 'none');
    if (ui.allowTestConnection === false) setDisplay('test', 'none');
    if (ui.allowManualRun === false) setDisplay('runNow', 'none');
    if (ui.allowSidePanel === false) setDisplay('navSidePanel', 'none');
    if (ui.allowArtifacts === false) setDisplay('navArtifacts', 'none');
    if (ui.showCosts === false) {
      const statCost = $('stat-cost');
      if (statCost && statCost.parentElement) {
        statCost.parentElement.style.display = 'none';
      }
    }
  }
}

// ─── Grouped Capabilities / Permissions Manager ─────────────────────

function permissionErrorText(action: 'grant' | 'remove', label: string, err?: string): string {
  if (err && err.includes('must be called in response to a user action')) {
    return `Browser rejected ${action} for ${label}: requires direct user gesture.`;
  }
  return err ? `Failed to ${action} ${label}: ${err}` : `Could not ${action} ${label}.`;
}

async function renderOptionalPermissions(): Promise<void> {
  const loading = $('permissionsLoading');
  if (loading) loading.style.display = 'none';

  const apiContainer = $('apiPermissionsContainer');
  if (!apiContainer) return;
  apiContainer.innerHTML = '';
  apiContainer.style.display = 'flex';
  apiContainer.style.flexDirection = 'column';
  apiContainer.style.gap = '20px';

  for (const group of CAPABILITY_GROUPS) {
    const groupCaps = CAPABILITIES.filter((c) => c.group === group.id);
    if (groupCaps.length === 0) continue;

    const groupSection = document.createElement('div');
    groupSection.style.border = '1px solid var(--color-border)';
    groupSection.style.borderRadius = 'var(--pib-radius-sm)';
    groupSection.style.padding = '14px';
    groupSection.style.background = 'var(--color-card-base)';

    const groupHeader = document.createElement('div');
    groupHeader.style.marginBottom = '12px';
    groupHeader.innerHTML = `
      <div style="font-weight: 700; font-size: 14px; color: var(--color-text-primary);">${group.label}</div>
      <div style="font-size: 12px; color: var(--color-text-muted); margin-top: 2px;">${group.hint}</div>
    `;
    groupSection.appendChild(groupHeader);

    const capsGrid = document.createElement('div');
    capsGrid.className = 'provider-tools-grid';

    for (const cap of groupCaps) {
      const isReq = isRequiredCapability(cap.id);
      const isGranted = isReq || (await checkCapability(cap.id));

      const wrap = document.createElement('div');
      wrap.className = 'provider-tool';
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'flex-start';
      wrap.style.gap = '10px';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `cap-${cap.id}`;
      input.checked = isGranted;

      if (isReq) {
        input.disabled = true;
      } else {
        input.addEventListener('change', async () => {
          if (input.checked) {
            const granted = await requestCapability(cap.id);
            if (granted) {
              toast(`Granted ${cap.label}`);
              await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
            } else {
              input.checked = false;
              toast(permissionErrorText('grant', cap.label), 'error');
            }
          } else {
            const removed = await removeCapability(cap.id);
            if (removed) {
              toast(`Removed ${cap.label}`);
              await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
            } else {
              input.checked = true;
              toast(permissionErrorText('remove', cap.label), 'error');
            }
          }
        });
      }

      const label = document.createElement('label');
      label.setAttribute('for', `cap-${cap.id}`);
      label.style.flex = '1';
      label.style.cursor = isReq ? 'default' : 'pointer';

      const reqBadge = isReq
        ? `<span style="font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 4px; background: var(--color-accent-tint); color: var(--color-accent); border: 1px solid var(--color-border); margin-left: 6px;">Required by manifest</span>`
        : '';

      label.innerHTML = `
        <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center;">${cap.label} ${reqBadge}</div>
        <div class="desc" style="font-size: 12px; margin-top: 3px; color: var(--color-text-secondary);">${cap.hint}</div>
        <div style="font-size: 11px; margin-top: 4px; color: var(--color-text-muted); font-family: var(--pib-font-mono);">${cap.gates}</div>
      `;

      wrap.appendChild(input);
      wrap.appendChild(label);
      capsGrid.appendChild(wrap);
    }

    groupSection.appendChild(capsGrid);
    apiContainer.appendChild(groupSection);
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
  const alarmInput = $('alarmMinutes') as HTMLInputElement | null;
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
  const alarmInput = $('alarmMinutes') as HTMLInputElement | null;
  const presets = document.querySelectorAll('.preset-chip');

  const updateAndSaveSchedule = async (minutes: number) => {
    const safeMinutes = Number.isNaN(minutes) ? 30 : Math.max(0, minutes);
    currentConfig.alarmMinutes = safeMinutes;
    if (alarmInput) alarmInput.value = String(safeMinutes);
    presets.forEach((b) => {
      const m = Number((b as HTMLElement).dataset.min);
      b.classList.toggle('active', m === safeMinutes);
    });
    try {
      await setConfig({ alarmMinutes: safeMinutes });
      await chrome.runtime.sendMessage({ type: 'reschedule-alarm' }).catch(() => {});
      toast(safeMinutes > 0 ? `Schedule updated: Every ${safeMinutes} min` : 'Schedule disabled (Never)');
    } catch (err) {
      toast(`Failed to update schedule: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  if (alarmInput && !staticCfg.schedule?.lockSchedule) {
    alarmInput.addEventListener('change', () => {
      const val = parseInt(alarmInput.value, 10);
      void updateAndSaveSchedule(val);
    });
  }

  presets.forEach((btn) => {
    if (!staticCfg.schedule?.lockSchedule) {
      btn.addEventListener('click', () => {
        const mins = Number((btn as HTMLElement).dataset.min);
        void updateAndSaveSchedule(mins);
      });
    }
  });

  const saveBtn = $('save') as HTMLButtonElement | null;
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const patch = collectConfig();
        await setConfig(patch);
        currentConfig = await getConfig();
        renderProviderGrid();
        renderActiveProvider();
        renderSchedule();

        await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
        toast('Settings saved');

        const onboardingEl = $('onboarding');
        if (onboardingEl) onboardingEl.hidden = true;
      } catch (err) {
        toast(`Save failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
      }
    });
  }

  // Test Connection
  const testBtn = $('test') as HTMLButtonElement | null;
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
          toast(`Connected to ${patch.provider}/${patch.model}! Test run complete.`);
        } else if (result.status === 'skipped') {
          toast(result.summary, 'error');
        } else {
          toast(`Test failed: ${result.summary}`, 'error');
        }
        await refreshAudit();
      } catch (err) {
        toast(`Test error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test Connection';
      }
    });
  }

  // Run Now
  const runBtn = $('runNow') as HTMLButtonElement | null;
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
  const rawMins = Number(($('alarmMinutes') as HTMLInputElement).value);
  const alarmMinutes = Number.isNaN(rawMins) ? 30 : Math.max(0, rawMins);
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

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'agent-log' && msg.event) {
    printAgentLogToConsole(msg.event);
  }
});
