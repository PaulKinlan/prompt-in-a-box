import { UIRenderer } from './ui-renderer';
import {
  getConfig,
  getStaticConfig,
  activeKey,
  PROVIDER_LABELS,
  type Config,
} from './config';
import type { AuditEntry, AuditIndexEntry } from './audit';
import type { ArtifactIndexEntry } from './artifacts';

const INDEX_KEY = '__pib_artifact_index';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

document.addEventListener('DOMContentLoaded', async () => {
  const container = $('app-root');
  if (!container) return;

  const renderer = new UIRenderer(container, 'sidepanel');

  // Load manifest & config metadata
  const manifest = chrome.runtime.getManifest();
  if ($('extName')) $('extName').textContent = manifest.name;
  if ($('version')) $('version').textContent = `v${manifest.version}`;

  const staticCfg = await getStaticConfig();
  const cfg = await getConfig();

  // Features and UI config gating
  if (staticCfg.features?.allowManualRun === false || cfg.ui?.allowManualRun === false) {
    const runBtn = $('runNowBtn');
    if (runBtn) runBtn.style.display = 'none';
  }
  if (staticCfg.features?.allowArtifacts === false || cfg.ui?.allowArtifacts === false || cfg.ui?.showRecentArtifacts === false) {
    const artBtn = $('openArtifactsBtn');
    if (artBtn) artBtn.style.display = 'none';
  }
  if (cfg.ui?.showSidePanelStatusBar === false) {
    const sb = document.querySelector('.sp-status-bar') as HTMLElement | null;
    if (sb) sb.style.display = 'none';
  }

  async function updateStatusBar(currentCfg?: Config): Promise<void> {
    const current = currentCfg ?? (await getConfig());
    const providerLabel = PROVIDER_LABELS[current.provider] || current.provider;
    $('spProviderModel').textContent = `${providerLabel} · ${current.model}`;

    const hasKey = Boolean(activeKey(current)?.trim());
    const keyBadge = $('spKeyStatus');
    const keyText = $('spKeyText');
    if (hasKey) {
      keyBadge.className = 'status-pill status-ready';
      keyText.textContent = 'Key Ready';
    } else {
      keyBadge.className = 'status-pill status-missing';
      keyText.textContent = 'No Key';
    }
  }

  void updateStatusBar(cfg);

  // Undo Toast Banner
  await checkUndoToast();

  // Agent Settings Card
  await loadAgentSettings();

  // 1. Initial render of saved or welcoming state
  void renderer.loadAndRender();

  // 2. Listen for push updates from background SW when the agent outputs a new UI
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ui-state-updated' && msg.ui) {
      renderer.render(msg.ui);
    }
  });

  // 3. Notify the background service worker that sidepanel is open to trigger agent execution
  void chrome.runtime.sendMessage({ type: 'ui-opened', view: 'sidepanel' });

  // 4. Wire header actions
  const runBtn = $('runNowBtn') as HTMLButtonElement;
  const statusEl = $('spRunStatus');
  let runTimer: ReturnType<typeof setTimeout> | null = null;

  function showStatus(text: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = `sp-run-status show ${kind === 'error' ? 'error' : kind === 'ok' ? 'ok' : ''}`;
    if (runTimer) clearTimeout(runTimer);
    if (kind !== 'info') {
      runTimer = setTimeout(() => {
        statusEl.className = 'sp-run-status';
      }, 3500);
    }
  }

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      runBtn.disabled = true;
      showStatus('Executing agent loop…', 'info');
      try {
        const result = (await chrome.runtime.sendMessage({
          type: 'run-now',
        })) as AuditEntry;

        if (result.status === 'ok') {
          showStatus(
            `Agent completed · ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'}`,
            'ok'
          );
        } else {
          showStatus(result.summary || 'Run failed', 'error');
        }
        await renderer.loadAndRender();
        await refreshDrawer();
        await checkUndoToast();
      } catch (err) {
        showStatus((err as Error).message || 'Execution error', 'error');
      } finally {
        runBtn.disabled = false;
      }
    });
  }

  const artBtn = $('openArtifactsBtn');
  if (artBtn) {
    artBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('artifacts.html') });
    });
  }

  const optBtn = $('openOptionsBtn');
  if (optBtn) {
    optBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  // Undo Toast Controller
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
          await renderer.loadAndRender();
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

  // Agent Settings Controller
  async function loadAgentSettings(): Promise<void> {
    const config = await getConfig();
    const card = $('agentSettingsCard');
    const container = $('agentSettingsFields');
    if (!card || !container) return;

    const fields = config.agentSettings?.fields;
    if (!fields || fields.length === 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';
    if (config.agentSettings?.title && $('agentSettingsTitle')) {
      $('agentSettingsTitle').textContent = config.agentSettings.title;
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
        label.style.fontSize = '12px';
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
        label.style.fontSize = '11.5px';
        label.style.fontWeight = '600';

        const select = document.createElement('select');
        select.style.padding = '2px 6px';
        select.style.fontSize = '11px';
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
        desc.style.fontSize = '10.5px';
        desc.style.color = 'var(--color-text-muted)';
        row.appendChild(desc);
      }

      container.appendChild(row);
    }
  }

  // 5. Activity Drawer
  const toggleDrawerBtn = $('toggleActivityBtn');
  const drawerContent = $('activityDrawerContent');
  const chevron = $('activityChevron');

  if (toggleDrawerBtn && drawerContent) {
    toggleDrawerBtn.addEventListener('click', () => {
      const isOpen = drawerContent.classList.toggle('open');
      toggleDrawerBtn.setAttribute('aria-expanded', String(isOpen));
      if (chevron) chevron.textContent = isOpen ? '▴' : '▾';
      if (isOpen) {
        void refreshDrawer();
      }
    });
  }

  async function refreshDrawer(): Promise<void> {
    try {
      const runs = (await chrome.runtime.sendMessage({
        type: 'get-audit-index',
      })) as AuditIndexEntry[];

      const runsContainer = $('spRecentRuns');
      if (runsContainer) {
        runsContainer.innerHTML = '';
        const recentRuns = (runs || []).slice(0, 5);
        if (recentRuns.length === 0) {
          runsContainer.innerHTML = '<div style="opacity: 0.6; font-size: 11px;">No runs recorded yet.</div>';
        } else {
          for (const r of recentRuns) {
            const row = document.createElement('div');
            row.className = 'drawer-item';
            const time = new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const statusColor = r.status === 'ok' ? 'var(--color-success)' : r.status === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)';
            row.innerHTML = `
              <div class="drawer-item-title" title="${escapeHtml(r.summary || '')}">
                <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${statusColor}; margin-right:4px;"></span>
                ${escapeHtml(r.summary || r.trigger || '')}
              </div>
              <div class="drawer-item-meta">${time}</div>
            `;
            row.addEventListener('click', () => {
              chrome.runtime.openOptionsPage();
            });
            runsContainer.appendChild(row);
          }
        }
      }

      // Recent artifacts
      const stored = await chrome.storage.local.get(INDEX_KEY);
      const artifacts = ((stored[INDEX_KEY] as ArtifactIndexEntry[]) || []).slice(0, 5);
      const artContainer = $('spRecentArtifacts');
      if (artContainer) {
        artContainer.innerHTML = '';
        if (artifacts.length === 0) {
          artContainer.innerHTML = '<div style="opacity: 0.6; font-size: 11px;">No artifacts produced yet.</div>';
        } else {
          for (const a of artifacts) {
            const row = document.createElement('div');
            row.className = 'drawer-item';
            const time = new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            row.innerHTML = `
              <div class="drawer-item-title" title="${escapeHtml(a.title)}">
                <span style="font-size:9.5px; font-weight:700; text-transform:uppercase; color:var(--color-accent); margin-right:4px;">${a.kind.replace('image-', '')}</span>
                ${escapeHtml(a.title)}
              </div>
              <div class="drawer-item-meta">${time}</div>
            `;
            row.addEventListener('click', () => {
              chrome.tabs.create({ url: chrome.runtime.getURL(`artifacts.html?id=${encodeURIComponent(a.artifactId)}`) });
            });
            artContainer.appendChild(row);
          }
        }
      }
    } catch {
      // Ignore background communication failures
    }
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
});
