// src/page-reader.ts — Pure / DOM-compatible reader-mode extraction & page access gate
// Modeled on chrome-agent-platform/extension/lib/page-reader.js and browser-tools.js

const MAX_MARKDOWN_BYTES = 512 * 1024; // 512 KiB
const MAX_LINKS = 500;

export const UNTRUSTED_TOKEN_PLACEHOLDER = '<run-token>';

/** Decode common HTML entities. */
export function decodeEntities(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, dec) => {
      const n = parseInt(dec, 10);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const n = parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/&amp;/g, '&');
}

/** Resolve URL against base URL if possible. */
export function resolveUrl(href: string, baseUrl?: string): string {
  if (!href) return '';
  const trimmed = href.trim();
  if (!baseUrl) return trimmed;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return trimmed;
  }
}

/** Truncate string to maximum byte length at clean UTF-8 boundary. */
export function truncateToBytes(str: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.byteLength <= maxBytes) return { text: str, truncated: false };

  const slice = bytes.subarray(0, maxBytes);
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  let truncatedText = decoder.decode(slice);

  const lastNewline = truncatedText.lastIndexOf('\n');
  if (lastNewline > maxBytes * 0.8) {
    truncatedText = truncatedText.slice(0, lastNewline);
  }

  return { text: truncatedText, truncated: true };
}

/** Count words in plain text. */
export function countWords(str: string): number {
  if (!str) return 0;
  const plain = str
    .replace(/---[\s\S]*?---/, '')
    .replace(/[#*_`~[\]()<>|]/g, ' ')
    .trim();
  if (!plain) return 0;
  return plain.split(/\s+/).filter(Boolean).length;
}

const STRIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'nav',
  'header',
  'footer',
  'aside',
]);

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export interface ReadableMarkdownResult {
  title: string;
  byline: string | null;
  published: string | null;
  canonicalUrl: string;
  source_url: string;
  captured_at: string;
  markdown: string;
  body: string;
  links: Array<{ text: string; href: string }>;
  wordCount: number;
  truncated: boolean;
}

/**
 * Extract metadata and convert HTML into clean structured Markdown.
 */
export function extractReadableMarkdown(
  html: string,
  options: { url?: string; title?: string; capturedAt?: string; maxBytes?: number } = {}
): ReadableMarkdownResult {
  const baseUrl = options.url || '';
  const capturedAt = options.capturedAt || new Date().toISOString();
  const maxBytes = options.maxBytes || MAX_MARKDOWN_BYTES;

  const title = options.title || extractTitleFromHtml(html) || 'Untitled';
  const canonicalUrl = extractCanonicalFromHtml(html, baseUrl);
  const byline = extractBylineFromHtml(html);
  const published = extractPublishedFromHtml(html);

  const { bodyMarkdown, links } = parseHtmlToMarkdown(html, baseUrl);
  const wordCount = countWords(bodyMarkdown);

  const frontmatter = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `source_url: ${JSON.stringify(canonicalUrl)}`,
    `captured_at: ${JSON.stringify(capturedAt)}`,
    `word_count: ${wordCount}`,
    '---',
    '',
  ].join('\n');

  const fullMarkdownUnchecked = `${frontmatter}\n${bodyMarkdown}`.trim() + '\n';
  const { text: boundedMarkdown, truncated } = truncateToBytes(fullMarkdownUnchecked, maxBytes);
  const boundedLinks = links.slice(0, MAX_LINKS);

  return {
    title,
    byline,
    published,
    canonicalUrl,
    source_url: canonicalUrl,
    captured_at: capturedAt,
    markdown: boundedMarkdown,
    body: bodyMarkdown,
    links: boundedLinks,
    wordCount,
    truncated,
  };
}

function extractTitleFromHtml(html: string): string {
  if (!html) return '';
  const ogMatch =
    html.match(/<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
  if (ogMatch?.[1]) return decodeEntities(ogMatch[1].trim());

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) return decodeEntities(titleMatch[1].replace(/<[^>]+>/g, '').trim());

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) return decodeEntities(h1Match[1].replace(/<[^>]+>/g, '').trim());

  return '';
}

