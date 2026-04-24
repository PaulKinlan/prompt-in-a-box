/**
 * Prompt in a Box — generic agent loop for MV3 service workers.
 *
 * The idea: the manifest declares a prompt file + permissions. This
 * script reads the prompt, exposes Chrome APIs as tools, and runs an
 * agent loop until the model returns a final message with no tool
 * calls. All logic the extension actually *does* lives in prompt.md.
 *
 * MV3 service workers are a good fit for this pattern:
 *   - event-driven (chrome.alarms revives them on schedule)
 *   - sandboxed (no DOM, no raw network beyond host_permissions, no
 *     eval thanks to the extension_pages CSP)
 *   - persist state via chrome.storage, not globals (SW dies between
 *     events, which is fine — the loop runs per wake-up)
 *
 * Nothing here is specific to the tab-hygiene prompt. Swap prompt.md
 * for a different behaviour file and this background.js keeps working
 * — that's the whole point.
 */

import { runLoop } from './loop.js';
import { buildTools } from './tools.js';
import { getConfig } from './config.js';

// ─── Alarms: wake the service worker on schedule ────────────────────

const ALARM_NAME = 'prompt-in-a-box-tick';

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await getConfig();
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: cfg.alarmMinutes,
  });
  log('installed; alarm scheduled every', cfg.alarmMinutes, 'min');
});

chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getConfig();
  // Ensure alarm exists on browser restart. `create` replaces if
  // already present, which is fine.
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: cfg.alarmMinutes,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await run('alarm');
});

// ─── Popup message: run-now button ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'run-now') {
    run('manual').then((result) => sendResponse(result));
    return true; // keep the message channel open for async response
  }
  if (msg?.type === 'get-log') {
    getLog().then(sendResponse);
    return true;
  }
  return false;
});

// ─── Main: fetch prompt, build tools, run loop ──────────────────────

async function run(trigger) {
  const startedAt = Date.now();
  try {
    const cfg = await getConfig();
    if (!cfg.apiKey) {
      const msg = `skipped (${trigger}): no API key configured in popup`;
      await appendLog({ at: startedAt, trigger, status: 'skipped', summary: msg });
      return { ok: false, summary: msg };
    }

    const prompt = await loadPrompt();
    const tools = buildTools();

    const result = await runLoop({
      prompt,
      tools,
      provider: cfg.provider,
      model: cfg.model,
      apiKey: cfg.apiKey,
      maxSteps: 8,
    });

    const entry = {
      at: startedAt,
      trigger,
      status: 'ok',
      summary: result.text?.slice(0, 200) || '(no output)',
      steps: result.steps,
      toolCalls: result.toolCalls,
    };
    await appendLog(entry);
    log('run complete:', entry);
    return { ok: true, ...entry };
  } catch (err) {
    const summary = err?.message || String(err);
    const entry = { at: startedAt, trigger, status: 'error', summary };
    await appendLog(entry);
    log('run failed:', err);
    return { ok: false, ...entry };
  }
}

async function loadPrompt() {
  const url = chrome.runtime.getURL('prompt.md');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load prompt.md: ${res.status}`);
  return await res.text();
}

// ─── Lightweight log (last 20 runs) ─────────────────────────────────

const LOG_KEY = '__pib_log';

async function appendLog(entry) {
  const { [LOG_KEY]: existing = [] } = await chrome.storage.local.get(LOG_KEY);
  const next = [entry, ...existing].slice(0, 20);
  await chrome.storage.local.set({ [LOG_KEY]: next });
}

async function getLog() {
  const { [LOG_KEY]: log = [] } = await chrome.storage.local.get(LOG_KEY);
  return log;
}

function log(...args) {
  // Prefix so operators can filter the service-worker console.
  console.log('[prompt-in-a-box]', ...args);
}
