/**
 * Service worker: schedule, wake, run the prompt, record the outcome.
 *
 * Everything the extension actually *does* is decided by prompt.md.
 * This file's responsibilities are:
 *   1. Keep an alarm alive so the SW is revived on schedule.
 *   2. When revived (or when the popup / options page asks), load
 *      prompt.md, build the ToolSet from manifest permissions, pick
 *      the right provider, and run agent-do's loop.
 *   3. Capture a full audit trail (tool calls, token usage, cost)
 *      and persist it to OPFS + a summary index in chrome.storage.
 *   4. On first install, open the options page so the user can pick
 *      a provider and paste a key.
 */

import { runAgentLoop, DEFAULT_PRICING, estimateCost } from 'agent-do';
import type { AgentHooks } from 'agent-do';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { buildToolSet } from './tools';
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

const ALARM_NAME = 'prompt-in-a-box-tick';

// ─── Lifecycle ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  const cfg = await getConfig();
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: cfg.alarmMinutes,
  });
  log('installed; alarm scheduled every', cfg.alarmMinutes, 'min');

  // First install (not update / chrome_update) → open onboarding.
  if (details.reason === 'install' || !cfg.onboarded) {
    chrome.runtime.openOptionsPage();
  }
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

// ─── Popup / options RPC ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'run-now') {
        sendResponse(await run('manual'));
      } else if (msg?.type === 'test-provider') {
        // Onboarding: run a tiny prompt against the provider to prove
        // the key works. Audited as trigger='onboarding-test'.
        sendResponse(await testProvider(msg.config as Partial<Config>));
      } else if (msg?.type === 'get-audit-index') {
        sendResponse(await getAuditIndex());
      } else if (msg?.type === 'get-audit-entry') {
        sendResponse(await getAuditEntry(msg.runId as string));
      } else if (msg?.type === 'clear-audit') {
        await clearAudit();
        sendResponse({ ok: true });
      } else if (msg?.type === 'reschedule-alarm') {
        const cfg = await getConfig();
        await chrome.alarms.create(ALARM_NAME, {
          delayInMinutes: 1,
          periodInMinutes: cfg.alarmMinutes,
        });
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: `unknown message type: ${msg?.type}` });
      }
    } catch (err) {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // keep channel open for async response
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
  const tools = await buildToolSet();
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
      'Begin your scheduled run now.',
    );

    // If usage tracking didn't fire (e.g. unknown model), fall back to
    // a manual cost estimate from result.usage totals.
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

async function testProvider(patch: Partial<Config>): Promise<AuditEntry> {
  // Merge the patch into the current config temporarily (doesn't
  // persist until the user hits Save). The onboarding "Test" button
  // uses this to verify a key works before committing it.
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

  // Temporarily stash the config so `run()` reads it, then restore.
  const snapshot = await chrome.storage.local.get(['provider', 'model', 'keys']);
  await chrome.storage.local.set({
    provider: cfg.provider,
    model: cfg.model,
    keys: cfg.keys,
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
      // agent-do takes a LanguageModel (Vercel AI SDK). Each provider
      // factory returns the branded type; cast through unknown for
      // portability across provider versions.
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