function extractCanonicalFromHtml(html: string, baseUrl: string): string {
  if (!html) return baseUrl;
  const match =
    html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ||
    html.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  if (match?.[1]) return resolveUrl(match[1], baseUrl);
  return baseUrl;
}

function extractBylineFromHtml(html: string): string | null {
  if (!html) return null;
  const match =
    html.match(/<meta\s+[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']author["']/i);
  if (match?.[1]) return decodeEntities(match[1].trim());
  return null;
}

function extractPublishedFromHtml(html: string): string | null {
  if (!html) return null;
  const match =
    html.match(/<meta\s+[^>]*property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+[^>]*name=["']publication_date["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
  if (match?.[1]) return decodeEntities(match[1].trim());
  return null;
}

export function parseHtmlToMarkdown(
  html: string,
  baseUrl: string
): { bodyMarkdown: string; links: Array<{ text: string; href: string }> } {
  const links: Array<{ text: string; href: string }> = [];
  const linkSet = new Set<string>();

  if (!html || typeof html !== 'string') {
    return { bodyMarkdown: '', links };
  }

  let content = html;
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch?.[1]) {
    content = bodyMatch[1];
  }

  const parts: string[] = [];
  interface TagInfo {
    name: string;
    href?: string;
    startPart?: number;
  }
  const tagStack: TagInfo[] = [];
  let stripDepth = 0;
  let codeDepth = 0;
  let blockquoteDepth = 0;
  let listDepth = 0;
  let currentList: { type: string; index: number } | null = null;
  const listStack: Array<{ type: string; index: number }> = [];

  interface TableState {
    headers: string[];
    rows: string[][];
    currentRow: string[] | null;
    currentCell: string | null;
    isHeader: boolean;
  }
  let tableState: TableState | null = null;

  const tagRegex = /<(?:(?:\/([a-zA-Z0-9]+))|(?:([a-zA-Z0-9]+)((?:\s+[^>]*)?)\s*(\/?)))>|([^<]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(content)) !== null) {
    const [, closeTag, openTag, attrString, selfClosingSlash, textChunk] = match;

    if (textChunk) {
      if (stripDepth > 0) continue;
      if (tableState) {
        if (tableState.currentCell !== null) {
          tableState.currentCell += decodeEntities(textChunk);
        }
        continue;
      }
      if (codeDepth > 0) {
        parts.push(decodeEntities(textChunk));
      } else {
        const decoded = decodeEntities(textChunk);
        const normalized = decoded.replace(/\s+/g, ' ');
        if (normalized.length > 0) {
          parts.push(normalized);
        }
      }
      continue;
    }

    if (openTag) {
      const tagLower = openTag.toLowerCase();
      const isSelfClosing = selfClosingSlash === '/' || VOID_TAGS.has(tagLower);

      let shouldStrip = STRIP_TAGS.has(tagLower);
      if (!shouldStrip && attrString) {
        if (/\brole=["'](?:navigation|banner|contentinfo|complementary|search)["']/i.test(attrString)) {
          shouldStrip = true;
        }
        if (/\baria-hidden=["']true["']/i.test(attrString)) {
          shouldStrip = true;
        }
      }

      if (shouldStrip) {
        if (!isSelfClosing) stripDepth++;
        continue;
      }
      if (stripDepth > 0) {
        if (!isSelfClosing) stripDepth++;
        continue;
      }

      if (tagLower === 'pre') {
        codeDepth++;
        parts.push('\n\n```\n');
      } else if (tagLower === 'code' && codeDepth === 0) {
        parts.push('`');
      } else if (/^h[1-6]$/.test(tagLower)) {
        const level = parseInt(tagLower[1], 10);
        parts.push(`\n\n${'#'.repeat(level)} `);
      } else if (tagLower === 'p') {
        parts.push('\n\n');
      } else if (tagLower === 'blockquote') {
        blockquoteDepth++;
        parts.push('\n\n> ');
      } else if (tagLower === 'ul' || tagLower === 'ol') {
        listDepth++;
        currentList = { type: tagLower, index: 1 };
        listStack.push(currentList);
        parts.push('\n');
      } else if (tagLower === 'li') {
        const indent = '  '.repeat(Math.max(0, listDepth - 1));
        if (currentList?.type === 'ol') {
          parts.push(`\n${indent}${currentList.index++}. `);
        } else {
          parts.push(`\n${indent}- `);
        }
      } else if (tagLower === 'a' && attrString) {
        const hrefMatch = attrString.match(/href=["']([^"']+)["']/i);
        const rawHref = hrefMatch?.[1] ? hrefMatch[1].trim() : '';
        const href = resolveUrl(rawHref, baseUrl);
        tagStack.push({ name: 'a', href, startPart: parts.length });
        parts.push('[');
        continue;
      } else if (tagLower === 'strong' || tagLower === 'b') {
        parts.push('**');
      } else if (tagLower === 'em' || tagLower === 'i') {
        parts.push('*');
      } else if (tagLower === 'hr') {
        parts.push('\n\n---\n\n');
      } else if (tagLower === 'br') {
        parts.push('\n');
      } else if (tagLower === 'table') {
        tableState = { headers: [], rows: [], currentRow: null, currentCell: null, isHeader: false };
      } else if (tagLower === 'thead') {
        if (tableState) tableState.isHeader = true;
      } else if (tagLower === 'tbody') {
        if (tableState) tableState.isHeader = false;
      } else if (tagLower === 'tr') {
        if (tableState) tableState.currentRow = [];
      } else if (tagLower === 'th' || tagLower === 'td') {
        if (tableState) {
          tableState.currentCell = '';
          if (tagLower === 'th') tableState.isHeader = true;
        }
      }

      if (!isSelfClosing) {
        tagStack.push({ name: tagLower });
      }
      continue;
    }

    if (closeTag) {
      const tagLower = closeTag.toLowerCase();
      if (stripDepth > 0) {
        stripDepth--;
        continue;
      }

      if (tagLower === 'pre') {
        if (codeDepth > 0) {
          codeDepth--;
          parts.push('\n```\n\n');
        }
      } else if (tagLower === 'code' && codeDepth === 0) {
        parts.push('`');
      } else if (/^h[1-6]$/.test(tagLower)) {
        parts.push('\n\n');
      } else if (tagLower === 'p') {
        parts.push('\n\n');
      } else if (tagLower === 'blockquote') {
        if (blockquoteDepth > 0) blockquoteDepth--;
        parts.push('\n\n');
      } else if (tagLower === 'ul' || tagLower === 'ol') {
        listStack.pop();
        currentList = listStack[listStack.length - 1] || null;
        if (listDepth > 0) listDepth--;
        parts.push('\n');
      } else if (tagLower === 'strong' || tagLower === 'b') {
        parts.push('**');
      } else if (tagLower === 'em' || tagLower === 'i') {
        parts.push('*');
      } else if (tagLower === 'a') {
        let foundIdx = -1;
        for (let i = tagStack.length - 1; i >= 0; i--) {
          if (tagStack[i].name === 'a') {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx !== -1) {
          const aInfo = tagStack[foundIdx];
          tagStack.splice(foundIdx, 1);
          const startPart = aInfo.startPart ?? parts.length;
          const linkText = parts.slice(startPart + 1).join('').trim();
          parts.push(`](${aInfo.href || ''})`);
          if (aInfo.href && !aInfo.href.startsWith('javascript:') && links.length < MAX_LINKS) {
            const key = `${linkText}::${aInfo.href}`;
            if (!linkSet.has(key)) {
              linkSet.add(key);
              links.push({ text: linkText, href: aInfo.href });
            }
          }
        }
      } else if (tagLower === 'th' || tagLower === 'td') {
        if (tableState && tableState.currentRow && tableState.currentCell !== null) {
          tableState.currentRow.push(tableState.currentCell.trim());
          tableState.currentCell = null;
        }
      } else if (tagLower === 'tr') {
        if (tableState && tableState.currentRow) {
          if (tableState.isHeader && tableState.headers.length === 0) {
            tableState.headers = tableState.currentRow;
          } else {
            tableState.rows.push(tableState.currentRow);
          }
          tableState.currentRow = null;
        }
      } else if (tagLower === 'table') {
        if (tableState) {
          const tableMd = formatMarkdownTable(tableState);
          if (tableMd) parts.push(`\n\n${tableMd}\n\n`);
          tableState = null;
        }
      }

      for (let i = tagStack.length - 1; i >= 0; i--) {
        if (tagStack[i].name === tagLower) {
          tagStack.splice(i, 1);
          break;
        }
      }
    }
  }

  let bodyMarkdown = parts.join('');
  bodyMarkdown = bodyMarkdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { bodyMarkdown, links };
}

function formatMarkdownTable(tableState: { headers: string[]; rows: string[][] }): string {
  let headers = tableState.headers;
  const rows = tableState.rows;

  if ((!headers || headers.length === 0) && rows.length > 0) {
    const candidate = rows.shift();
    if (candidate) headers = candidate;
  }
  if (!headers || headers.length === 0) return '';

  const colCount = headers.length;
  const cleanHeader = headers.map((h) => (h || '').replace(/\|/g, '\\|'));
  const headerLine = `| ${cleanHeader.join(' | ')} |`;
  const sepLine = `| ${headers.map(() => '---').join(' | ')} |`;
  const rowLines = rows.map((r) => {
    const cells: string[] = [];
    for (let c = 0; c < colCount; c++) {
      cells.push((r[c] || '').replace(/\|/g, '\\|'));
    }
    return `| ${cells.join(' | ')} |`;
  });

  return [headerLine, sepLine, ...rowLines].join('\n');
}

/** Pre-flight gate verifying target tab exists, is http(s), and scripting + host permissions are held. */
export async function pageAccessGate(
  tabId?: number,
  verb = 'inspect page content'
): Promise<{ ok: true; tab: chrome.tabs.Tab; url: string; origin: string } | { ok: false; error: string; tab?: chrome.tabs.Tab; url?: string }> {
  let tab: chrome.tabs.Tab | undefined;
  if (typeof tabId === 'number' && Number.isFinite(tabId)) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { ok: false, error: `Tab ${tabId} not found` };
    }
  } else {
    try {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = active;
    } catch {
      // ignore
    }
    if (!tab) {
      try {
        const [anyActive] = await chrome.tabs.query({ active: true });
        tab = anyActive;
      } catch {
        // ignore
      }
    }
  }

  if (!tab || typeof tab.id !== 'number') {
    return { ok: false, error: `No accessible tab found to ${verb}` };
  }

  const url = tab.url || tab.pendingUrl || '';
  if (!url) {
    return { ok: false, error: `Cannot ${verb}: the tab address is hidden or unavailable`, tab };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: `Cannot ${verb}: invalid tab URL '${url}'`, tab, url };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `Cannot ${verb}: only available on standard web pages (http:// or https://), not privileged or browser-internal '${url}'`,
      tab,
      url,
    };
  }

  const origin = parsed.origin;

  // Check scripting permission
  try {
    const hasScripting = await chrome.permissions.contains({ permissions: ['scripting'] });
    if (!hasScripting) {
      return {
        ok: false,
        error: `Cannot ${verb}: the 'scripting' permission is missing. Please enable it in extension Options -> Permissions.`,
        tab,
        url,
      };
    }
  } catch {
    // If permissions check fails, continue to host check
  }

  // Check host permission
  try {
    const hasOrigin =
      (await chrome.permissions.contains({ origins: ['<all_urls>'] })) ||
      (await chrome.permissions.contains({ origins: [`${origin}/*`] }));
    if (!hasOrigin) {
      return {
        ok: false,
        error: `Cannot ${verb}: missing host permission for '${origin}/*'. Grant host access or enable <all_urls> in extension settings.`,
        tab,
        url,
      };
    }
  } catch {
    // If check throws, proceed and let executeScript attempt
  }

  return { ok: true, tab, url, origin };
}
