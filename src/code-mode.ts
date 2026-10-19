/**
 * Sandboxed Code Execution Gateway (code_mode)
 *
 * Enables the agent to execute async JavaScript scripts that batch and chain
 * extension tools inside an isolated MV3 sandbox (dist/sandbox.html).
 *
 * Security & Isolation:
 * - The script runs in an opaque origin sandbox (connect-src 'none', no chrome.* access).
 * - The script can ONLY interact with the extension by calling granted tools through
 *   controlled postMessage RPCs.
 * - Enforces execution timeouts and per-session maxToolCalls limits.
 * - Logs each inner tool call in real time and records it in the run audit trail.
 * - Supports saving reusable routines in storage for zero-burn repeated execution.
 */

import { sendToOffscreen } from './offscreen-client';
import { emitAgentLog } from './logger';
import type { ToolSet } from 'ai';
import type { AuditToolCall } from './audit';

export interface CodeSession {
  execId: string;
  nonce: string;
  runId: string;
  maxToolCalls: number;
  toolCallsCount: number;
  tools: ToolSet;
  recordToolCall?: (call: AuditToolCall) => void;
  readCache?: Map<number, Promise<unknown>>;
}

const activeSessions = new Map<string, CodeSession>();

let activeRunContext: {
  runId: string;
  tools: ToolSet;
  recordToolCall?: (call: AuditToolCall) => void;
} | null = null;

export function setActiveRunToolContext(ctx: {
  runId: string;
  tools: ToolSet;
  recordToolCall?: (call: AuditToolCall) => void;
}): void {
  activeRunContext = ctx;
}

export function clearActiveRunToolContext(): void {
  activeRunContext = null;
}

// ─── Tool Name Aliasing & Resolution ───────────────────────────────────

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  readpage: 'tab_read',
  read_page: 'tab_read',
  tabread: 'tab_read',
  tab_read: 'tab_read',
  capturepage: 'capture_page',
  capture_page: 'capture_page',
  tablist: 'tab_list',
  tab_list: 'tab_list',
  tabgroup: 'tab_group',
  tab_group: 'tab_group',
  tabgrouplist: 'tab_group_list',
  tab_group_list: 'tab_group_list',
  tabungroup: 'tab_ungroup',
  tab_ungroup: 'tab_ungroup',
  tabclose: 'tab_close',
  tab_close: 'tab_close',
  tabopen: 'tab_open',
  tab_open: 'tab_open',
  tabfocus: 'tab_focus',
  tab_focus: 'tab_focus',
  tabmove: 'tab_move',
  tab_move: 'tab_move',
  tabmute: 'tab_mute',
  tab_mute: 'tab_mute',
  tabpin: 'tab_pin',
  tab_pin: 'tab_pin',
  actiontoast: 'action_toast',
  action_toast: 'action_toast',
  actionhistory: 'action_history',
  action_history: 'action_history',
  actionundo: 'action_undo',
  action_undo: 'action_undo',
  undoaction: 'action_undo',
  storageget: 'storage_get',
  storage_get: 'storage_get',
  getstate: 'storage_get',
  get_state: 'storage_get',
  storageset: 'storage_set',
  storage_set: 'storage_set',
  setstate: 'storage_set',
  set_state: 'storage_set',
  opfsread: 'opfs_read',
  opfs_read: 'opfs_read',
  opfswrite: 'opfs_write',
  opfs_write: 'opfs_write',
  opfslist: 'opfs_list',
  opfs_list: 'opfs_list',
  uiupdate: 'ui_update',
  ui_update: 'ui_update',
  idleyquery: 'idle_query',
  idle_query: 'idle_query',
  findelements: 'find_elements',
  find_elements: 'find_elements',
  clickelement: 'click_element',
  click_element: 'click_element',
  typetext: 'type_text',
  type_text: 'type_text',
};

