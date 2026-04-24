import { tool } from 'ai';
import { z } from 'zod';

/**
 * Tab content extraction.
 *
 * Uses chrome.scripting.executeScript to run a small extractor in the
 * target tab's isolated world. Returns the page's title, textual body,
 * and a trimmed HTML snapshot. The extractor runs as a content script,
 * so it has no access to the page's own JS scope — it's looking at the
 * rendered DOM snapshot only, which matches what a human reading the
 * page would see.
 *
 * Requires the `scripting` permission + host access to the target tab.
 * Both are declared as optional in the manifest; the prompt can ask
 * for them at runtime via chrome.permissions.request.
 */
export const tabRead = tool({
  description:
    "Read the rendered content of a tab: title, innerText of the body, and a trimmed HTML snapshot. Set `maxChars` to limit the returned text.",
  inputSchema: z.object({
    tabId: z.number(),
    maxChars: z.number().int().positive().max(100_000).optional().describe('Cap text length. Default 20 000.'),
  }),
  execute: async ({ tabId, maxChars }) => {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: (cap: number) => {
        const text = (document.body?.innerText ?? '').slice(0, cap);
        // Trim script/style out of the HTML snapshot to keep the return
        // value small and the content model-friendly.
        const clone = document.documentElement.cloneNode(true) as Element;
        clone.querySelectorAll('script, style, noscript').forEach((n) => n.remove());
        const html = clone.outerHTML.slice(0, cap * 3);
        return {
          title: document.title,
          url: location.href,
          text,
          htmlPreview: html,
          charCount: text.length,
        };
      },
      args: [maxChars ?? 20_000],
    });
    return result.result;
  },
});
