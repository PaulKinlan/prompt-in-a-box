/**
 * Popup: quick glance + run trigger + recent artifacts + undo toast banner + agent settings.
 */

import { getConfig, setConfig, activeKey, PROVIDER_LABELS, getStaticConfig } from './config';
import type { AuditEntry } from './audit';
import type { ArtifactIndexEntry, ArtifactKind } from './artifacts';
import { UIRenderer, loadPromptUIBlock, mountDashboardTelemetry, type UISchema } from './ui-renderer';
import { printAgentLogToConsole } from './logger';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const MAX_POPUP_ARTIFACTS = 5;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

function kindBadgeClass(kind: ArtifactKind): string {
  if (kind.startsWith('image-')) return 'kind-image';
  if (kind === 'json') return 'kind-json';
  if (kind === 'html') return 'kind-html';
  return '';
}

async function loadSummary(): Promise<void> {
  const cfg = await getConfig();
  const staticCfg = await getStaticConfig();
  const manifest = chrome.runtime.getManifest();

  document.title = manifest.name;
  if ($('extName')) $('extName').textContent = manifest.name;
  if ($('version')) $('version').textContent = 'v' + manifest.version;
  if ($('summaryProvider')) $('summaryProvider').textContent = PROVIDER_LABELS[cfg.provider] || cfg.provider;
  if ($('summaryModel')) $('summaryModel').textContent = cfg.model;
  const scheduleEl = document.getElementById('summarySchedule') as HTMLSelectElement | null;
  if (scheduleEl) {
    const mins = cfg.alarmMinutes <= 0 ? 0 : cfg.alarmMinutes;
    const hasOption = Array.from(scheduleEl.options).some((o) => Number(o.value) === mins);
    if (!hasOption && mins > 0) {
      const opt = document.createElement('option');
      opt.value = String(mins);
      opt.textContent = `Every ${mins}m`;
      scheduleEl.appendChild(opt);
    }
    scheduleEl.value = String(mins);
    scheduleEl.disabled = Boolean(staticCfg.schedule?.lockSchedule);
    if (!scheduleEl.dataset.wired) {
      scheduleEl.dataset.wired = 'true';
      scheduleEl.addEventListener('change', async () => {
        const nextMins = Math.max(0, parseInt(scheduleEl.value, 10) || 0);
        await setConfig({ alarmMinutes: nextMins });
        await chrome.runtime.sendMessage({ type: 'reschedule-alarm' }).catch(() => {});
      });
    }
  }

  const hasKey = Boolean(activeKey(cfg));
  const keyBadge = $('keyStatusBadge');
  const keyText = $('keyStatusText');
  const runBtn = $('runNow') as HTMLButtonElement;

  if (hasKey) {
    keyBadge.className = 'key-status ready';
    keyText.textContent = 'Key Ready';
    runBtn.disabled = false;
  } else {
    keyBadge.className = 'key-status missing';
    keyText.textContent = 'Setup Key →';
    runBtn.disabled = true;
    showStatus('No API key configured. Click "Setup Key" to configure in settings.', 'error');
  }

  // Feature flag and UI config enforcement
  if (staticCfg.features?.allowManualRun === false || cfg.ui?.allowManualRun === false) {
    runBtn.style.display = 'none';
  }
  if (staticCfg.features?.allowArtifacts === false || cfg.ui?.allowArtifacts === false || cfg.ui?.showRecentArtifacts === false) {
    if ($('artifactsSection')) $('artifactsSection').style.display = 'none';
    if ($('openArtifacts')) $('openArtifacts').style.display = 'none';
    if ($('openArtifactsTop')) $('openArtifactsTop').style.display = 'none';
  }
  if (staticCfg.features?.allowSidePanel === false || cfg.ui?.allowSidePanel === false) {
    if ($('openSidePanelBtn')) $('openSidePanelBtn').style.display = 'none';
    if ($('openSidePanel')) $('openSidePanel').style.display = 'none';
  }
  if (cfg.ui?.showStatusCard === false) {
    if ($('runtimeStatusCard')) $('runtimeStatusCard').style.display = 'none';
    else {
      const sc = document.querySelector('.status-card') as HTMLElement | null;
      if (sc) sc.style.display = 'none';
    }
  }
  if (cfg.ui?.showScheduleSummary === false && $('summarySchedule')) {
    $('summarySchedule').style.display = 'none';
  }
  if (cfg.ui?.showKeyStatusBadge === false && $('keyStatusBadge')) {
    $('keyStatusBadge').style.display = 'none';
  }
  if (cfg.ui?.showVersionBadge === false && $('version')) {
    $('version').style.display = 'none';
  }
  if (cfg.ui?.showPopupHeader === false && $('popupHeader')) {
    $('popupHeader').style.display = 'none';
  }
  if (cfg.ui?.showPopupFooter === false && $('popupFooter')) {
    $('popupFooter').style.display = 'none';
  }
  if (cfg.ui?.allowSettingsAccess === false) {
    if ($('openOptionsTop')) $('openOptionsTop').style.display = 'none';
    if ($('openOptions')) $('openOptions').style.display = 'none';
  }
  if (cfg.ui?.showStudio === true) {
    if ($('openStudioTop')) $('openStudioTop').style.display = '';
    if ($('openStudio')) $('openStudio').style.display = '';
  } else {
    if ($('openStudioTop')) $('openStudioTop').style.display = 'none';
    if ($('openStudio')) $('openStudio').style.display = 'none';
  }

  if (cfg.ui?.showAuditUI === false || staticCfg.features?.showAuditUI === false || (staticCfg as any).showAuditUI === false) {
    if ($('viewSwitcher')) $('viewSwitcher').style.display = 'none';
    if ($('dynamicPopup')) $('dynamicPopup').style.display = 'none';
    if ($('standardPopup')) $('standardPopup').style.display = 'block';
  }

  // Load Undo Toast Banner
  await checkUndoToast();

  // Load User Agent Settings
  await loadAgentSettings();
}

