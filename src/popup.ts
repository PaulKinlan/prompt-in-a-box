/**
 * Popup: quick glance + run trigger + recent artifacts. Settings and
 * the full audit view live on the options page; the full artifact
 * browser lives at dist/artifacts.html.
 */

import { getConfig, activeKey, PROVIDER_LABELS } from './config';
import type { AuditEntry } from './audit';
import type { ArtifactIndexEntry, ArtifactKind } from './artifacts';

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
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  $('summaryProvider').textContent = PROVIDER_LABELS[cfg.provider];
  const hasKey = Boolean(activeKey(cfg));
  const metaParts = [
    cfg.model,
    `every ${cfg.alarmMinutes} min`,
    hasKey ? 'key set' : 'no key',
  ];
  $('summaryMeta').textContent = ' · ' + metaParts.join(' · ');
  if (!hasKey) {
    ($('runNow') as HTMLButtonElement).disabled = true;
    $('status').textContent = 'No API key. Open Settings to add one.';
  }
}

async function loadArtifacts(): Promise<void> {
  const artifacts = (await chrome.runtime.sendMessage({
    type: 'list-artifacts',
  })) as ArtifactIndexEntry[] | { error: string };
  const listEl = $('artifactList');
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    listEl.innerHTML = `<div class="empty">Nothing yet — artifacts appear here once the agent creates some.</div>`;
    return;
  }
  const recent = artifacts.slice(0, MAX_POPUP_ARTIFACTS);
  listEl.innerHTML = recent
    .map(
      (a) => `
        <div class="artifact" data-id="${a.artifactId}">
          <span class="kind-badge ${kindBadgeClass(a.kind)}">${a.kind}</span>
          <div class="title">${escapeHtml(a.title)}</div>
          <div class="time">${formatTime(a.createdAt)}</div>
        </div>`,
    )
    .join('');
  listEl.querySelectorAll<HTMLElement>('.artifact').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id!;
      void chrome.tabs.create({
        url: chrome.runtime.getURL(`dist/artifacts.html#${id}`),
      });
    });
  });
}

$('runNow').addEventListener('click', async () => {
  const btn = $('runNow') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running…';
  $('status').textContent = '';
  try {
    const result = (await chrome.runtime.sendMessage({
      type: 'run-now',
    })) as AuditEntry;
    $('status').textContent =
      result.status === 'ok'
        ? `OK · ${result.toolCalls.length} tool call(s) · $${result.tokens.estimatedCost.toFixed(4)}`
        : result.summary;
    await loadArtifacts();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run now';
  }
});

$('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

$('openArtifacts').addEventListener('click', () => {
  void chrome.tabs.create({
    url: chrome.runtime.getURL('dist/artifacts.html'),
  });
});

void loadSummary();
void loadArtifacts();
