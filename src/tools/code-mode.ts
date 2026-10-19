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
  execute: async ({ code, input, saveAs, scriptName, timeoutMs, maxToolCalls }) => {
    return await executeCodeMode({
      code,
      input,
      saveAs,
      scriptName,
      timeoutMs,
      maxToolCalls,
    });
  },
});

export const codeScripts = tool({
  description:
    'Manage saved reusable code_mode scripts stored in the extension. Use this to list available scripts, inspect their code, or delete unused ones.',
  inputSchema: z.object({
    action: z
      .enum(['list', 'get', 'delete'])
      .describe('The action to perform: list, get, or delete.'),
    name: z
      .string()
      .optional()
      .describe('The script name (required for get and delete).'),
  }),
  execute: async ({ action, name }) => {
    if (action === 'list') {
      const scripts = await listSavedScripts();
      return { ok: true, scripts };
    }
    if (action === 'get') {
      if (!name) return { ok: false, error: 'name is required for get' };
      const script = await loadScript(name);
      if (!script) return { ok: false, error: `Script '${name}' not found` };
      return { ok: true, script };
    }
    if (action === 'delete') {
      if (!name) return { ok: false, error: 'name is required for delete' };
      const res = await deleteScript(name);
      return res;
    }
    return { ok: false, error: `Unknown action: ${action}` };
  },
});
