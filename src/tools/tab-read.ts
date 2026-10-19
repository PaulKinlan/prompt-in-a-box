import { tool } from 'ai';
import { z } from 'zod';
import { pageAccessGate, extractReadableMarkdown } from '../page-reader';

/**
 * Tab content extraction tool: reads rendered page content, metadata, headings,
 * and converts to structured Reader-Mode Markdown with untrusted fencing.
 */
export const tabRead = tool({
  description:
    'Read the rendered content of a tab (defaults to active tab if tabId is omitted): extracts title, description, headings, readable markdown, body text, and links.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID to read. Defaults to the active tab if omitted.'),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(200_000)
      .optional()
      .describe('Cap text/markdown length. Default 30 000.'),
    format: z
      .enum(['markdown', 'text', 'both'])
      .optional()
      .describe("Preferred content format: 'markdown' (default), 'text', or 'both'."),
  }),
  execute: async ({ tabId, maxChars, format }) => {
    const gate = await pageAccessGate(tabId, 'read tab content');
    if (!gate.ok) {
      return {
        error: gate.error,
        tabId: gate.tab?.id,
        url: gate.url,
      };
    }

    const targetTabId = gate.tab.id!;
    const charCap = maxChars ?? 30_000;

    try {
      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        world: 'ISOLATED',
        func: () => {
          const doc = document;
          const metaDesc =
            doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
            doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
            '';

          // Extract up to 30 visible headings
          const headingEls = Array.from(doc.querySelectorAll('h1, h2, h3')).slice(0, 30);
          const headings = headingEls
            .map((el) => ({
              level: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().replace(/\s+/g, ' '),
            }))
            .filter((h) => h.text.length > 0);

          // Get primary content container if possible, else body
          const mainEl = doc.querySelector('main, article, [role="main"]') || doc.body || doc.documentElement;
          const clone = mainEl.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('script, style, noscript, svg, canvas, iframe').forEach((n) => n.remove());

          return {
            title: doc.title || '',
            url: location.href,
            metaDescription: metaDesc,
            headings,
            innerText: (doc.body?.innerText || '').slice(0, 100_000),
            html: clone.outerHTML.slice(0, 300_000),
          };
        },
      });

      const raw = injectionResult?.result;
      if (!raw) {
        return { error: 'Failed to extract content from tab: script returned empty result', tabId: targetTabId };
      }

      const readable = extractReadableMarkdown(raw.html, {
        url: raw.url || gate.url,
        title: raw.title || gate.tab.title,
        maxBytes: charCap * 2,
      });

      const selectedFormat = format ?? 'markdown';
      const output: Record<string, unknown> = {
        tabId: targetTabId,
        url: raw.url || gate.url,
        title: readable.title || raw.title || gate.tab.title || 'Untitled',
        metaDescription: raw.metaDescription || null,
        byline: readable.byline,
        published: readable.published,
        wordCount: readable.wordCount,
        headings: raw.headings,
        links: readable.links.slice(0, 30),
        untrusted: true,
      };

      if (selectedFormat === 'markdown' || selectedFormat === 'both') {
        output.markdown = readable.markdown.slice(0, charCap);
      }
      if (selectedFormat === 'text' || selectedFormat === 'both') {
        output.content = raw.innerText.slice(0, charCap);
      }

      return output;
    } catch (err) {
      return {
        error: `Failed to read tab content: ${(err as Error).message}`,
        tabId: targetTabId,
        url: gate.url,
      };
    }
  },
});

/**
 * Capture page reader-mode tool: pure structured Markdown reader with metadata frontmatter.
 */
export const capturePage = tool({
  description:
    'Capture a clean reader-mode structured Markdown snapshot of a tab (defaults to active tab) with metadata frontmatter and top links.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID to capture. Defaults to the active tab if omitted.'),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(250_000)
      .optional()
      .describe('Cap Markdown text length. Default 50 000.'),
  }),
  execute: async ({ tabId, maxChars }) => {
    const gate = await pageAccessGate(tabId, 'capture page reader-mode');
    if (!gate.ok) {
      return {
        error: gate.error,
        tabId: gate.tab?.id,
        url: gate.url,
      };
    }

    const targetTabId = gate.tab.id!;
    const charCap = maxChars ?? 50_000;

    try {
      const [injectionResult] = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        world: 'ISOLATED',
        func: () => {
          const doc = document;
          const mainEl = doc.querySelector('main, article, [role="main"]') || doc.body || doc.documentElement;
          const clone = mainEl.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('script, style, noscript, svg, canvas, iframe').forEach((n) => n.remove());

          return {
            title: doc.title,
            url: location.href,
            html: clone.outerHTML.slice(0, 400_000),
          };
        },
      });

      const raw = injectionResult?.result;
      if (!raw) {
        return { error: 'Failed to capture page: script returned empty result', tabId: targetTabId };
      }

      const readable = extractReadableMarkdown(raw.html, {
        url: raw.url || gate.url,
        title: raw.title || gate.tab.title,
        maxBytes: charCap * 2,
      });

      return {
        tabId: targetTabId,
        url: readable.source_url,
        title: readable.title,
        byline: readable.byline,
        published: readable.published,
        wordCount: readable.wordCount,
        markdown: readable.markdown.slice(0, charCap),
        links: readable.links.slice(0, 50),
        untrusted: true,
      };
    } catch (err) {
      return {
        error: `Failed to capture page: ${(err as Error).message}`,
        tabId: targetTabId,
        url: gate.url,
      };
    }
  },
});
