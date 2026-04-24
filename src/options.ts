/**
 * Options page: provider selection, API keys per provider, schedule,
 * and a full audit log of every action the agent has taken.
 *
 * Same UI doubles as the onboarding flow — if the config's `onboarded`
 * flag is false, a banner explains the three steps to get running.
 */

import {
  getConfig,
  setConfig,
  activeKey,
  PROVIDER_DEFAULTS,
  PROVIDER_LABELS,
  PROVIDER_ENDPOINTS,
  type Config,
  type Provider,
} from './config';
import type { AuditEntry, AuditIndexEntry } from './audit';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

let currentConfig: Config;
let currentProvider: Provider = 'anthropic';

async function loadUI(): Promise<void> {
  currentConfig = await getConfig();
  currentProvider = currentConfig.provider;

  if (!currentConfig.onboarded) {
    $('onboarding').hidden = false;
  }

  renderProviderGrid();
  renderActiveProvider();
  ($('alarmMinutes') as HTMLInputElement).value = String(currentConfig.alarmMinutes);

  await refreshAudit();
}

function renderProviderGrid(): void {
  const grid = $('providerGrid');
  grid.innerHTML = '';
  for (const key of ['anthropic', 'google', 'openai'] as Provider[]) {
    const card = document.createElement('div');
    card.className = 'provider-card' + (key === currentProvider ? ' selected' : '');
    card.dataset.provider = key;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = PROVIDER_LABELS[key];
    const model = document.createElement('div');
    model.className = 'model';
    model.textContent = PROVIDER_DEFAULTS[key].model;
    card.appendChild(label);
    card.appendChild(model);
    card.addEventListener('click', () => {
      currentProvider = key;
      renderProviderGrid();
      renderActiveProvider();
    });
    grid.appendChild(card);
  }
}

function renderActiveProvider(): void {
  ($('apiKey') as HTMLInputElement).value = currentConfig.keys[currentProvider] ?? '';
  const currentModel =
    currentProvider === currentConfig.provider
      ? currentConfig.model
      : PROVIDER_DEFAULTS[currentProvider].model;
  ($('model') as HTMLInputElement).value = currentModel;
  const hint = PROVIDER_DEFAULTS[currentProvider].hint +
    ` · key sent only to ${PROVIDER_ENDPOINTS[currentProvider]}`;
  $('apiKeyHint').textContent = hint;
}

// ─── Save / test / run ────────────────────────────────────────────

function collectConfig(): Partial<Config> {
  const alarmMinutes = Number(($('alarmMinutes') as HTMLInputElement).value) || 30;
  const apiKeyValue = ($('apiKey') as HTMLInputElement).value.trim();
  const model = ($('model') as HTMLInputElement).value.trim() || PROVIDER_DEFAULTS[currentProvider].model;
  const keys: Record<Provider, string> = {
    ...currentConfig.keys,
    [currentProvider]: apiKeyValue,
  };
  return {
    provider: currentProvider,
    model,
    alarmMinutes,
    keys,
  };
}

$('save').addEventListener('click', async () => {
  const patch = collectConfig();
  await setConfig({ ...patch, onboarded: true });
  await chrome.runtime.sendMessage({ type: 'reschedule-alarm' });
  currentConfig = await getConfig();
  $('onboarding').hidden = true;
  toast('Saved');
});

$('test').addEventListener('click', async () => {
  const btn = $('test') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Testing…';
  try {
    const patch = collectConfig();
    const result = (await chrome.runtime.sendMessage({
      type: 'test-provider',
      config: patch,
    })) as AuditEntry;
    if (result.status === 'ok') {
      toast(`Test OK · ${result.steps} step${result.steps === 1 ? '' : 's'} · $${result.tokens.estimatedCost.toFixed(4)}`);
    } else {
      toast(result.summary, 'error');
    }
    await refreshAudit();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test';
  }
});

$('runNow').addEventListener('click', async () => {
  const btn = $('runNow') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const result = (await chrome.runtime.sendMessage({
      type: 'run-now',
    })) as AuditEntry;
    toast(`Run complete · ${result.toolCalls.length} tool call${result.toolCalls.length === 1 ? '' : 's'}`);
    await refreshAudit();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run now';
  }
});

// ─── Audit ─────────────────────────────────────────────────────────

$('refreshAudit').addEventListener('click', () => refreshAudit());
$('clearAudit').addEventListener('click', async () => {
  if (!confirm('Clear all audit history? This cannot be undone.')) return;
  await chrome.runtime.sendMessage({ type: 'clear-audit' });
  await refreshAudit();
});
$('exportAudit').addEventListener('click', async () => {
  const index = (await chrome.runtime.sendMessage({
    type: 'get-audit-index',
  })) as AuditIndexEntry[];
  const detailed: AuditEntry[] = [];
  for (const row of index) {
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

async function refreshAudit(): Promise<void> {
  const index = (await chrome.runtime.sendMessage({
    type: 'get-audit-index',
  })) as AuditIndexEntry[];

  const ok = index.filter((r) => r.status === 'ok').length;
  const toolTotal = index.reduce((n, r) => n + r.toolCallCount, 0);
  const costTotal = index.reduce((c, r) => c + r.estimatedCost, 0);
  $('stat-runs').textContent = String(index.length);
  $('stat-ok').textContent = String(ok);
  $('stat-tools').textContent = String(toolTotal);
  $('stat-cost').textContent = '$' + costTotal.toFixed(4);

  const list = $('auditList');
  list.innerHTML = '';
  if (index.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'audit-row';
    empty.style.opacity = '0.6';
    empty.textContent = 'No runs yet. Hit “Run now” or wait for the alarm.';
    list.appendChild(empty);
    return;
  }

  for (const row of index) {
    list.appendChild(renderAuditRow(row));
  }
}

function renderAuditRow(row: AuditIndexEntry): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'audit-row';

  const cols = document.createElement('div');
  cols.className = 'audit-cols';

  const when = new Date(row.startedAt).toLocaleString();
  const trigger = row.status === 'skipped' ? 'skipped' : extractTrigger(row);

  cols.innerHTML = `
    <div>${escapeHtml(when)}</div>
    <div>${escapeHtml(trigger)}</div>
    <div class="status-${row.status}">${escapeHtml(row.summary)}</div>
    <div>${row.toolCallCount}</div>
    <div></div>
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

function extractTrigger(row: AuditIndexEntry): string {
  // Index doesn't carry the trigger verbatim; fall back to a label.
  return row.status;
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
  el.textContent = text;
  el.className = `toast show ${kind === 'error' ? 'error' : ''}`;
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

loadUI();
