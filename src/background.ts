/**
 * Service worker: schedule, wake, run the prompt, record the outcome.
 *
 * Everything the extension actually *does* is decided by prompt.md.
 * This file's responsibilities are:
 *   1. Keep an alarm alive so the SW is revived on schedule.
 *   2. When revived (or asked), load prompt.md, build the ToolSet
 *      from manifest permissions, pick the right provider, drain any
 *      queued Chrome events, and run agent-do's loop.
 *   3. Capture a full audit trail (tool calls, token usage, cost) to
 *      OPFS + a summary index in chrome.storage.
 *   4. On first install, open the options page so the user can pick
 *      a provider and paste a key.
 *   5. Subscribe to Chrome events via the events dispatcher so the
 *      agent can respond to things that happen in the browser
 *      (context-menu clicks, bookmark changes, downloads, etc.).
 */

import { runAgentLoop, DEFAULT_PRICING, estimateCost } from 'agent-do';
import type { AgentHooks } from 'agent-do';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { buildToolSet } from './tools';
import { getProviderTools, filterProviderTools } from './provider-tools';
import { getConfig, activeKey, type Config, type Provider } from './config';
import {
  writeAudit,
  getAuditIndex,
  getAuditEntry,
  clearAudit,
  newRunId,
  type AuditEntry,
  type AuditToolCall,
} from './audit';
import {
  getArtifact,
  deleteArtifact,
  clearArtifacts,
  listArtifacts,
} from './artifacts';
import { startEvents } from './events/dispatcher';
import { drainEvents } from './events/queue';

const ALARM_NAME = 'prompt-in-a-box-tick';

// ─── Lifecycle ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  const cfg = await getConfig();
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: cfg.alarmMinutes,
  });
  log('installed; alarm scheduled every', cfg.alarmMinutes, 'min');

  if (details.reason === 'install' || !cfg.onboarded) {
    chrome.runtime.openOptionsPage();
  }

  // Fire a bootstrap run so the prompt can set up context menus,
  // seed defaults, register commands, etc. on install/update/reload.
  // run() no-ops with a 'skipped' audit if there's no API key yet.
  const trigger: AuditEntry['trigger'] =
    details.reason === 'update' ? 'update' : 'install';
  await run(trigger).catch((err) => console.warn('[prompt-in-a-box] bootstrap run failed:', err));
});

chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getConfig();
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: cfg.alarmMinutes,
  });
  // Startup run so the prompt can check state, drain any events that
  // queued between sessions, and re-assert context menus / commands.
  await run('startup').catch((err) => console.warn('[prompt-in-a-box] startup run failed:', err));
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await run('alarm');
});

// Subscribe to all Chrome events the manifest grants permission for.
// Event firings append to an OPFS queue; immediate-trigger events
// (context menu clicks etc.) call `run('event')` right away.
const triggerRun = async (): Promise<void> => {
  await run('event');
};
startEvents(triggerRun).catch((err) => {
  console.warn('[prompt-in-a-box] events bootstrap failed:', err);
});

