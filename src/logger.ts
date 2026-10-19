/**
 * Structured agent-do Console Logger & Real-Time Telemetry Broadcaster
 *
 * Provides real-time console logging and live visual telemetry for everything
 * agent-do is doing during a run — system prompt, user prompt, reasoning/thinking,
 * step start, tool arguments, tool outputs, token usage, and completion.
 *
 * Broadcasts events so open Popup, Side Panel, and Options views mirror the exact
 * same logs in their DevTools console and display a live visual activity drawer.
 */

export type AgentLogChannel =
  | 'run-start'
  | 'system-prompt'
  | 'user-prompt'
  | 'step-start'
  | 'request'
  | 'messages'
  | 'reasoning'
  | 'assistant'
  | 'tool-call'
  | 'tool-result'
  | 'usage'
  | 'run-complete'
  | 'error';

export interface AgentLogEvent {
  id: string;
  runId: string;
  timestamp: number;
  channel: AgentLogChannel;
  step?: number;
  title: string;
  body?: string;
  data?: unknown;
  durationMs?: number;
}

export interface RunLiveStatus {
  active: boolean;
  runId: string;
  trigger?: string;
  step?: number;
  statusText: string;
  updatedAt: number;
}

const LIVE_LOGS_KEY = '__pib_live_logs';
const RUN_STATUS_KEY = '__pib_run_status';
const MAX_LOGS = 120;

const inMemoryLogs: AgentLogEvent[] = [];
let currentLiveStatus: RunLiveStatus = {
  active: false,
  runId: '',
  statusText: 'Idle',
  updatedAt: Date.now(),
};

const printedLogIds = new Set<string>();

const CHANNEL_ICONS: Record<AgentLogChannel, string> = {
  'run-start': '🚀',
  'system-prompt': '📋',
  'user-prompt': '💬',
  'step-start': '🔄',
  'request': '📡',
  'messages': '📨',
  'reasoning': '🧠',
  'assistant': '✍️',
  'tool-call': '🔧',
  'tool-result': '✅',
  'usage': '📊',
  'run-complete': '🏁',
  'error': '❌',
};

const CHANNEL_COLORS: Record<AgentLogChannel, { badgeBg: string; badgeColor: string; titleColor: string }> = {
  'run-start': { badgeBg: '#4f46e5', badgeColor: '#ffffff', titleColor: '#6366f1' },
  'system-prompt': { badgeBg: '#0891b2', badgeColor: '#ffffff', titleColor: '#06b6d4' },
  'user-prompt': { badgeBg: '#2563eb', badgeColor: '#ffffff', titleColor: '#3b82f6' },
  'step-start': { badgeBg: '#059669', badgeColor: '#ffffff', titleColor: '#10b981' },
  'request': { badgeBg: '#0d9488', badgeColor: '#ffffff', titleColor: '#14b8a6' },
  'messages': { badgeBg: '#475569', badgeColor: '#ffffff', titleColor: '#94a3b8' },
  'reasoning': { badgeBg: '#9333ea', badgeColor: '#ffffff', titleColor: '#a855f7' },
  'assistant': { badgeBg: '#2563eb', badgeColor: '#ffffff', titleColor: '#60a5fa' },
  'tool-call': { badgeBg: '#d97706', badgeColor: '#000000', titleColor: '#f59e0b' },
  'tool-result': { badgeBg: '#16a34a', badgeColor: '#ffffff', titleColor: '#22c55e' },
  'usage': { badgeBg: '#64748b', badgeColor: '#ffffff', titleColor: '#94a3b8' },
  'run-complete': { badgeBg: '#10b981', badgeColor: '#000000', titleColor: '#34d399' },
  'error': { badgeBg: '#dc2626', badgeColor: '#ffffff', titleColor: '#ef4444' },
};

/**
 * Format and print a structured log entry into the active DevTools console.
 * Deduplicates so multiple listeners in the same window only print once.
 */