async function checkUndoToast(): Promise<void> {
  const banner = $('undoToastBanner');
  if (!banner) return;

  const stored = await chrome.storage.local.get('activeUndoToast');
  const toastData = stored.activeUndoToast as { id: string; message: string; undoLabel: string; expiresAt: number } | undefined;

  if (toastData && toastData.expiresAt > Date.now()) {
    banner.style.display = 'flex';
    if ($('undoToastMsg')) $('undoToastMsg').textContent = toastData.message;
    if ($('undoToastBtn')) $('undoToastBtn').textContent = toastData.undoLabel || 'Undo';

    $('undoToastBtn').onclick = async () => {
      $('undoToastBtn').textContent = 'Undoing…';
      (document.getElementById('undoToastBtn') as HTMLButtonElement).disabled = true;
      try {
        await chrome.runtime.sendMessage({ type: 'action-toast-undo' });
        banner.style.display = 'none';
        showStatus('Sort undone successfully', 'ok');
      } catch (err) {
        showStatus(`Undo failed: ${(err as Error).message}`, 'error');
      }
    };

    $('dismissToastBtn').onclick = async () => {
      await chrome.runtime.sendMessage({ type: 'action-toast-dismiss' });
      banner.style.display = 'none';
    };
  } else {
    banner.style.display = 'none';
  }
}

// Live update Undo Toast banner when tabs are grouped
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes.activeUndoToast || changes.lastSortSnapshot)) {
      void checkUndoToast();
    }
  });
}

async function loadAgentSettings(): Promise<void> {
  const cfg = await getConfig();
  const card = $('agentSettingsCard');
  const container = $('agentSettingsFields');
  if (!card || !container) return;

  const fields = cfg.agentSettings?.fields;
  if (!fields || fields.length === 0) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  if (cfg.agentSettings?.title && $('agentSettingsTitle')) {
    $('agentSettingsTitle').textContent = cfg.agentSettings.title;
  }

  const stored = await chrome.storage.local.get('agentSettingsValues');
  const values = (stored.agentSettingsValues as Record<string, unknown>) || {};

  container.innerHTML = '';
  for (const field of fields) {
    const val = values[field.id] !== undefined ? values[field.id] : field.default;

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '4px';

    if (field.type === 'boolean') {
      const label = document.createElement('label');
      label.style.display = 'flex';
      label.style.alignItems = 'center';
      label.style.gap = '8px';
      label.style.cursor = 'pointer';
      label.style.fontSize = '12.5px';
      label.style.fontWeight = '500';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = Boolean(val);
      chk.addEventListener('change', async () => {
        values[field.id] = chk.checked;
        await chrome.storage.local.set({ agentSettingsValues: values });
      });

      label.appendChild(chk);
      const span = document.createElement('span');
      span.textContent = field.label;
      label.appendChild(span);
      row.appendChild(label);
    } else if (field.type === 'select') {
      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.justifyContent = 'space-between';
      topRow.style.alignItems = 'center';

      const label = document.createElement('span');
      label.textContent = field.label;
      label.style.fontSize = '12px';
      label.style.fontWeight = '600';

      const select = document.createElement('select');
      select.style.padding = '3px 8px';
      select.style.fontSize = '11.5px';
      select.style.borderRadius = '5px';
      select.style.background = 'var(--color-bg-base)';
      select.style.color = 'var(--color-text-primary)';
      select.style.border = '1px solid var(--color-border)';

      for (const opt of field.options || []) {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        if (opt.value === val) optionEl.selected = true;
        select.appendChild(optionEl);
      }

      select.addEventListener('change', async () => {
        values[field.id] = select.value;
        await chrome.storage.local.set({ agentSettingsValues: values });
      });

      topRow.appendChild(label);
      topRow.appendChild(select);
      row.appendChild(topRow);
    }

    const descText = field.description || field.hint;
    if (descText) {
      const desc = document.createElement('div');
      desc.textContent = descText;
      desc.style.fontSize = '11px';
      desc.style.color = 'var(--color-text-muted)';
      row.appendChild(desc);
    }

    container.appendChild(row);
  }
}

