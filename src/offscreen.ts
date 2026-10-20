/**
 * Offscreen document worker.
 *
 * Provides DOM-dependent operations the service worker can't do itself:
 *   - clipboard writes via navigator.clipboard
 *   - DOMParser (HTML → structured data)
 *   - Sandboxed iframe host for code_mode async JavaScript execution
 *
 * Speaks chrome.runtime messages. The background SW addresses us by
 * setting `target: 'offscreen'` on the message envelope. Messages with
 * a different target are ignored so the SW's own run-now / get-audit
 * RPCs don't hit us.
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;

  (async () => {
    try {
      switch (msg.kind) {
        case 'clipboard-write-text': {
          const text = String(msg.text ?? '');
          await navigator.clipboard.writeText(text);
          sendResponse({ ok: true });
          return;
        }
        case 'parse-html': {
          const html = String(msg.html ?? '');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          sendResponse({
            ok: true,
            title: doc.title,
            text: doc.body?.innerText ?? '',
          });
          return;
        }
        case 'execute-sandbox-code': {
          const { execId, nonce, code, input, toolNames } = msg;
          const timeoutMs = Math.min(Math.max(Number(msg.timeoutMs) || 60_000, 1000), 180_000);
          const outcome = await executeCodeInSandbox({
            execId,
            nonce,
            code,
            input,
            toolNames: Array.isArray(toolNames) ? toolNames : [],
            timeoutMs,
          });
          sendResponse(outcome);
          return;
        }
        default:
          sendResponse({ error: `unknown offscreen kind: ${msg.kind}` });
      }
    } catch (err) {
      sendResponse({ error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true; // keep channel open for async
});

interface SandboxRunOptions {
  execId: string;
  nonce: string;
  code: string;
  input: unknown;
  toolNames: string[];
  timeoutMs: number;
}

function executeCodeInSandbox(opts: SandboxRunOptions): Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
  stack?: string;
  logs: string[];
  durationMs: number;
}> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const logs: string[] = [];
    let settled = false;

    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('dist/sandbox.html');
    iframe.style.display = 'none';
    iframe.setAttribute('title', 'prompt-in-a-box code sandbox');
    document.body.appendChild(iframe);

    let timer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      try {
        iframe.remove();
      } catch {
        // already removed
      }
    };

    const settle = (val: {
      ok: boolean;
      result?: unknown;
      error?: string;
      stack?: string;
    }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        ...val,
        logs,
        durationMs: Date.now() - startTime,
      });
    };

    timer = setTimeout(() => {
      settle({
        ok: false,
        error: `Sandbox script execution timed out after ${opts.timeoutMs}ms`,
      });
    }, opts.timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data?.type === 'pib:sandbox-ready') {
        sendExecute();
        return;
      }
      if (!data || data.execId !== opts.execId || data.nonce !== opts.nonce) return;

      switch (data.type) {
        case 'pib:code-tool-call': {
          (async () => {
            try {
              const res = (await chrome.runtime.sendMessage({
                type: 'code-mode-tool-call',
                execId: opts.execId,
                nonce: opts.nonce,
                callId: data.callId,
                toolName: data.toolName,
                args: data.args,
              })) as { ok: boolean; result?: unknown; error?: string };

              iframe.contentWindow?.postMessage(
                {
                  type: 'pib:code-tool-result',
                  execId: opts.execId,
                  nonce: opts.nonce,
                  callId: data.callId,
                  ok: res?.ok ?? false,
                  result: res?.result,
                  error: res?.error,
                },
                '*',
              );
            } catch (err: any) {
              iframe.contentWindow?.postMessage(
                {
                  type: 'pib:code-tool-result',
                  execId: opts.execId,
                  nonce: opts.nonce,
                  callId: data.callId,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                },
                '*',
              );
            }
          })();
          break;
        }

        case 'pib:code-log': {
          const text = String(data.text ?? '');
          logs.push(text);
          chrome.runtime
            .sendMessage({
              type: 'code-mode-log',
              execId: opts.execId,
              nonce: opts.nonce,
              text,
            })
            .catch(() => {});
          break;
        }

        case 'pib:sandbox-ready': {
          sendExecute();
          break;
        }

        case 'pib:code-result': {
          settle({ ok: true, result: data.result });
          break;
        }

        case 'pib:code-error': {
          settle({ ok: false, error: data.error, stack: data.stack });
          break;
        }
      }
    };

    window.addEventListener('message', onMessage);

    let sent = false;
    const sendExecute = () => {
      if (sent || settled) return;
      sent = true;
      iframe.contentWindow?.postMessage(
        {
          type: 'pib:code-execute',
          execId: opts.execId,
          nonce: opts.nonce,
          code: opts.code,
          input: opts.input,
          toolNames: opts.toolNames,
        },
        '*',
      );
    };

    iframe.addEventListener('load', sendExecute);
  });
}