export function resolveToolName(rawName: string, availableTools: ToolSet): string | null {
  if (availableTools[rawName]) return rawName;

  const snake = camelToSnake(rawName);
  if (availableTools[snake]) return snake;

  const normalized = rawName.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (TOOL_NAME_ALIASES[normalized] && availableTools[TOOL_NAME_ALIASES[normalized]]) {
    return TOOL_NAME_ALIASES[normalized];
  }

  const snakeNorm = snake.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (TOOL_NAME_ALIASES[snakeNorm] && availableTools[TOOL_NAME_ALIASES[snakeNorm]]) {
    return TOOL_NAME_ALIASES[snakeNorm];
  }

  return null;
}

// ─── Session RPC Handlers ──────────────────────────────────────────────

export async function handleCodeModeToolCall(msg: any): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
}> {
  const session = activeSessions.get(msg?.execId);
  if (!session || session.nonce !== msg?.nonce) {
    return { ok: false, error: 'Unauthorized or expired code_mode session' };
  }

  if (session.toolCallsCount >= session.maxToolCalls) {
    return {
      ok: false,
      error: `code_mode: tool call limit (${session.maxToolCalls}) exceeded — batching stopped to prevent unbounded execution`,
    };
  }

  const rawToolName = String(msg?.toolName ?? '');
  if (rawToolName === 'code_mode' || rawToolName === 'run_code') {
    return { ok: false, error: 'Recursive code_mode calls are disallowed' };
  }

  const resolvedName = resolveToolName(rawToolName, session.tools);
  if (!resolvedName) {
    const valid = Object.keys(session.tools)
      .filter((k) => k !== 'code_mode' && k !== 'run_code')
      .join(', ');
    return {
      ok: false,
      error: `Unknown or unavailable tool '${rawToolName}'. Available tools: ${valid}`,
    };
  }

  const toolObj = session.tools[resolvedName];
  if (!toolObj || typeof toolObj.execute !== 'function') {
    return { ok: false, error: `Tool '${resolvedName}' cannot be executed` };
  }

  const args = msg?.args ?? {};

  // Normalize parameters and guard tab_read
  if (resolvedName === 'tab_read') {
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      if (args.id !== undefined && args.tabId === undefined) {
        args.tabId = args.id;
      }
      if (args.tabId !== undefined && args.id === undefined) {
        args.id = args.tabId;
      }
      if (args.maxLength !== undefined && args.maxChars === undefined) {
        args.maxChars = args.maxLength;
      }
      // If tabId was explicitly passed as undefined or null, fail fast with a clear error
      // instead of silently falling back to the active tab!
      if (
        ('tabId' in args && (args.tabId === undefined || args.tabId === null)) ||
        ('id' in args && (args.id === undefined || args.id === null))
      ) {
        if (args.tabId === undefined || args.tabId === null) {
          return {
            ok: false,
            error:
              'tab_read: tabId is undefined or null. Provide a valid tab ID (e.g. from tab_list) or omit tabId completely to read the active tab.',
          };
        }
      }
    }

    // Deduplicate / cache tab_read calls within the same code_mode session
    const targetTabId = typeof args?.tabId === 'number' && Number.isFinite(args.tabId) ? args.tabId : undefined;
    if (targetTabId !== undefined) {
      if (!session.readCache) {
        session.readCache = new Map();
      }
      const existing = session.readCache.get(targetTabId);
      if (existing) {
        try {
          const cachedResult = await existing;
          void emitAgentLog(
            {
              runId: session.runId,
              channel: 'tool-result',
              title: `[code_mode] Using cached tab_read for tabId ${targetTabId}`,
              data: { tabId: targetTabId, cached: true },
            },
            `[code_mode] Cached tab_read (${targetTabId})`,
          );
          return { ok: true, result: cachedResult };
        } catch (err: any) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    }
  }

  session.toolCallsCount++;
  const callStarted = Date.now();

  void emitAgentLog(
    {
      runId: session.runId,
      channel: 'tool-call',
      title: `[code_mode] Calling tool: ${resolvedName} (#${session.toolCallsCount})`,
      data: args,
    },
    `[code_mode] ${resolvedName}...`,
  );

  const execPromise = (async () => {
    return (toolObj.execute as any)(args, {
      toolCallId: msg?.callId || `code_call_${Date.now()}`,
      messages: [],
    });
  })();

  if (resolvedName === 'tab_read' && typeof (args as any)?.tabId === 'number') {
    if (!session.readCache) session.readCache = new Map();
    session.readCache.set((args as any).tabId, execPromise);
  }

  try {
    const result = await execPromise;
    const durationMs = Date.now() - callStarted;

    void emitAgentLog(
      {
        runId: session.runId,
        channel: 'tool-result',
        title: `[code_mode] Tool completed: ${resolvedName} (${durationMs}ms)`,
        data: result,
        durationMs,
      },
      `[code_mode] Finished ${resolvedName}`,
    );

    if (session.recordToolCall) {
      session.recordToolCall({
        at: callStarted,
        name: `code_mode:${resolvedName}`,
        args,
        durationMs,
        result,
      });
    }

    return { ok: true, result };
  } catch (err: any) {
    const durationMs = Date.now() - callStarted;
    const errMsg = err instanceof Error ? err.message : String(err);

    void emitAgentLog({
      runId: session.runId,
      channel: 'error',
      title: `[code_mode] Tool failed: ${resolvedName} (${errMsg})`,
      durationMs,
    });

    return { ok: false, error: errMsg };
  }
}

