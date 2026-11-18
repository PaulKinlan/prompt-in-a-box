/**
 * code_mode and code_scripts AI SDK Tool Definitions
 */

import { tool } from 'ai';
import { z } from 'zod';
import {
  executeCodeMode,
  listSavedScripts,
  loadScript,
  deleteScript,
} from '../code-mode';

export const codeMode = tool({
  description:
    'Execute sandboxed JavaScript to batch, chain, and parallelize extension tools in a single turn (e.g. analyzing 20 tabs in parallel with Promise.all, or grouping multiple clusters and setting state at once). Inside the script, ONLY tools.<name>(args) (supporting both snake_case and camelCase, e.g. tools.tab_read or tools.readPage), callTool(name, args), input, and log(...args) are exposed. No direct network or raw chrome.* APIs are accessible. Returns whatever the async function returns.',
  inputSchema: z.object({
    code: z
      .string()
      .optional()
      .describe(
        'The async JavaScript code to execute. Can use await tools.<toolName>(args), Promise.all([...]), Array methods, JSON, and return a value.',
      ),
    input: z
      .any()
      .optional()
      .describe('Optional data object passed into the sandbox as `input`.'),
    saveAs: z
      .string()
      .optional()
      .describe(
        'Optional identifier name to save this code routine in extension storage so it can be re-executed by name on future runs without re-generating code.',
      ),
    description: z
      .string()
      .optional()
      .describe('Optional short description when saving a routine with `saveAs`.'),
    onEvents: z
      .array(z.string())
      .optional()
      .describe(
        'Optional Chrome event source names (e.g. ["tabs.onUpdated"]) to bind when saving a routine. Matching events run this routine on a zero-token fast path with `input.event`; return `{ handled: true }` if handled or `{ handled: false }` to fall back to the LLM.',
      ),
    scriptName: z
      .string()
      .optional()
      .describe('Optional name of a previously saved script to execute.'),
    timeoutMs: z
      .number()
      .optional()
      .describe('Execution timeout in milliseconds (default 60000, max 180000).'),
    maxToolCalls: z
      .number()
      .optional()
      .describe('Maximum number of inner tool calls permitted (default 100, max 250).'),
  }),
  execute: async ({
    code,
    input,
    saveAs,
    description,
    onEvents,
    scriptName,
    timeoutMs,
    maxToolCalls,
  }) => {
    return await executeCodeMode({
      code,
      input,
      saveAs,
      description,
      onEvents,
      scriptName,
      timeoutMs,
      maxToolCalls,
    });
  },
});

export const codeScripts = tool({
  description:
    'Manage saved reusable code_mode scripts stored in the extension (including any `onEvents` fast-path event subscriptions). Use this to list available scripts, inspect their code, or delete unused ones.',
  inputSchema: z.object({
    action: z
      .enum(['list', 'get', 'delete'])
      .describe('The action to perform: list, get, or delete.'),
    name: z
      .string()
      .optional()
      .describe('The script name (required for get, and for delete unless deleting by onEvents).'),
    onEvents: z
      .array(z.string())
      .optional()
      .describe('Optional Chrome event source filter when listing or deleting event-bound scripts.'),
  }),
  execute: async ({ action, name, onEvents }) => {
    if (action === 'list') {
      const allScripts = await listSavedScripts();
      const filtered =
        Array.isArray(onEvents) && onEvents.length > 0
          ? allScripts.filter(
              (s) =>
                Array.isArray(s.onEvents) &&
                s.onEvents.some((ev) => onEvents.includes(ev) || ev === '*'),
            )
          : allScripts;
      const scripts = filtered.map((s) => ({
        ...s,
        onEvents: s.onEvents ?? [],
      }));
      return { ok: true, scripts };
    }
    if (action === 'get') {
      if (!name) return { ok: false, error: 'name is required for get' };
      const script = await loadScript(name);
      if (!script) return { ok: false, error: `Script '${name}' not found` };
      return {
        ok: true,
        script: {
          ...script,
          onEvents: script.onEvents ?? [],
        },
      };
    }
    if (action === 'delete') {
      if (name) {
        const existing = await loadScript(name);
        const res = await deleteScript(name);
        return {
          ...res,
          deleted: res.ok ? [name] : [],
          onEvents: existing?.onEvents ?? [],
        };
      }
      if (Array.isArray(onEvents) && onEvents.length > 0) {
        const allScripts = await listSavedScripts();
        const matching = allScripts.filter(
          (s) => Array.isArray(s.onEvents) && s.onEvents.some((ev) => onEvents.includes(ev)),
        );
        const deleted: string[] = [];
        for (const s of matching) {
          const res = await deleteScript(s.name);
          if (res.ok) deleted.push(s.name);
        }
        return { ok: true, deleted, onEvents };
      }
      return { ok: false, error: 'name is required for delete' };
    }
    return { ok: false, error: `Unknown action: ${action}` };
  },
});