// ─── Popup / options RPC ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Ignore messages targeted at the offscreen document.
  if (msg?.target === 'offscreen') return false;

  (async () => {
    try {
      if (msg?.type === 'run-now') {
        sendResponse(await run('manual'));
      } else if (msg?.type === 'test-provider') {
        sendResponse(await testProvider(msg.config as Partial<Config>));
      } else if (msg?.type === 'get-audit-index') {
        sendResponse(await getAuditIndex());
      } else if (msg?.type === 'get-audit-entry') {
        sendResponse(await getAuditEntry(msg.runId as string));
      } else if (msg?.type === 'clear-audit') {
        await clearAudit();
        sendResponse({ ok: true });
      } else if (msg?.type === 'list-artifacts') {
        sendResponse(await listArtifacts());
      } else if (msg?.type === 'get-artifact') {
        sendResponse(await getArtifact(msg.artifactId as string));
      } else if (msg?.type === 'delete-artifact') {
        await deleteArtifact(msg.artifactId as string);
        sendResponse({ ok: true });
      } else if (msg?.type === 'clear-artifacts') {
        await clearArtifacts();
        sendResponse({ ok: true });
      } else if (msg?.type === 'reschedule-alarm') {
        const cfg = await getConfig();
        await chrome.alarms.create(ALARM_NAME, {
          delayInMinutes: 1,
          periodInMinutes: cfg.alarmMinutes,
        });
        // Permissions may have changed since last boot; re-scan.
        startEvents(triggerRun).catch(() => {});
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: `unknown message type: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});

// ─── Main loop ─────────────────────────────────────────────────────

async function run(trigger: AuditEntry['trigger']): Promise<AuditEntry> {
  const runId = newRunId();
  const startedAt = Date.now();
  const cfg = await getConfig();
  const apiKey = activeKey(cfg);

  if (!apiKey) {
    const entry: AuditEntry = {
      runId,
      startedAt,
      finishedAt: Date.now(),
      trigger,
      status: 'skipped',
      provider: cfg.provider,
      model: cfg.model,
      summary: `skipped: no ${cfg.provider} API key configured (open the options page to set one)`,
      toolCalls: [],
      tokens: { input: 0, output: 0, estimatedCost: 0 },
    };
    await writeAudit(entry);
    return entry;
  }

  const prompt = await loadPrompt();
  const customTools = await buildToolSet();
  const providerTools = filterProviderTools(
    getProviderTools(cfg.provider, apiKey),
    cfg.disabledProviderTools,
  );
  // Merge: custom tools win on name conflict (never expected, but let's
  // be deterministic if anthropic ever ships a tool named the same as
  // one of ours).
  const tools = { ...providerTools, ...customTools };
  const toolCalls: AuditToolCall[] = [];
  const pendingByName = new Map<string, { at: number; args: unknown }>();
  let tokens = { input: 0, output: 0, estimatedCost: 0 };

  const hooks: AgentHooks = {
    onPreToolUse: async (event) => {
      pendingByName.set(`${event.step}:${event.toolName}`, {
        at: Date.now(),
        args: event.args,
      });
      return { decision: 'allow' };
    },
    onPostToolUse: async (event) => {
      const key = `${event.step}:${event.toolName}`;
      const pending = pendingByName.get(key);
      pendingByName.delete(key);
      toolCalls.push({
        at: pending?.at ?? Date.now(),
        name: event.toolName,
        args: pending?.args ?? event.args,
        durationMs: event.durationMs,
        result: event.result,
      });
    },
    onUsage: async (record) => {
      tokens.input += record.inputTokens;
      tokens.output += record.outputTokens;
      tokens.estimatedCost += record.estimatedCost;
    },
  };

  try {
    const model = pickModel(cfg.provider, cfg.model, apiKey);
    const userMessage = await composeUserMessage(trigger);
    const result = await runAgentLoop(
      {
        id: 'prompt-in-a-box',
        name: 'Prompt in a Box',
        model,
        systemPrompt: prompt,
        tools,
        maxIterations: 8,
        hooks,
        usage: { enabled: true },
      },
      userMessage,
    );

    if (tokens.estimatedCost === 0 && result.usage) {
      tokens = {
        input: result.usage.totalInputTokens,
        output: result.usage.totalOutputTokens,
        estimatedCost:
          result.usage.totalCost ||
          estimateCost(
            cfg.model,
            result.usage.totalInputTokens,
            result.usage.totalOutputTokens,
            DEFAULT_PRICING,
          ) ||
          0,
      };
    }

    const entry: AuditEntry = {
      runId,
      startedAt,
      finishedAt: Date.now(),
      trigger,
      status: 'ok',
      provider: cfg.provider,
      model: cfg.model,
      summary: (result.text || '').slice(0, 200) || '(no output)',
      finalText: result.text,
      steps: result.steps,
      toolCalls,
      tokens,
    };
    await writeAudit(entry);
    log('run complete:', { runId, steps: entry.steps, toolCalls: entry.toolCalls.length, cost: entry.tokens.estimatedCost });
    return entry;
  } catch (err) {
    const entry: AuditEntry = {
      runId,
      startedAt,
      finishedAt: Date.now(),
      trigger,
      status: 'error',
      provider: cfg.provider,
      model: cfg.model,
      summary: err instanceof Error ? err.message : String(err),
      error: err instanceof Error ? err.stack ?? err.message : String(err),
      toolCalls,
      tokens,
    };
    await writeAudit(entry);
    log('run failed:', err);
    return entry;
  }
}

async function composeUserMessage(
  trigger: AuditEntry['trigger'],
): Promise<string> {
  // Bootstrap triggers get an explicit hint so the prompt can perform
  // one-shot setup (context menus, seeded defaults, etc.). The event
  // queue is still drained and appended, so setup + event handling can
  // happen in the same run if events queued between sessions.
  const bootstrapHint =
    trigger === 'install'
      ? 'The extension was just installed. Perform any one-time bootstrap steps (create context menus, seed default state in storage, etc.) — idempotent by design.'
      : trigger === 'update'
        ? 'The extension was just updated. Re-assert any state that new prompt logic requires (context menus, default storage keys, etc.) — skip anything already present.'
        : trigger === 'startup'
          ? 'The browser just started. Re-check any state you rely on (context menus will have survived, but storage is your source of truth); drain queued events below.'
          : null;

  const events = await drainEvents();

  if (!bootstrapHint && events.length === 0) {
    return 'Begin your scheduled run now.';
  }

  const parts: string[] = [];
  if (bootstrapHint) parts.push(bootstrapHint);

  if (events.length > 0) {
    const lines = events
      .slice(0, 50) // safety cap in case a burst accumulated
      .map(
        (e) =>
          `  - ${new Date(e.at).toISOString()} [${e.source}] ${JSON.stringify(e.payload).slice(0, 500)}`,
      )
      .join('\n');
    const truncationNote =
      events.length > 50
        ? `\n  (+${events.length - 50} more events truncated)`
        : '';
    parts.push(
      `Chrome events have fired since your last run. Decide what, if anything, to act on.\n\n${lines}${truncationNote}`,
    );
  } else if (bootstrapHint) {
    parts.push('No queued events.');
  }

  return parts.join('\n\n');
}

async function testProvider(patch: Partial<Config>): Promise<AuditEntry> {
  const base = await getConfig();
  const cfg: Config = {
    ...base,
    ...patch,
    keys: { ...base.keys, ...(patch.keys ?? {}) },
  };
  const apiKey = activeKey(cfg);
  if (!apiKey) {
    const runId = newRunId();
    return {
      runId,
      startedAt: Date.now(),
      finishedAt: Date.now(),
      trigger: 'onboarding-test',
      status: 'skipped',
      provider: cfg.provider,
      model: cfg.model,
      summary: `no ${cfg.provider} key to test`,
      toolCalls: [],
      tokens: { input: 0, output: 0, estimatedCost: 0 },
    };
  }
  const snapshot = await chrome.storage.local.get([
    'provider',
    'model',
    'keys',
    'disabledProviderTools',
  ]);
  await chrome.storage.local.set({
    provider: cfg.provider,
    model: cfg.model,
    keys: cfg.keys,
    disabledProviderTools: cfg.disabledProviderTools,
  });
  try {
    return await run('onboarding-test');
  } finally {
    await chrome.storage.local.set(snapshot);
  }
}

// ─── Provider wiring ───────────────────────────────────────────────

function pickModel(provider: Provider, modelId: string, apiKey: string) {
  switch (provider) {
    case 'anthropic': {
      const p = createAnthropic({
        apiKey,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      });
      return p(modelId) as unknown as Parameters<typeof runAgentLoop>[0]['model'];
    }
    case 'google': {
      const p = createGoogleGenerativeAI({ apiKey });
      return p(modelId) as unknown as Parameters<typeof runAgentLoop>[0]['model'];
    }
    case 'openai': {
      const p = createOpenAI({ apiKey });
      return p(modelId) as unknown as Parameters<typeof runAgentLoop>[0]['model'];
    }
  }
}

async function loadPrompt(): Promise<string> {
  const url = chrome.runtime.getURL('prompt.md');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load prompt.md: ${res.status}`);
  return await res.text();
}

function log(...args: unknown[]): void {
  console.log('[prompt-in-a-box]', ...args);
}