export async function handleCodeModeLog(msg: any): Promise<{ ok: boolean }> {
  const session = activeSessions.get(msg?.execId);
  if (!session || session.nonce !== msg?.nonce) {
    return { ok: false };
  }

  void emitAgentLog({
    runId: session.runId,
    channel: 'assistant',
    title: `[code_mode log] ${msg?.text}`,
    body: String(msg?.text ?? ''),
  });

  return { ok: true };
}

// ─── Saved Scripts Storage ─────────────────────────────────────────────

const SAVED_SCRIPTS_KEY = '__pib_saved_scripts';

export interface SavedScriptEntry {
  name: string;
  description?: string;
  code: string;
  updatedAt: number;
}

export async function saveScript(
  name: string,
  code: string,
  description?: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!cleanName) return { ok: false, error: 'Invalid script name' };

  try {
    const stored = await chrome.storage.local.get(SAVED_SCRIPTS_KEY);
    const scripts = (stored[SAVED_SCRIPTS_KEY] || {}) as Record<string, SavedScriptEntry>;
    scripts[cleanName] = {
      name: cleanName,
      description: description?.trim(),
      code,
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [SAVED_SCRIPTS_KEY]: scripts });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function loadScript(name: string): Promise<SavedScriptEntry | null> {
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  try {
    const stored = await chrome.storage.local.get(SAVED_SCRIPTS_KEY);
    const scripts = (stored[SAVED_SCRIPTS_KEY] || {}) as Record<string, SavedScriptEntry>;
    return scripts[cleanName] || null;
  } catch {
    return null;
  }
}