export function printAgentLogToConsole(event: AgentLogEvent, sourcePrefix = '[agent-do]'): void {
  if (printedLogIds.has(event.id)) return;
  printedLogIds.add(event.id);
  if (printedLogIds.size > 2000) {
    const arr = Array.from(printedLogIds);
    printedLogIds.clear();
    for (const id of arr.slice(1000)) printedLogIds.add(id);
  }

  const icon = CHANNEL_ICONS[event.channel] || 'ℹ️';
  const colors = CHANNEL_COLORS[event.channel] || { badgeBg: '#475569', badgeColor: '#fff', titleColor: '#94a3b8' };
  const stepLabel = event.step !== undefined ? ` [step ${event.step + 1}]` : '';

  const badgeStyle = `background: ${colors.badgeBg}; color: ${colors.badgeColor}; font-weight: bold; border-radius: 3px; padding: 1px 5px; font-size: 11px;`;
  const titleStyle = `color: ${colors.titleColor}; font-weight: 600; font-size: 12px;`;
  const timeStyle = 'color: #94a3b8; font-size: 10px; font-weight: normal;';

  const timeStr = new Date(event.timestamp).toLocaleTimeString();
  const header = `%c${icon} ${sourcePrefix}:${event.channel}${stepLabel}%c ${event.title} %c(${timeStr})`;

  const hasExpandableContent = Boolean(event.body || event.data !== undefined);

  if (hasExpandableContent) {
    console.groupCollapsed(header, badgeStyle, titleStyle, timeStyle);
    if (event.body) {
      console.log(event.body);
    }
    if (event.data !== undefined) {
      console.log('Payload / Data:', event.data);
    }
    console.groupEnd();
  } else {
    console.log(header, badgeStyle, titleStyle, timeStyle);
  }
}

/**
 * Emits a structured log event from background: logs to service worker console,
 * saves to ring buffer, and broadcasts via chrome.runtime.sendMessage.
 */
export async function emitAgentLog(
  rawEvent: Omit<AgentLogEvent, 'id' | 'timestamp'>,
  statusText?: string,
): Promise<AgentLogEvent> {
  const event: AgentLogEvent = {
    ...rawEvent,
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
  };

  // 1. Print directly to this service worker's DevTools console
  printAgentLogToConsole(event);

  // 2. Append to in-memory log buffer
  inMemoryLogs.push(event);
  if (inMemoryLogs.length > MAX_LOGS) {
    inMemoryLogs.shift();
  }

  // 3. Update live status
  if (statusText || event.channel === 'run-start' || event.channel === 'run-complete' || event.channel === 'error') {
    const isActive = event.channel !== 'run-complete' && event.channel !== 'error';
    currentLiveStatus = {
      active: isActive,
      runId: event.runId,
      step: event.step,
      statusText: statusText || (isActive ? event.title : 'Idle'),
      updatedAt: Date.now(),
    };
  }

  // 4. Persist to storage for newly opened views
  try {
    await chrome.storage.local.set({
      [LIVE_LOGS_KEY]: inMemoryLogs.slice(-60),
      [RUN_STATUS_KEY]: currentLiveStatus,
    });
  } catch {
    // Ignore storage issues
  }

  // 5. Broadcast in real time to all open windows (popup, sidepanel, options)
  try {
    chrome.runtime
      .sendMessage({
        type: 'agent-log',
        event,
        status: currentLiveStatus,
      })
      .catch(() => {});
  } catch {
    // Ignore if no listeners open
  }

  return event;
}

/**
 * Retrieve recent live logs and current run status.
 */
export async function getLiveLogs(): Promise<{ logs: AgentLogEvent[]; status: RunLiveStatus }> {
  try {
    const data = await chrome.storage.local.get([LIVE_LOGS_KEY, RUN_STATUS_KEY]);
    const logs = (data[LIVE_LOGS_KEY] || inMemoryLogs) as AgentLogEvent[];
    const status = (data[RUN_STATUS_KEY] || currentLiveStatus) as RunLiveStatus;
    return { logs, status };
  } catch {
    return { logs: inMemoryLogs, status: currentLiveStatus };
  }
}

/**
 * Clear the live log history.
 */
export async function clearLiveLogs(): Promise<void> {
  inMemoryLogs.length = 0;
  currentLiveStatus = {
    active: false,
    runId: '',
    statusText: 'Idle',
    updatedAt: Date.now(),
  };
  try {
    await chrome.storage.local.set({
      [LIVE_LOGS_KEY]: [],
      [RUN_STATUS_KEY]: currentLiveStatus,
    });
  } catch {
    // Ignore
  }
}