function showStatus(text: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  const el = $('status');
  el.textContent = text;
  el.className = `status-box show ${kind}`;
}

async function loadArtifacts(): Promise<void> {
  const staticCfg = await getStaticConfig();
  if (staticCfg.features?.allowArtifacts === false) return;

  const artifacts = (await chrome.runtime.sendMessage({
    type: 'list-artifacts',
  })) as ArtifactIndexEntry[] | { error: string };

  const listEl = $('artifactList');
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No artifacts produced yet.</div>`;
    return;
  }

  const recent = artifacts.slice(0, MAX_POPUP_ARTIFACTS);
  listEl.innerHTML = recent
    .map(
      (a) => `
        <div class="artifact-item" data-id="${a.artifactId}">
          <span class="kind-badge ${kindBadgeClass(a.kind)}">${a.kind}</span>
          <div class="artifact-title">${escapeHtml(a.title)}</div>
          <div class="artifact-time">${formatTime(a.createdAt)}</div>
        </div>`,
    )
    .join('');

  listEl.querySelectorAll<HTMLElement>('.artifact-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id!;
      void chrome.tabs.create({
        url: chrome.runtime.getURL(`dist/artifacts.html?id=${encodeURIComponent(id)}`),
      });
    });
  });
}

// ─── Dashboard Telemetry (Live Progress Card & Live Console Drawer) ──
const dashboardProgressMount = $('dashboardProgressMount');
const dashboardConsoleMount = $('dashboardConsoleMount');
const dashboardTelemetry = mountDashboardTelemetry(dashboardProgressMount, dashboardConsoleMount);

$('runNow').addEventListener('click', async () => {
  dashboardTelemetry.startProgress('Running agent task...');
  const btn = $('runNow') as HTMLButtonElement;
  btn.disabled = true;
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
    <span>Running agent…</span>
  `;
  try {
    const result = (await chrome.runtime.sendMessage({
      type: 'run-now',
    })) as AuditEntry;

    if (result.status === 'ok') {
      const cfg = await getConfig();
      const costSuffix = cfg.ui?.showCosts !== false ? ` · $${result.tokens.estimatedCost.toFixed(4)}` : '';
      showStatus(
        `✓ OK · ${result.toolCalls.length} tool call(s)${costSuffix}`,
        'ok',
      );
    } else if (result.status === 'stopped') {
      showStatus('Run stopped by user', 'ok');
    } else {
      showStatus(result.summary || 'Run completed with error', 'error');
    }
    await loadArtifacts();
    await checkUndoToast();
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>Run Agent Now</span>
    `;
  }
});

async function openSidePanel(): Promise<void> {
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (currentWindow?.id) {
      await chrome.sidePanel.open({ windowId: currentWindow.id });
      window.close();
    }
  } catch (err) {
    console.warn('Failed to open side panel:', err);
  }
}

if ($('openSidePanelBtn')) $('openSidePanelBtn').addEventListener('click', () => void openSidePanel());
if ($('openSidePanel')) $('openSidePanel').addEventListener('click', () => void openSidePanel());

if ($('keyStatusBadge')) {
  $('keyStatusBadge').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

if ($('openOptionsTop')) {
  $('openOptionsTop').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

if ($('openOptions')) {
  $('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

const openArtifactsBrowser = () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('dist/artifacts.html'),
  });
};

if ($('openArtifacts')) $('openArtifacts').addEventListener('click', openArtifactsBrowser);
if ($('openArtifactsTop')) $('openArtifactsTop').addEventListener('click', openArtifactsBrowser);

export function openExtensionStudio(): void {
  const url = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
    ? chrome.runtime.getURL('dist/studio.html')
    : 'studio.html';
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

const openStudioTopBtn = $('openStudioTop');
if (openStudioTopBtn) {
  openStudioTopBtn.addEventListener('click', () => openExtensionStudio());
}

const openStudioBtn = $('openStudio');
if (openStudioBtn) {
  openStudioBtn.addEventListener('click', () => openExtensionStudio());
}

const exportLogsBtn = $('exportLogsBtn');
if (exportLogsBtn) {
  exportLogsBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const liveRes = (await chrome.runtime.sendMessage({ type: 'get-live-logs' })) || {};
      const auditRes = (await chrome.runtime.sendMessage({ type: 'get-audit-index' })) || [];
      const historyRes = (await chrome.runtime.sendMessage({ type: 'get-action-history', limit: 50 })) || {};
      const manifest = chrome.runtime.getManifest();

      const bundle = {
        exportedAt: new Date().toISOString(),
        manifest,
        liveStatus: liveRes.status,
        logs: liveRes.logs || [],
        actionHistory: historyRes.history || [],
        auditIndex: auditRes,
      };

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const extName = (manifest.name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      a.href = url;
      a.download = `${extName}-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showStatus('Logs exported successfully', 'ok');
    } catch (err) {
      showStatus(`Export failed: ${(err as Error).message}`, 'error');
    }
  });
}