export async function listSavedScripts(): Promise<SavedScriptEntry[]> {
  try {
    const stored = await chrome.storage.local.get(SAVED_SCRIPTS_KEY);
    const scripts = (stored[SAVED_SCRIPTS_KEY] || {}) as Record<string, SavedScriptEntry>;
    return Object.values(scripts).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function deleteScript(name: string): Promise<{ ok: boolean }> {
  const cleanName = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  try {
    const stored = await chrome.storage.local.get(SAVED_SCRIPTS_KEY);
    const scripts = (stored[SAVED_SCRIPTS_KEY] || {}) as Record<string, SavedScriptEntry>;
    delete scripts[cleanName];
    await chrome.storage.local.set({ [SAVED_SCRIPTS_KEY]: scripts });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ─── Main Executor ─────────────────────────────────────────────────────

export interface ExecuteCodeModeOptions {
  code?: string;
  input?: unknown;
  saveAs?: string;
  scriptName?: string;
  timeoutMs?: number;
  maxToolCalls?: number;
}

export async function executeCodeMode(options: ExecuteCodeModeOptions): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
  logs: string[];
  toolCallsExecuted: number;
  durationMs: number;
}> {
  let scriptCode = options.code;

  // 1. Resolve code from saved scripts if scriptName is provided
  if (!scriptCode && options.scriptName) {
    const saved = await loadScript(options.scriptName);
    if (!saved) {
      return {
        ok: false,
        error: `Saved script '${options.scriptName}' was not found. Use code_scripts to list available scripts.`,
        logs: [],
        toolCallsExecuted: 0,
        durationMs: 0,
      };
    }
    scriptCode = saved.code;
  }

  if (!scriptCode || typeof scriptCode !== 'string' || !scriptCode.trim()) {
    return {
      ok: false,
      error: 'code_mode requires either non-empty `code` or an existing `scriptName`',
      logs: [],
      toolCallsExecuted: 0,
      durationMs: 0,
    };
  }

  // 2. Save script if requested
  if (options.saveAs) {
    await saveScript(options.saveAs, scriptCode);
  }

  const runId = activeRunContext?.runId || `run_${Date.now()}`;
  const tools = activeRunContext?.tools || {};
  const maxToolCalls = Math.min(Math.max(options.maxToolCalls || 50, 1), 100);
  const timeoutMs = Math.min(Math.max(options.timeoutMs || 30_000, 1000), 120_000);

  const execId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const nonce = `nonce_${Math.random().toString(36).slice(2, 10)}`;

  const session: CodeSession = {
    execId,
    nonce,
    runId,
    maxToolCalls,
    toolCallsCount: 0,
    tools,
    recordToolCall: activeRunContext?.recordToolCall,
  };

  activeSessions.set(execId, session);

  // List tools permitted inside sandbox (omit recursive code_mode tools)
  const allowedToolNames = Object.keys(tools).filter(
    (name) => name !== 'code_mode' && name !== 'run_code',
  );

  void emitAgentLog(
    {
      runId,
      channel: 'tool-call',
      title: `[code_mode] Starting sandboxed execution (${scriptCode.length} chars, max ${maxToolCalls} tool calls)`,
      body: scriptCode,
    },
    'Executing sandboxed code...',
  );

  try {
    const outcome = await sendToOffscreen<{
      ok: boolean;
      result?: unknown;
      error?: string;
      stack?: string;
      logs: string[];
      durationMs: number;
    }>({
      target: 'offscreen',
      kind: 'execute-sandbox-code',
      execId,
      nonce,
      code: scriptCode,
      input: options.input ?? {},
      toolNames: allowedToolNames,
      timeoutMs,
    });

    void emitAgentLog(
      {
        runId,
        channel: outcome.ok ? 'tool-result' : 'error',
        title: outcome.ok
          ? `[code_mode] Finished successfully in ${outcome.durationMs}ms with ${session.toolCallsCount} tool calls`
          : `[code_mode] Execution failed: ${outcome.error}`,
        data: outcome.ok ? outcome.result : outcome.error,
        durationMs: outcome.durationMs,
      },
      outcome.ok ? 'code_mode completed' : 'code_mode failed',
    );

    return {
      ok: outcome.ok,
      result: outcome.result,
      error: outcome.error,
      logs: outcome.logs || [],
      toolCallsExecuted: session.toolCallsCount,
      durationMs: outcome.durationMs,
    };
  } catch (err: any) {
    const errMsg = err instanceof Error ? err.message : String(err);
    void emitAgentLog({
      runId,
      channel: 'error',
      title: `[code_mode] Execution crash: ${errMsg}`,
    });

    return {
      ok: false,
      error: errMsg,
      logs: [],
      toolCallsExecuted: session.toolCallsCount,
      durationMs: 0,
    };
  } finally {
    activeSessions.delete(execId);
  }
}
