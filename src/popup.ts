/**
 * Popup: quick glance + run trigger. All settings and the full audit
 * view live on the options page (right-click the extension icon →
 * Options, or click the "Settings & audit" button here).
 */

import { getConfig, activeKey, PROVIDER_LABELS } from './config';
import type { AuditEntry } from './audit';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function loadUI(): Promise<void> {
  const cfg = await getConfig();
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  $('summaryProvider').textContent = PROVIDER_LABELS[cfg.provider];
  const hasKey = Boolean(activeKey(cfg));
  const metaParts = [
    cfg.model,
    `every ${cfg.alarmMinutes} min`,
    hasKey ? 'key set' : 'no key',
  ];
  $('summaryMeta').textContent = metaParts.join(' · ');
  if (!hasKey) {
    ($('runNow') as HTMLButtonElement).disabled = true;
    $('status').textContent = 'No API key. Open Settings to add one.';
  }
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
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run now';
  }
});

$('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

loadUI();
