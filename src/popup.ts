import { getConfig, setConfig } from './config';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

async function loadUI(): Promise<void> {
  const cfg = await getConfig();
  ($('apiKey') as HTMLInputElement).value = cfg.apiKey;
  ($('model') as HTMLInputElement).value = cfg.model;
  ($('alarmMinutes') as HTMLInputElement).value = String(cfg.alarmMinutes);
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  await refreshLog();
}

$('save').addEventListener('click', async () => {
  const alarmMinutes = Number(($('alarmMinutes') as HTMLInputElement).value) || 30;
  await setConfig({
    apiKey: ($('apiKey') as HTMLInputElement).value.trim(),
    model: ($('model') as HTMLInputElement).value.trim(),
    alarmMinutes,
  });
  await chrome.alarms.create('prompt-in-a-box-tick', {
    delayInMinutes: 1,
    periodInMinutes: alarmMinutes,
  });
  flash($('save'), 'Saved');
});

$('runNow').addEventListener('click', async () => {
  const btn = $('runNow') as HTMLButtonElement;
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

async function refreshLog(): Promise<void> {
  const log = (await chrome.runtime.sendMessage({ type: 'get-log' })) as Array<{
    at: number;
    trigger: string;
    status: string;
    summary: string;
  }> | null;
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
    const whenEl = document.createElement('div');
    whenEl.className = 'when';
    whenEl.textContent = `${when} · ${entry.trigger}`;
    const statusEl = document.createElement('div');
    statusEl.className = `status-${entry.status}`;
    statusEl.textContent = entry.summary;
    div.appendChild(whenEl);
    div.appendChild(statusEl);
    container.appendChild(div);
  }
}

function flash(btn: HTMLElement, text: string): void {
  const original = btn.textContent ?? '';
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

loadUI();
