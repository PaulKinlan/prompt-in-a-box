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
    id: z.number().optional().describe('Alias for tabId.'),
    maxChars: z
      .number()
      .int()
      .positive()
      .max(200_000)
      .optional()
      .describe('Cap text/markdown length. Default 30 000.'),
    maxLength: z
      .number()
      .int()
      .positive()
      .max(200_000)
      .optional()
      .describe('Alias for maxChars.'),
    format: z
      .enum(['markdown', 'text', 'both'])
      .optional()
      .describe("Preferred content format: 'markdown' (default), 'text', or 'both'."),
  }),
  execute: async ({ tabId, id, maxChars, maxLength, format }) => {
    const resolvedTabId = tabId ?? id;
    const gate = await pageAccessGate(resolvedTabId, 'read tab content');
    if (!gate.ok) {
      return {
        id: gate.tab?.id,
        tabId: gate.tab?.id,
        title: gate.tab?.title || '',
        url: gate.url || '',
        description: '',
        metaDescription: '',
        headings: [],
        headingTexts: [],
        markdown: '',
        content: '',
        excerpt: '',
        error: gate.error,
        blocked: true,
      };
    }

    const targetTabId = gate.tab.id!;
    const charCap = maxChars ?? maxLength ?? 30_000;

    // Discarded background tabs have no live DOM in memory; fast return metadata
    if (gate.tab.discarded) {
      return {
        id: targetTabId,
        tabId: targetTabId,
        title: gate.tab.title || '',
        url: gate.url || '',
        description: '',
        metaDescription: '',
        headings: [],
        headingTexts: [],
        markdown: '',
        content: '',
        excerpt: '',
        discarded: true,
      };
    }

    const SCRIPT_TIMEOUT_MS = 4000;

    try {
      const injectionPromise = chrome.scripting.executeScript({
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

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Script injection timed out after ${SCRIPT_TIMEOUT_MS}ms`)), SCRIPT_TIMEOUT_MS),
      );

      const [injectionResult] = await Promise.race([injectionPromise, timeoutPromise]);

      const raw = injectionResult?.result;
      if (!raw) {
        return {
          id: targetTabId,
          tabId: targetTabId,
          title: gate.tab.title || '',
          url: gate.url || '',
          description: '',
          metaDescription: '',
          headings: [],
          headingTexts: [],
          markdown: '',
          content: '',
          excerpt: '',
          error: 'Failed to extract content from tab: script returned empty result',
        };
      }

      const readable = extractReadableMarkdown(raw.html, {
        url: raw.url || gate.url,
        title: raw.title || gate.tab.title,
        maxBytes: charCap * 2,
      });

      const selectedFormat = format ?? 'markdown';
      const cleanExcerpt = (raw.innerText || readable.markdown || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600);
      const cleanDesc = raw.metaDescription || '';

      const output: Record<string, unknown> = {
        id: targetTabId,
        tabId: targetTabId,
        url: raw.url || gate.url,
        title: readable.title || raw.title || gate.tab.title || 'Untitled',
        description: cleanDesc,
        metaDescription: cleanDesc || null,
        meta: {
          description: cleanDesc,
          byline: readable.byline,
          published: readable.published,
        },
        headings: raw.headings,
        headingTexts: (raw.headings || []).map((h) => h.text),
        wordCount: readable.wordCount,
        excerpt: cleanExcerpt,
        markdown: readable.markdown.slice(0, charCap),
        content: (raw.innerText || readable.markdown || '').slice(0, charCap),
        links: readable.links.slice(0, 30),
        untrusted: true,
      };

      if (selectedFormat === 'text') {
        output.markdown = '';
      }

      return output;
    } catch (err) {
      return {
        id: targetTabId,
        tabId: targetTabId,
        title: gate.tab.title || '',
        url: gate.url || '',
        description: '',
        metaDescription: '',
        headings: [],
        headingTexts: [],
        markdown: '',
        content: '',
        excerpt: '',
        error: `Failed to read tab content: ${(err as Error).message}`,
        blocked: String(err).includes('ExtensionsSettings policy'),
        timedOut: String(err).includes('timed out'),
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

    if (gate.tab.discarded) {
      return {
        tabId: targetTabId,
        url: gate.url,
        title: gate.tab.title || '',
        byline: undefined,
        published: undefined,
        wordCount: 0,
        markdown: '',
        links: [],
        discarded: true,
      };
    }

    const SCRIPT_TIMEOUT_MS = 4000;

    try {
      const injectionPromise = chrome.scripting.executeScript({
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

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Script injection timed out after ${SCRIPT_TIMEOUT_MS}ms`)), SCRIPT_TIMEOUT_MS),
      );

      const [injectionResult] = await Promise.race([injectionPromise, timeoutPromise]);

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
