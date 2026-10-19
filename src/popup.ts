/**
 * Popup: quick glance + run trigger + recent artifacts.
 */

import { getConfig, activeKey, PROVIDER_LABELS, getStaticConfig } from './config';
import type { AuditEntry } from './audit';
import type { ArtifactIndexEntry, ArtifactKind } from './artifacts';
import { UIRenderer, type UISchema } from './ui-renderer';

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
  $('extName').textContent = manifest.name;
  $('version').textContent = 'v' + manifest.version;
  $('summaryProvider').textContent = PROVIDER_LABELS[cfg.provider] || cfg.provider;
  $('summaryModel').textContent = cfg.model;
  $('summarySchedule').textContent = `Every ${cfg.alarmMinutes}m`;

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

  // Feature flag enforcement
  if (staticCfg.features?.allowManualRun === false) {
    runBtn.style.display = 'none';
  }
  if (staticCfg.features?.allowArtifacts === false) {
    $('artifactsSection').style.display = 'none';
    $('openArtifacts').style.display = 'none';
  }
  if (staticCfg.features?.allowSidePanel === false) {
    $('openSidePanelBtn').style.display = 'none';
    $('openSidePanel').style.display = 'none';
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

$('runNow').addEventListener('click', async () => {
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
      showStatus(
        `✓ OK · ${result.toolCalls.length} tool call(s) · $${result.tokens.estimatedCost.toFixed(4)}`,
        'ok',
      );
    } else {
      showStatus(result.summary || 'Run completed with error', 'error');
    }
    await loadArtifacts();
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

$('openSidePanelBtn').addEventListener('click', () => void openSidePanel());
$('openSidePanel').addEventListener('click', () => void openSidePanel());

$('keyStatusBadge').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('openOptionsTop').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

const openArtifactsBrowser = () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('dist/artifacts.html'),
  });
};

$('openArtifacts').addEventListener('click', openArtifactsBrowser);
$('openArtifactsTop').addEventListener('click', openArtifactsBrowser);

// ─── Dynamic View Toggle Controller ─────────────────────────────────
const dynamicContainer = $('dynamicPopup');
const standardContainer = $('standardPopup');
const viewSwitcher = $('viewSwitcher');
const standardTab = $('switchToStandard');
const dynamicTab = $('switchToDynamic');
const renderer = new UIRenderer(dynamicContainer, 'popup');

async function checkDynamicUI(): Promise<void> {
  const data = (await chrome.storage.local.get('__pib_dynamic_ui')) as {
    __pib_dynamic_ui?: UISchema;
  };
  const spec = data.__pib_dynamic_ui;

  if (spec && spec.components && spec.components.length > 0) {
    viewSwitcher.style.display = 'flex';
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
  }
});

void loadSummary();
void loadArtifacts();
void checkDynamicUI();