// ─── Dynamic View Toggle Controller ─────────────────────────────────
const dynamicContainer = $('dynamicPopup');
const standardContainer = $('standardPopup');
const viewSwitcher = $('viewSwitcher');
const standardTab = $('switchToStandard');
const dynamicTab = $('switchToDynamic');
const renderer = new UIRenderer(dynamicContainer, 'popup');

function getComponents(spec?: UISchema | null): any[] {
  if (!spec) return [];
  if (Array.isArray(spec.layout)) return spec.layout;
  if (Array.isArray(spec.components)) return spec.components;
  return [];
}

async function checkDynamicUI(): Promise<void> {
  const cfg = await getConfig();
  const staticCfg = await getStaticConfig();

  // If showAuditUI is disabled, completely hide the Agent UI from popup and stay on standard Dashboard view
  if (
    cfg.ui?.showAuditUI === false ||
    staticCfg.features?.showAuditUI === false ||
    (staticCfg as any).showAuditUI === false
  ) {
    if (viewSwitcher) viewSwitcher.style.display = 'none';
    showStandard();
    return;
  }

  const data = (await chrome.storage.local.get('__pib_dynamic_ui')) as {
    __pib_dynamic_ui?: UISchema;
  };
  let spec = data.__pib_dynamic_ui;
  let comps = getComponents(spec);
  if (comps.length === 0) {
    const promptSpec = await loadPromptUIBlock();
    if (promptSpec && getComponents(promptSpec).length > 0) {
      spec = promptSpec;
      comps = getComponents(spec);
    }
  }

  if (spec && comps.length > 0) {
    if (cfg.ui?.showViewSwitcher === false) {
      viewSwitcher.style.display = 'none';
    } else {
      viewSwitcher.style.display = 'flex';
    }
    const activeData = (await chrome.storage.local.get('__pib_active_view')) as {
      __pib_active_view?: string;
    };
    const activeView = activeData.__pib_active_view || 'dynamic';
    if (activeView === 'dynamic') {
      showDynamic();
    } else {
      showStandard();
    }
  } else {
    showStandard();
    viewSwitcher.style.display = 'none';
  }
}

function showDynamic(): void {
  dynamicContainer.style.display = 'block';
  standardContainer.style.display = 'none';
  dynamicTab.classList.add('active');
  standardTab.classList.remove('active');
  void chrome.storage.local.set({ __pib_active_view: 'dynamic' });
  void renderer.loadAndRender();
}

function showStandard(): void {
  dynamicContainer.style.display = 'none';
  standardContainer.style.display = 'block';
  standardTab.classList.add('active');
  dynamicTab.classList.remove('active');
  void chrome.storage.local.set({ __pib_active_view: 'standard' });
}

standardTab.addEventListener('click', (e) => {
  e.preventDefault();
  showStandard();
});

dynamicTab.addEventListener('click', (e) => {
  e.preventDefault();
  showDynamic();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'ui-state-updated') {
    void checkDynamicUI();
  } else if (msg?.type === 'agent-log' && msg.event) {
    printAgentLogToConsole(msg.event);
    if (msg.status?.active) {
      showStatus(msg.status.statusText, 'info');
    } else if (msg.event.channel === 'run-complete') {
      showStatus(msg.event.title, 'ok');
    } else if (msg.event.channel === 'error') {
      showStatus(msg.event.title, 'error');
    }
  }
});

void loadSummary();
void loadArtifacts();
void checkDynamicUI();