/**
 * Creates a stream logger that hooks into agent-do's debug surface to capture
 * streaming reasoning deltas, text deltas, system prompt, and message payloads.
 */
export function createRunStreamLogger(runId: string) {
  let currentStep = 0;
  let reasoningBuffer = '';
  let textBuffer = '';
  let lastStreamBroadcast = 0;

  function broadcastStreamDelta(kind: 'reasoning' | 'text', delta: string, fullText: string) {
    try {
      chrome.runtime
        .sendMessage({
          type: 'agent-stream-delta',
          runId,
          step: currentStep,
          kind,
          delta,
          fullText,
        })
        .catch(() => {});
    } catch {
      // Ignore
    }
  }

  function flushReasoning() {
    if (reasoningBuffer.trim()) {
      const text = reasoningBuffer.trim();
      reasoningBuffer = '';
      void emitAgentLog(
        {
          runId,
          channel: 'reasoning',
          step: currentStep,
          title: `Reasoning (${text.length} chars)`,
          body: text,
        },
        'Reasoning complete',
      );
    }
  }

  function flushText() {
    if (textBuffer.trim()) {
      const text = textBuffer.trim();
      textBuffer = '';
      void emitAgentLog(
        {
          runId,
          channel: 'assistant',
          step: currentStep,
          title: `Assistant response (${text.length} chars)`,
          body: text,
        },
        'Assistant answered',
      );
    }
  }

  return {
    onDebugEvent: (event: any) => {
      if (!event || typeof event !== 'object') return;
      if (typeof event.step === 'number') currentStep = event.step;

      switch (event.channel) {
        case 'system-prompt': {
          void emitAgentLog({
            runId,
            channel: 'system-prompt',
            step: 0,
            title: `Resolved system prompt (${event.bytes ?? event.content?.length ?? 0} bytes)`,
            body: event.content,
          });
          break;
        }

        case 'request': {
          const names = Array.isArray(event.toolNames) ? event.toolNames.join(', ') : 'none';
          void emitAgentLog(
            {
              runId,
              channel: 'request',
              step: event.step,
              title: `Model request: ${event.model || 'LLM'} with ${event.toolCount ?? 0} tools`,
              body: `Available tools:\n${names}`,
              data: {
                model: event.model,
                toolCount: event.toolCount,
                toolNames: event.toolNames,
                providerOptions: event.providerOptions,
              },
            },
            `Invoking ${event.model}...`,
          );
          break;
        }

        case 'messages': {
          void emitAgentLog({
            runId,
            channel: 'messages',
            step: event.step,
            title: `Prompt conversation messages (${(event.messages || []).length} items)`,
            data: event.messages,
          });
          break;
        }

        case 'cache': {
          void emitAgentLog({
            runId,
            channel: 'usage',
            step: event.step,
            title: `Step ${event.step + 1} tokens: ${event.noCacheTokens ?? 0} uncached, ${event.cacheReadTokens ?? 0} cache-read, ${event.outputTokens ?? 0} output`,
            data: event,
          });
          break;
        }

        case 'response-part': {
          const part = event.part || {};
          const partType = event.partType || part.type;

          if (partType === 'reasoning' || partType === 'reasoning-delta') {
            const delta = part.textDelta || part.text || part.delta || '';
            if (delta) {
              reasoningBuffer += delta;
              const now = Date.now();
              if (now - lastStreamBroadcast > 250) {
                lastStreamBroadcast = now;
                broadcastStreamDelta('reasoning', delta, reasoningBuffer);
              }
            }
          } else if (partType === 'text-delta') {
            const delta = part.textDelta || part.text || part.delta || '';
            if (delta) {
              textBuffer += delta;
              const now = Date.now();
              if (now - lastStreamBroadcast > 250) {
                lastStreamBroadcast = now;
                broadcastStreamDelta('text', delta, textBuffer);
              }
            }
          } else if (partType === 'tool-call') {
            flushReasoning();
            flushText();
          } else if (partType === 'finish' || partType === 'step-finish') {
            flushReasoning();
            flushText();
          }
          break;
        }
      }
    },
    flush: () => {
      flushReasoning();
      flushText();
    },
    setStep: (step: number) => {
      if (step !== currentStep) {
        flushReasoning();
        flushText();
        currentStep = step;
      }
    },
  };
}
