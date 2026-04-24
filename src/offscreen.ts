/**
 * Offscreen document worker.
 *
 * Provides DOM-dependent operations the service worker can't do itself:
 *   - clipboard writes via navigator.clipboard
 *   - DOMParser (HTML → structured data)
 *   - blob / object URL manipulation
 *   - Audio / Canvas when we need them later
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
          // Parse HTML in the offscreen doc so the SW can get structured
          // content without running scripts in the target tab.
          const html = String(msg.html ?? '');
          const doc = new DOMParser().parseFromString(html, 'text/html');
          sendResponse({
            ok: true,
            title: doc.title,
            text: doc.body?.innerText ?? '',
          });
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
