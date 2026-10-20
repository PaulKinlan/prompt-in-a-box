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

/** Extended pricing table incorporating latest verified model rates. */
const RUNTIME_PRICING: Record<string, { input: number; output: number }> = {
  ...DEFAULT_PRICING,
  'claude-fable-5-1': { input: 10.0, output: 50.0 },
  'claude-opus-5-5': { input: 4.0, output: 20.0 },
  'claude-sonnet-5-5': { input: 2.0, output: 10.0 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'gemini-4-argon': { input: 2.0, output: 10.0 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash': { input: 0.5, output: 2.5 },
  'gemini-3.5-flash-lite': { input: 0.1, output: 0.5 },
  'gemini-3.1-pro-preview': { input: 2.0, output: 10.0 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gpt-6-astra': { input: 10.0, output: 50.0 },
  'gpt-6.1-sol': { input: 2.0, output: 10.0 },
  'gpt-6-sol': { input: 2.0, output: 10.0 },
  'gpt-6-luna': { input: 0.1, output: 0.5 },
  'gpt-5.6-sol': { input: 4.0, output: 20.0 },
  'gpt-5.6': { input: 4.0, output: 20.0 },
  'gpt-5.5': { input: 5.0, output: 30.0 },
  'gpt-5.5-pro': { input: 30.0, output: 180.0 },
  'gpt-5.4-pro': { input: 30.0, output: 180.0 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, output: 1.25 },
};
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
import {
  setCurrentRunId,
  undoActionById,
  undoLastRun,
  listActionHistory,
} from './action-history';
import {
  emitAgentLog,
  createRunStreamLogger,
  getLiveLogs,
  clearLiveLogs,
} from './logger';
import {
  setActiveRunToolContext,
  clearActiveRunToolContext,
  handleCodeModeToolCall,
  handleCodeModeLog,
  buildRuntimeCodeModePrompt,
} from './code-mode';

const ALARM_NAME = 'prompt-in-a-box-tick';

async function ensureScheduled(alarmMinutes?: number): Promise<void> {
  const cfg = await getConfig();
  const minutes = alarmMinutes !== undefined ? alarmMinutes : cfg.alarmMinutes;
  if (!chrome.alarms) return;
  if (minutes <= 0) {
    await chrome.alarms.clear(ALARM_NAME);
    log('alarm disabled (never)');
    return;
  }
  await chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: minutes,
  });
  log('alarm scheduled every', minutes, 'min');
}

// ─── Lifecycle ─────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  const cfg = await getConfig();
  await ensureScheduled(cfg.alarmMinutes);

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
  await ensureScheduled(cfg.alarmMinutes);
  // Startup run so the prompt can check state, drain any events that
  // queued between sessions, and re-assert context menus / commands.
  await run('startup').catch((err) => console.warn('[prompt-in-a-box] startup run failed:', err));
});

chrome.alarms?.onAlarm?.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await run('alarm');
  } else {
    await run(
      'alarm',
      `Named Chrome alarm '${alarm.name}' fired at ${new Date().toISOString()}. Execute any scheduled tasks associated with this alarm.`,
    );
  }
});

