/**
 * Service worker: schedule, wake, run the prompt, record the outcome.
 *
 * Everything the extension actually *does* is decided by prompt.md. This
 * file's job is:
 *   1. Keep an alarm alive so the SW is revived on schedule.
 *   2. When revived (or when the popup asks), load prompt.md, build the
 *      ToolSet from manifest permissions, run agent-do's loop.
 *   3. Persist a short run log for the popup to show.
 *
 * MV3 SW constraints shape the design:
 *   - No long-running process. Each run is a fresh event handler.
 *   - No globals that survive teardown. State lives in chrome.storage.
 *   - Strict CSP: all script is the bundled self-origin; no eval.
 */

import { runAgentLoop } from 'agent-do';
import { createAnthropic } from '@ai-sdk/anthropic';
import { buildToolSet } from './tools';
import { getConfig } from './config';

const ALARM_NAME = 'prompt-in-a-box-tick';
const LOG_KEY = '__pib_log';
const MAX_LOG_ENTRIES = 20;

interface LogEntry {
  at: number;
  trigger: 'alarm' | 'manual';
  status: 'ok' | 'error' | 'skipped';
  summary: string;
  steps?: number;
  toolCalls?: number;
}

// ─── Lifecycle ─────────────────────────────────────────────────────

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
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: cfg.alarmMinutes,
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await run('alarm');
});

// ─── Popup RPC ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'run-now') {
    run('manual').then(sendResponse);
    return true; // keep channel open for async
  }
  if (msg?.type === 'get-log') {
    getLog().then(sendResponse);
    return true;
  }
  return false;
});

// ─── Main loop ─────────────────────────────────────────────────────

async function run(trigger: 'alarm' | 'manual'): Promise<LogEntry> {
  const startedAt = Date.now();
  try {
    const cfg = await getConfig();
    if (!cfg.apiKey) {
      const entry: LogEntry = {
        at: startedAt,
        trigger,
        status: 'skipped',
        summary: 'no API key configured in popup',
      };
      await appendLog(entry);
      return entry;
    }

    const prompt = await loadPrompt();
    const tools = await buildToolSet();

    const anthropic = createAnthropic({
      apiKey: cfg.apiKey,
      // The Anthropic endpoint rejects browser-origin calls without this flag.
      // Service workers carry extension origin, which the API treats like a
      // browser for CORS purposes.
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
    });

    const result = await runAgentLoop(
      {
        id: 'prompt-in-a-box',
        name: 'Prompt in a Box',
        // agent-do's LanguageModel contract. Each provider SDK returns a
        // model object; casting through unknown is the portable shape used
        // across agent-do's other examples.
        model: anthropic(cfg.model) as unknown as Parameters<typeof runAgentLoop>[0]['model'],
        systemPrompt: prompt,
        tools,
        maxIterations: 8,
      },
      'Begin your scheduled run now.',
    );

    const entry: LogEntry = {
      at: startedAt,
      trigger,
      status: 'ok',
      summary: (result.text || '').slice(0, 200) || '(no output)',
      steps: result.steps,
      toolCalls: result.usage?.records?.length,
    };
    await appendLog(entry);
    log('run complete:', entry);
    return entry;
  } catch (err) {
    const entry: LogEntry = {
      at: startedAt,
      trigger,
      status: 'error',
      summary: err instanceof Error ? err.message : String(err),
    };
    await appendLog(entry);
    log('run failed:', err);
    return entry;
  }
}

async function loadPrompt(): Promise<string> {
  const url = chrome.runtime.getURL('prompt.md');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load prompt.md: ${res.status}`);
  return await res.text();
}

// ─── Run log ───────────────────────────────────────────────────────

async function appendLog(entry: LogEntry): Promise<void> {
  const { [LOG_KEY]: existing = [] } = await chrome.storage.local.get(LOG_KEY);
  const next = [entry, ...(existing as LogEntry[])].slice(0, MAX_LOG_ENTRIES);
  await chrome.storage.local.set({ [LOG_KEY]: next });
}

async function getLog(): Promise<LogEntry[]> {
  const { [LOG_KEY]: stored = [] } = await chrome.storage.local.get(LOG_KEY);
  return stored as LogEntry[];
}

function log(...args: unknown[]): void {
  console.log('[prompt-in-a-box]', ...args);
}
