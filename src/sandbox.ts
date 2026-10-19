/**
 * Sandboxed Execution Environment for Prompt in a Box
 *
 * Runs inside Chrome's isolated MV3 sandbox (opaque origin, no chrome.* access,
 * connect-src 'none'). Hosts:
 * 1. HTML artifact rendering for artifacts-browser
 * 2. Sandboxed code_mode async JavaScript execution for batch tool chaining
 */

// ─── Teach Guards for Prohibited Ambient APIs ───────────────────────────
(function installSandboxTeachGuards() {
  const teachStorage = (name: string) =>
    new Error(
      `'${name}' is unavailable inside the code_mode sandbox. Use tools.storage_get / tools.storage_set or tools.opfs_read / tools.opfs_write to persist state.`,
    );

  const teachNetwork = (name: string) =>
    new Error(
      `Direct network access '${name}' is forbidden in the sandbox. Use tools.tab_read / tools.read_page or extension tools to inspect web pages and fetch data.`,
    );

  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw teachStorage('localStorage');
      },
    });
  } catch {
    // ignore
  }

  try {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw teachStorage('sessionStorage');
      },
    });
  } catch {
    // ignore
  }

  try {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      get: () => {
        throw teachStorage('indexedDB');
      },
    });
  } catch {
    // ignore
  }

  try {
    Object.defineProperty(window, 'caches', {
      configurable: true,
      get: () => {
        throw teachStorage('caches');
      },
    });
  } catch {
    // ignore
  }

  try {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => {
        throw teachStorage('document.cookie');
      },
    });
  } catch {
    // ignore
  }

  try {
    window.fetch = (() => {
      throw teachNetwork('fetch');
    }) as any;
  } catch {
    // ignore
  }

  try {
    (window as any).XMLHttpRequest = function () {
      throw teachNetwork('XMLHttpRequest');
    };
  } catch {
    // ignore
  }

  try {
    (window as any).WebSocket = function () {
      throw teachNetwork('WebSocket');
    };
  } catch {
    // ignore
  }
})();

// Helper to convert camelCase to snake_case
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

// Helper to convert snake_case to camelCase
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Common single-argument tool normalization
function normalizeToolArgs(toolName: string, args: unknown): unknown {
  if (args === undefined || args === null) return {};
  if (typeof args === 'object' && !Array.isArray(args)) {
    const obj = { ...(args as Record<string, unknown>) };
    if (obj.id !== undefined && obj.tabId === undefined) {
      obj.tabId = obj.id;
    } else if (obj.tabId !== undefined && obj.id === undefined) {
      obj.id = obj.tabId;
    }
    if (obj.maxChars !== undefined && obj.maxLength === undefined) {
      obj.maxLength = obj.maxChars;
    } else if (obj.maxLength !== undefined && obj.maxChars === undefined) {
      obj.maxChars = obj.maxLength;
    }
    return obj;
  }
  if (typeof args === 'object') return args;

  const t = toolName.toLowerCase();
  if (
    typeof args === 'number' &&
    (t.includes('tab') || t === 'read_page' || t === 'capture_page')
  ) {
    return { tabId: args, id: args };
  }
  if (typeof args === 'string') {
    if (t === 'storage_get' || t === 'get_state') return { key: args };
    if (t === 'opfs_read' || t === 'opfs_write' || t === 'opfs_list') return { path: args };
    if (t === 'action_undo' || t === 'undo_action') return { actionId: args };
  }
  return args;
}

// ─── Main Message Dispatcher ───────────────────────────────────────────
window.addEventListener('message', async (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // 1. Artifact HTML rendering
  if (data.type === 'render' && typeof data.html === 'string') {
    const contentDiv = document.getElementById('content');
    if (contentDiv) {
      contentDiv.innerHTML = data.html;
    }
    return;
  }

  // 2. Sandboxed Code Execution
  if (data.type === 'pib:code-execute') {
    const { execId, nonce, code, input, toolNames } = data;
    if (!execId || !nonce || typeof code !== 'string') return;

    const postToHost = (msg: Record<string, unknown>) => {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ execId, nonce, ...msg }, '*');
        }
      } catch {
        // Parent window gone
      }
    };

    const pendingToolCalls = new Map<
      string,
      { resolve: (val: unknown) => void; reject: (err: Error) => void }
    >();

    const onToolResult = (ev: MessageEvent) => {
      const resData = ev.data;
      if (
        !resData ||
        resData.type !== 'pib:code-tool-result' ||
        resData.execId !== execId ||
        resData.nonce !== nonce
      ) {
        return;
      }
      const pending = pendingToolCalls.get(resData.callId);
      if (!pending) return;
      pendingToolCalls.delete(resData.callId);

      if (resData.ok) {
        pending.resolve(resData.result);
      } else {
        pending.reject(new Error(resData.error || 'Tool execution failed'));
      }
    };

    window.addEventListener('message', onToolResult);

    const callTool = (rawName: string, rawArgs?: unknown): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        pendingToolCalls.set(callId, { resolve, reject });

        const toolName = String(rawName);
        const args = normalizeToolArgs(toolName, rawArgs);

        postToHost({
          type: 'pib:code-tool-call',
          callId,
          toolName,
          args,
        });
      });
    };

    // Build the dynamic `tools` proxy supporting snake_case and camelCase
    const toolsProxy = new Proxy({} as Record<string, (args?: unknown) => Promise<unknown>>, {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        return (args?: unknown) => callTool(prop, args);
      },
    });

    // Logging sink
    const customLog = (...args: unknown[]) => {
      const text = args
        .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
        .join(' ');
      postToHost({
        type: 'pib:code-log',
        text,
      });
    };

    // Scope object providing tools, callTool, input, log
    const scope: Record<string, unknown> = {
      tools: toolsProxy,
      callTool,
      input: input ?? {},
      log: customLog,
      console: {
        log: customLog,
        info: customLog,
        warn: customLog,
        error: customLog,
      },
    };

    // Bind convenience global tool identifiers (both snake_case and camelCase)
    if (Array.isArray(toolNames)) {
      for (const name of toolNames) {
        const snake = camelToSnake(name);
        const camel = snakeToCamel(name);
        const fn = (args?: unknown) => callTool(snake, args);
        scope[snake] = fn;
        scope[camel] = fn;
        try {
          (window as any)[snake] = fn;
          (window as any)[camel] = fn;
        } catch {
          // ignore
        }
      }
    }

    try {
      // Execute the script in an async function
      const paramNames = Object.keys(scope);
      const paramValues = Object.values(scope);

      // Wrap code in an async IIFE
      const runner = new Function(
        ...paramNames,
        `return (async () => {\n${code}\n})();`,
      );

      const result = await runner(...paramValues);
      postToHost({
        type: 'pib:code-result',
        ok: true,
        result,
      });
    } catch (err: any) {
      postToHost({
        type: 'pib:code-error',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      window.removeEventListener('message', onToolResult);
    }
  }
});

// Signal to the parent host that the sandbox listener is attached and ready
try {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: 'pib:sandbox-ready' }, '*');
  }
} catch {
  // ignore
}