chrome.notifications?.onClicked?.addListener((notificationId) => {
  console.log('[prompt-in-a-box] Notification clicked:', notificationId);
  if (notificationId.startsWith('artifact-')) {
    const artifactId = notificationId.replace('artifact-', '');
    chrome.tabs.create({
      url: chrome.runtime.getURL(`dist/artifacts.html?id=${artifactId}`)
    });
  }
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
      } else if (msg?.type === 'ui-opened') {
        const userMsg = `The user has opened the dynamic UI view: '${msg.view}'. Inspect the current state of the browser, bookmarks, tabs, or whatever is relevant, and define the layout, styling, and action triggers by calling the ui_update tool.`;
        sendResponse(await run('manual', userMsg));
      } else if (msg?.type === 'ui-interaction') {
        const userMsg = `The user interacted with the dynamic UI element.\n- Component ID: '${msg.componentId}'\n- Action: '${msg.action}'\n- Payload: ${JSON.stringify(msg.payload ?? {})}\nExecute the requested tasks (calling any necessary Chrome API tools) and then update the UI view by calling the ui_update tool with the new state.`;
        sendResponse(await run('manual', userMsg));
      } else if (msg?.type === 'reschedule-alarm') {
        const cfg = await getConfig();
        await ensureScheduled(cfg.alarmMinutes);
        // Permissions may have changed since last boot; re-scan.
        startEvents(triggerRun).catch(() => {});
        sendResponse({ ok: true });
      } else if (msg?.type === 'get-action-history') {
        const history = await listActionHistory(msg.limit || 30);
        sendResponse({ ok: true, history });
      } else if (msg?.type === 'undo-action') {
        sendResponse(await undoActionById(msg.actionId));
      } else if (msg?.type === 'action-toast-undo') {
        const snapRes = await restoreSortSnapshot();
        const journalRes = await undoLastRun();
        sendResponse({ ok: snapRes.ok || journalRes.ok, snapRes, journalRes });
      } else if (msg?.type === 'action-toast-dismiss') {
        await chrome.storage.local.remove(['activeUndoToast', 'lastSortSnapshot']);
        try {
          await chrome.action.setBadgeText({ text: '' });
          await chrome.action.setTitle({ title: chrome.runtime.getManifest().name });
        } catch {
          // ignore
        }
        sendResponse({ ok: true });
      } else if (msg?.type === 'get-live-logs') {
        sendResponse(await getLiveLogs());
      } else if (msg?.type === 'clear-live-logs') {
        await clearLiveLogs();
        sendResponse({ ok: true });
      } else if (msg?.type === 'code-mode-tool-call') {
        sendResponse(await handleCodeModeToolCall(msg));
      } else if (msg?.type === 'code-mode-log') {
        sendResponse(await handleCodeModeLog(msg));
      } else if (msg?.type === 'studio-test-run') {
        const trigger = (msg.trigger as AuditEntry['trigger']) || 'manual';
        const userMsg = msg.customUserMessage as string | undefined;
        sendResponse(await run(trigger, userMsg));
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

async function run(
  trigger: AuditEntry['trigger'],
  customUserMessage?: string,
): Promise<AuditEntry> {
  const runId = newRunId();
  setCurrentRunId(runId);
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
    void emitAgentLog(
      {
        runId,
        channel: 'error',
        title: `Run skipped: No ${cfg.provider} API key configured`,
        body: 'Please open extension settings to configure an API key.',
      },
      'Missing API key',
    );
    return entry;
  }

  const basePrompt = await loadPrompt();
  const customTools = await buildToolSet();
  const providerTools = filterProviderTools(
    getProviderTools(cfg.provider, apiKey),
    cfg.disabledProviderTools,
  );
  // Merge: custom tools win on name conflict (never expected, but let's
  // be deterministic if anthropic ever ships a tool named the same as
  // one of ours).
  const tools = { ...providerTools, ...customTools };
  const codeModePrompt = await buildRuntimeCodeModePrompt(tools);
  const prompt = codeModePrompt ? `${basePrompt}\n\n${codeModePrompt}` : basePrompt;
  const toolCalls: AuditToolCall[] = [];
  const pendingByName = new Map<string, { at: number; args: unknown }>();
  let tokens = { input: 0, output: 0, estimatedCost: 0 };

  setActiveRunToolContext({
    runId,
    tools,
    recordToolCall: (call) => toolCalls.push(call),
  });

  const streamLogger = createRunStreamLogger(runId);

  const hooks: AgentHooks = {
    onStepStart: async (event) => {
      streamLogger.setStep(event.step);
      void emitAgentLog(
        {
          runId,
          channel: 'step-start',
          step: event.step,
          title: `Starting step ${event.step + 1} (tokens: ${event.tokensSoFar})`,
          data: event,
        },
        `Step ${event.step + 1} running...`,
      );
    },
    onPreToolUse: async (event) => {
      streamLogger.flush();
      pendingByName.set(`${event.step}:${event.toolName}`, {
        at: Date.now(),
        args: event.args,
      });
      void emitAgentLog(
        {
          runId,
          channel: 'tool-call',
          step: event.step,
          title: `Calling tool: ${event.toolName}`,
          data: event.args,
        },
        `Executing ${event.toolName}...`,
      );
      return { decision: 'allow' };
    },
    onPostToolUse: async (event) => {
      streamLogger.flush();
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
      void emitAgentLog(
        {
          runId,
          channel: 'tool-result',
          step: event.step,
          title: `Tool completed: ${event.toolName} (${event.durationMs}ms)`,
          data: event.result,
          durationMs: event.durationMs,
        },
        `Completed ${event.toolName}`,
      );
    },
    onUsage: async (record) => {
      tokens.input += record.inputTokens;
      tokens.output += record.outputTokens;
      tokens.estimatedCost += record.estimatedCost;
      void emitAgentLog({
        runId,
        channel: 'usage',
        title: `Usage: +${record.inputTokens} in / +${record.outputTokens} out ($${record.estimatedCost.toFixed(4)})`,
        data: record,
      });
    },
    onComplete: async (event) => {
      streamLogger.flush();
      const totalTokens = (event.usage?.totalInputTokens ?? 0) + (event.usage?.totalOutputTokens ?? 0);
      void emitAgentLog(
        {
          runId,
          channel: 'run-complete',
          title: `Run complete in ${event.totalSteps} steps (${totalTokens} tokens)`,
          body: event.result,
          data: event.usage,
        },
        'Complete',
      );
    },
  };

  try {
    void emitAgentLog(
      {
        runId,
        channel: 'run-start',
        title: `Agent run started (${trigger})`,
        body: `Model: ${cfg.model} (${cfg.provider})`,
        data: { trigger, provider: cfg.provider, model: cfg.model },
      },
      'Starting agent run...',
    );

    const model = pickModel(cfg.provider, cfg.model, apiKey);
    const userMessage = await composeUserMessage(trigger, customUserMessage);
    void emitAgentLog({
      runId,
      channel: 'user-prompt',
      title: `User prompt (${userMessage.length} chars)`,
      body: userMessage,
    });

    const manifest = chrome.runtime.getManifest();
    const result = await runAgentLoop(
      {
        id: manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: manifest.name,
        model,
        systemPrompt: prompt,
        tools,
        maxIterations: 12,
        hooks,
        usage: { enabled: true, pricing: RUNTIME_PRICING },
        debug: {
          all: true,
          traceResponseParts: true,
          maxBodyBytes: 64 * 1024,
          sink: streamLogger.onDebugEvent,
        },
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
            RUNTIME_PRICING,
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
    streamLogger.flush();
    const errorMsg = err instanceof Error ? err.message : String(err);
    void emitAgentLog(
      {
        runId,
        channel: 'error',
        title: `Run error: ${errorMsg}`,
        body: err instanceof Error ? err.stack : undefined,
      },
      'Failed',
    );
    const entry: AuditEntry = {
      runId,
      startedAt,
      finishedAt: Date.now(),
      trigger,
      status: 'error',
      provider: cfg.provider,
      model: cfg.model,
      summary: errorMsg,
      error: err instanceof Error ? err.stack ?? err.message : String(err),
      toolCalls,
      tokens,
    };
    await writeAudit(entry);
    log('run failed:', err);
    return entry;
  } finally {
    clearActiveRunToolContext();
  }
}

async function restoreSortSnapshot(): Promise<{ ok: boolean; restoredTabs: number; error?: string }> {
  try {
    const stored = await chrome.storage.local.get(['activeUndoToast', 'lastSortSnapshot']);
    type TabGroupColor = chrome.tabGroups.Color;
    interface StoredSnapshot {
      tabs?: Array<{ id: number; groupId: number; index: number; windowId: number }>;
      groups?: Array<{ id: number; title?: string; color?: TabGroupColor; collapsed?: boolean }>;
    }
    const toast = stored.activeUndoToast as { snapshot?: StoredSnapshot } | undefined;
    const snapshot = (toast?.snapshot || stored.lastSortSnapshot) as StoredSnapshot | undefined;

    if (!snapshot || !Array.isArray(snapshot.tabs)) {
      return { ok: false, restoredTabs: 0, error: 'No sort snapshot found to restore' };
    }

    const tabs = snapshot.tabs;
    const ungroupTabIds: number[] = [];
    const groupMap = new Map<number, { tabIds: number[]; windowId?: number }>();

    for (const t of tabs) {
      if (t.groupId === -1 || t.groupId === undefined) {
        ungroupTabIds.push(t.id);
      } else {
        const entry = groupMap.get(t.groupId) || { tabIds: [], windowId: t.windowId };
        entry.tabIds.push(t.id);
        groupMap.set(t.groupId, entry);
      }
    }

    if (ungroupTabIds.length > 0) {
      try {
        await chrome.tabs.ungroup(ungroupTabIds as [number, ...number[]]);
      } catch {
        // some tabs might have closed
      }
    }

    const groupMeta = snapshot.groups || [];
    const metaById = new Map<number, { title?: string; color?: TabGroupColor; collapsed?: boolean }>();
    for (const g of groupMeta) {
      metaById.set(g.id, g);
    }

    for (const [oldGroupId, groupInfo] of groupMap.entries()) {
      if (groupInfo.tabIds.length === 0) continue;
      try {
        const createProps = groupInfo.windowId !== undefined ? { windowId: groupInfo.windowId } : undefined;
        const newGroupId = await chrome.tabs.group({
          tabIds: groupInfo.tabIds as [number, ...number[]],
          createProperties: createProps,
        } as any);
        const meta = metaById.get(oldGroupId);
        if (meta) {
          await chrome.tabGroups.update(newGroupId, {
            title: meta.title,
            color: meta.color,
            collapsed: meta.collapsed,
          });
        }
      } catch {
        // ignore
      }
    }

    // Restore exact tab index positions per window
    const sortedTabs = [...tabs].sort((a, b) => a.index - b.index);
    for (const t of sortedTabs) {
      try {
        await chrome.tabs.move(t.id, { index: t.index });
      } catch {
        // ignore
      }
    }

    // Clear active toast & snapshot & reset badge
    await chrome.storage.local.remove(['activeUndoToast', 'lastSortSnapshot']);
    try {
      await chrome.action.setBadgeText({ text: '' });
      await chrome.action.setTitle({ title: chrome.runtime.getManifest().name });
    } catch {
      // ignore
    }

    // Reset lastSort timestamp in storage
    try {
      const storedState = await chrome.storage.local.get('state:sorting_hat_state');
      const val = storedState['state:sorting_hat_state'];
      if (val && typeof val === 'object') {
        delete (val as any).lastSort;
        delete (val as any).lastSortTimestamp;
        await chrome.storage.local.set({ 'state:sorting_hat_state': val });
      }
    } catch {
      // ignore
    }

    // Broadcast instant update to open views
    try {
      chrome.runtime.sendMessage({ type: 'action-history-updated' }).catch(() => {});
    } catch {
      // ignore
    }

    return { ok: true, restoredTabs: tabs.length };
  } catch (err) {
    return { ok: false, restoredTabs: 0, error: (err as Error).message };
  }
}

async function composeUserMessage(
  trigger: AuditEntry['trigger'],
  customUserMessage?: string,
): Promise<string> {
  const cfg = await getConfig();

  const bootstrapHint =
    trigger === 'install'
      ? 'The extension was just installed. Perform any one-time bootstrap steps (create context menus, seed default state in storage, etc.) — idempotent by design.'
      : trigger === 'update'
        ? 'The extension was just updated. Re-assert any state that new prompt logic requires (context menus, default storage keys, etc.) — skip anything already present.'
        : trigger === 'startup'
          ? 'The browser just started. Re-check any state you rely on (context menus will have survived, but storage is your source of truth); drain queued events below.'
          : null;

  const events = await drainEvents();

  const parts: string[] = [];
  if (customUserMessage) {
    parts.push(customUserMessage);
  } else if (bootstrapHint) {
    parts.push(bootstrapHint);
  }

  // Inject user-configured agent settings if declared
  if (cfg.agentSettings?.fields && cfg.agentSettings.fields.length > 0) {
    const stored = await chrome.storage.local.get('agentSettingsValues');
    const userValues = (stored.agentSettingsValues as Record<string, unknown>) || {};
    const effective: Record<string, unknown> = {};
    for (const field of cfg.agentSettings.fields) {
      effective[field.id] = userValues[field.id] !== undefined ? userValues[field.id] : field.default;
    }
    parts.push(`Current user-configured agent settings:\n\`\`\`json\n${JSON.stringify(effective, null, 2)}\n\`\`\``);
  }

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

  if (parts.length === 0) {
    return 'Begin your scheduled run now.';
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
  try {
    const stored = await chrome.storage.local.get('studioLiveOverride');
    const override = stored.studioLiveOverride as { enabled?: boolean; prompt?: string } | undefined;
    if (override?.enabled && typeof override.prompt === 'string' && override.prompt.trim().length > 0) {
      return override.prompt;
    }
  } catch {
    // fallback to bundled prompt.md
  }
  const url = chrome.runtime.getURL('prompt.md');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load prompt.md: ${res.status}`);
  return await res.text();
}

function log(...args: unknown[]): void {
  console.log(`[${chrome.runtime.getManifest().name}]`, ...args);
}
