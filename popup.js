/**
 * Popup — settings + recent-runs log.
 *
 * Pure UI. All behaviour lives in background.js + prompt.md.
 */

import { getConfig, setConfig } from './config.js';

const $ = (id) => document.getElementById(id);

async function loadUI() {
  const cfg = await getConfig();
  $('apiKey').value = cfg.apiKey;
  $('model').value = cfg.model;
  $('alarmMinutes').value = cfg.alarmMinutes;
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  await refreshLog();
}

$('save').addEventListener('click', async () => {
  await setConfig({
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    alarmMinutes: Number($('alarmMinutes').value) || 30,
  });
  // Reflow the alarm so the new interval takes effect.
  await chrome.alarms.create('prompt-in-a-box-tick', {
    delayInMinutes: 1,
    periodInMinutes: Number($('alarmMinutes').value) || 30,
  });
  flash($('save'), 'Saved');
});

$('runNow').addEventListener('click', async () => {
  const btn = $('runNow');
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    await chrome.runtime.sendMessage({ type: 'run-now' });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run now';
    await refreshLog();
  }
});

async function refreshLog() {
  const log = await chrome.runtime.sendMessage({ type: 'get-log' });
  const container = $('log');
  container.innerHTML = '';
  if (!log || log.length === 0) {
    container.innerHTML = '<div class="log-entry status-skipped">No runs yet.</div>';
    return;
  }
  for (const entry of log) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    const when = new Date(entry.at).toLocaleTimeString();
    div.innerHTML = `
      <div class="when">${escapeHtml(when)} · ${escapeHtml(entry.trigger)}</div>
      <div class="status-${escapeHtml(entry.status)}">${escapeHtml(entry.summary)}</div>
    `;
    container.appendChild(div);
  }
}

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

loadUI();
