import { tool } from 'ai';
import { z } from 'zod';
import { pageAccessGate } from '../page-reader';

const CAP_REF_ATTR = 'data-cap-ref';

/**
 * Self-contained DOM action runner injected into target tab's ISOLATED world.
 */
function pageActionInjected(
  op: 'snapshot' | 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'tables',
  params: Record<string, unknown> = {}
) {
  function q(sel: string): Element[] {
    try {
      return Array.prototype.slice.call(document.querySelectorAll(sel));
    } catch {
      return [];
    }
  }

  function attr(el: Element, n: string): string | null {
    try {
      return el.getAttribute ? el.getAttribute(n) : null;
    } catch {
      return null;
    }
  }

  function txt(el: Element): string {
    try {
      return (el.textContent || '').replace(/\s+/g, ' ').trim();
    } catch {
      return '';
    }
  }

  function nameOf(el: Element): string {
    const al = attr(el, 'aria-label');
    if (al && al.trim()) return al.trim().slice(0, 300);

    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      let lab = '';
      try {
        const inp = el as HTMLInputElement;
        if (inp.labels && inp.labels.length) lab = txt(inp.labels[0]);
      } catch {
        lab = '';
      }
      if (!lab && el.id) {
        const labels = q('label');
        for (let j = 0; j < labels.length; j++) {
          if (attr(labels[j], 'for') === el.id) {
            lab = txt(labels[j]);
            break;
          }
        }
      }
      if (lab) return lab.slice(0, 300);
      const ph = attr(el, 'placeholder');
      if (ph && ph.trim()) return ph.trim().slice(0, 300);
    }

    const alt = attr(el, 'alt');
    if (alt && alt.trim()) return alt.trim().slice(0, 300);

    const title = attr(el, 'title');
    if (title && title.trim()) return title.trim().slice(0, 300);

    const body = txt(el);
    if (body) return body.slice(0, 300);

    let val = '';
    try {
      val = (el as HTMLInputElement).value || '';
    } catch {
      val = '';
    }
    return String(val).slice(0, 300);
  }

  function roleOf(el: Element): string {
    const r = attr(el, 'role');
    if (r && r.trim()) return r.trim().slice(0, 40);
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'a') return attr(el, 'href') != null ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'summary') return 'button';
    if (tag === 'input') {
      const ty = (attr(el, 'type') || 'text').toLowerCase();
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'submit' || ty === 'button' || ty === 'reset') return 'button';
      return 'textbox';
    }
    return tag || 'generic';
  }

  function visible(el: Element): boolean {
    try {
      if ((el as HTMLElement).hidden === true) return false;
      if (attr(el, 'aria-hidden') === 'true') return false;
      const ty = (el.tagName === 'INPUT' ? attr(el, 'type') || '' : '').toLowerCase();
      if (ty === 'hidden') return false;
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const s = window.getComputedStyle(el);
        if (s && (s.display === 'none' || s.visibility === 'hidden')) return false;
      }
      if (typeof el.getBoundingClientRect === 'function') {
        const rc = el.getBoundingClientRect();
        if (rc && rc.width === 0 && rc.height === 0) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  function resolve(ref: unknown, selector?: unknown): Element | null {
    if (selector && typeof selector === 'string') {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch {
        // ignore
      }
    }
    if (ref != null) {
      const want = String(ref);
      const list = q('[' + CAP_REF_ATTR + ']');
      for (let i = 0; i < list.length; i++) {
        if (attr(list[i], CAP_REF_ATTR) === want) return list[i];
      }
    }
    return null;
  }

  const SEL = 'a[href],button,input,select,textarea,summary,[role],[tabindex],[contenteditable="true"],[contenteditable=""]';

  if (op === 'snapshot') {
    const prev = q('[' + CAP_REF_ATTR + ']');
    for (let p = 0; p < prev.length; p++) {
      try {
        prev[p].removeAttribute(CAP_REF_ATTR);
      } catch {
        // ignore
      }
    }

    const max = Math.max(1, Math.min(200, ((params.max as number) | 0) || 100));
    const cand = params.selector && typeof params.selector === 'string' ? q(params.selector) : q(SEL);
    const seen: Element[] = [];
    const vis: Element[] = [];

    for (let c = 0; c < cand.length; c++) {
      const e0 = cand[c];
      if (seen.indexOf(e0) !== -1) continue;
      seen.push(e0);
      if (visible(e0)) vis.push(e0);
    }

    const truncated = vis.length > max;
    const take = vis.slice(0, max);
    const out: Array<{ ref: number; role: string; name: string; tag: string; href?: string; type?: string }> = [];

    for (let t = 0; t < take.length; t++) {
      const el = take[t];
      try {
        el.setAttribute(CAP_REF_ATTR, String(t));
      } catch {
        continue;
      }
      const item: { ref: number; role: string; name: string; tag: string; href?: string; type?: string } = {
        ref: t,
        role: roleOf(el),
        name: nameOf(el),
        tag: (el.tagName || '').toLowerCase(),
      };
      const href = attr(el, 'href');
      if (href) item.href = href;
      const type = attr(el, 'type');
      if (type) item.type = type;
      out.push(item);
    }
    return { elements: out, total: vis.length, truncated };
  }

  if (op === 'click') {
    const el = resolve(params.ref, params.selector);
    if (!el) return { error: 'Element not found. Call find_elements first to take a fresh snapshot.' };
    const crole = roleOf(el);
    const cname = nameOf(el);
    try {
      if ((el as HTMLElement).scrollIntoView) {
        (el as HTMLElement).scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    } catch {
      // ignore
    }
    try {
      if (typeof (el as HTMLElement).click === 'function') {
        (el as HTMLElement).click();
      } else {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    } catch (e) {
      return { error: `Click failed: ${(e as Error).message}` };
    }
    return { ok: true, ref: params.ref, role: crole, name: cname };
  }

  if (op === 'type') {
    const el = resolve(params.ref, params.selector);
    if (!el) return { error: 'Element not found. Call find_elements first to take a fresh snapshot.' };
    const tag = (el.tagName || '').toLowerCase();
    const val = params.text == null ? '' : String(params.text);
    try {
      if ((el as HTMLElement).focus) (el as HTMLElement).focus();
    } catch {
      // ignore
    }
    try {
      if (tag === 'input' || tag === 'textarea') {
        const inp = el as HTMLInputElement;
        if (params.clear) inp.value = '';
        inp.value = val;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      } else if ((el as HTMLElement).isContentEditable) {
        el.textContent = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        return { error: 'Element is not an input, textarea or contenteditable element.' };
      }
    } catch (e) {
      return { error: `Type failed: ${(e as Error).message}` };
    }
    return { ok: true, ref: params.ref, name: nameOf(el) };
  }

  if (op === 'select') {
    const el = resolve(params.ref, params.selector);
    if (!el) return { error: 'Element not found. Call find_elements first to take a fresh snapshot.' };
    if ((el.tagName || '').toLowerCase() !== 'select') {
      return { error: 'Element is not a <select> element.' };
    }
    const sel = el as HTMLSelectElement;
    const want = params.value == null ? '' : String(params.value);
    const opts = Array.from(sel.options);
    let matched = false;
    for (const o of opts) {
      if (o.value === want || (o.textContent || '').trim() === want) {
        sel.value = o.value;
        matched = true;
        break;
      }
    }
    if (!matched) return { error: `No option matches '${want}'` };
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, ref: params.ref, name: nameOf(sel), value: sel.value };
  }

  if (op === 'scroll') {
    if (params.ref != null || params.selector) {
      const el = resolve(params.ref, params.selector);
      if (!el) return { error: 'Element not found to scroll into view.' };
      (el as HTMLElement).scrollIntoView?.({ block: 'center', inline: 'nearest' });
      return { ok: true, ref: params.ref };
    }
    const dir = String(params.direction || 'down').toLowerCase();
    const amount = typeof params.amount === 'number' && Number.isFinite(params.amount) ? params.amount : 500;
    if (dir === 'top') {
      window.scrollTo(0, 0);
    } else if (dir === 'bottom') {
      window.scrollTo(0, document.body.scrollHeight || document.documentElement.scrollHeight);
    } else {
      let dy = amount;
      if (dir === 'up') dy = -amount;
      window.scrollBy(0, dy);
    }
    return { ok: true, direction: dir, scrollY: window.scrollY };
  }

  if (op === 'tables') {
    const tableEls = q('table, [role="table"], [role="grid"]').slice(0, 10);
    const extracted = tableEls.map((tbl) => {
      const caption = txt(tbl.querySelector('caption') || tbl.querySelector('[role="caption"]') || tbl);
      const headerEls = Array.from(tbl.querySelectorAll('th, [role="columnheader"]'));
      const headers = headerEls.map((h) => txt(h));
      const rowEls = Array.from(tbl.querySelectorAll('tr, [role="row"]')).slice(0, 50);
      const rows = rowEls
        .map((r) => {
          const cells = Array.from(r.querySelectorAll('td, [role="cell"], [role="gridcell"]'));
          return cells.map((c) => txt(c));
        })
        .filter((r) => r.length > 0);
      return {
        caption: caption.slice(0, 100),
        headers,
        rowCount: rows.length,
        rows: rows.slice(0, 25),
      };
    });
    return { tables: extracted, total: tableEls.length };
  }

  return { error: `Unknown operation: ${op}` };
}

/**
 * find_elements: Inspect interactive DOM elements and return an accessibility snapshot.
 */
export const findElements = tool({
  description:
    'Find and snapshot interactive elements (buttons, links, inputs, dropdowns) on the page with reference IDs for clicking or typing.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID to inspect. Defaults to active tab.'),
    selector: z.string().optional().describe('Optional CSS selector to filter elements.'),
    max: z.number().int().min(1).max(200).optional().describe('Max elements to return (default 100).'),
  }),
  execute: async ({ tabId, selector, max }) => {
    const gate = await pageAccessGate(tabId, 'find interactive elements');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id, url: gate.url };

    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: pageActionInjected,
        args: ['snapshot', { selector, max }],
      });
      return { tabId: gate.tab.id, url: gate.url, ...res?.result, untrusted: true };
    } catch (e) {
      return { error: `Failed to find elements: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});

/**
 * click_element: Click an interactive element by reference ID or CSS selector.
 */
export const clickElement = tool({
  description: 'Click an element on the page using its ref integer (from find_elements) or CSS selector.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID. Defaults to active tab.'),
    ref: z.number().optional().describe('Element reference number from find_elements.'),
    selector: z.string().optional().describe('CSS selector of the element to click.'),
  }),
  execute: async ({ tabId, ref, selector }) => {
    const gate = await pageAccessGate(tabId, 'click element');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id };

    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: pageActionInjected,
        args: ['click', { ref, selector }],
      });
      return { tabId: gate.tab.id, ...res?.result };
    } catch (e) {
      return { error: `Failed to click element: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});

/**
 * type_text: Type text into an input or textarea element.
 */
export const typeText = tool({
  description: 'Type text into an input field or textarea by ref integer or CSS selector.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID. Defaults to active tab.'),
    ref: z.number().optional().describe('Element reference number from find_elements.'),
    selector: z.string().optional().describe('CSS selector of the input element.'),
    text: z.string().describe('Text to type.'),
    clear: z.boolean().optional().describe('Whether to clear existing text before typing (default false).'),
  }),
  execute: async ({ tabId, ref, selector, text, clear }) => {
    const gate = await pageAccessGate(tabId, 'type text');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id };

    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: pageActionInjected,
        args: ['type', { ref, selector, text, clear }],
      });
      return { tabId: gate.tab.id, ...res?.result };
    } catch (e) {
      return { error: `Failed to type text: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});

/**
 * select_option: Select an option in a <select> dropdown.
 */
export const selectOption = tool({
  description: 'Select an option in a dropdown by option value or text.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID. Defaults to active tab.'),
    ref: z.number().optional().describe('Element reference number from find_elements.'),
    selector: z.string().optional().describe('CSS selector of the select element.'),
    value: z.string().describe('Option value or visible text to select.'),
  }),
  execute: async ({ tabId, ref, selector, value }) => {
    const gate = await pageAccessGate(tabId, 'select option');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id };

    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: pageActionInjected,
        args: ['select', { ref, selector, value }],
      });
      return { tabId: gate.tab.id, ...res?.result };
    } catch (e) {
      return { error: `Failed to select option: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});

/**
 * scroll_page: Scroll page or scroll a specific element into view.
 */
export const scrollPage = tool({
  description: 'Scroll the page up, down, to top/bottom, or scroll an element into view.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID. Defaults to active tab.'),
    direction: z.enum(['down', 'up', 'top', 'bottom']).optional().describe("Scroll direction: 'down' (default), 'up', 'top', 'bottom'."),
    amount: z.number().int().positive().optional().describe('Pixels to scroll (default 500).'),
    ref: z.number().optional().describe('Element reference number to scroll into view.'),
    selector: z.string().optional().describe('CSS selector of element to scroll into view.'),
  }),
  execute: async ({ tabId, direction, amount, ref, selector }) => {
    const gate = await pageAccessGate(tabId, 'scroll page');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id };

    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: pageActionInjected,
        args: ['scroll', { direction, amount, ref, selector }],
      });
      return { tabId: gate.tab.id, ...res?.result };
    } catch (e) {
      return { error: `Failed to scroll: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});

/**
 * wait_for: Wait for an element or text to appear on the page.
 */
export const waitForPage = tool({
  description: 'Wait for a CSS selector or specific text string to appear in the DOM (up to timeoutMs).',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID. Defaults to active tab.'),
    selector: z.string().optional().describe('CSS selector to wait for.'),
    text: z.string().optional().describe('Text string to wait for.'),
    timeoutMs: z.number().int().min(100).max(10_000).optional().describe('Timeout in ms (default 3000, max 10000).'),
  }),
  execute: async ({ tabId, selector, text, timeoutMs }) => {
    const gate = await pageAccessGate(tabId, 'wait for page element/text');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id };

    const limit = timeoutMs ?? 3000;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: async (sel?: string, txtSearch?: string, waitMs = 3000) => {
          const deadline = Date.now() + waitMs;
          while (Date.now() < deadline) {
            if (sel && document.querySelector(sel)) return { found: true, selector: sel };
            if (txtSearch && (document.body?.innerText || '').includes(txtSearch)) return { found: true, text: txtSearch };
            await new Promise((r) => setTimeout(r, 150));
          }
          return { found: false, timeout: waitMs };
        },
        args: [selector, text, limit],
      });
      return { tabId: gate.tab.id, ...res?.result };
    } catch (e) {
      return { error: `Failed to wait for page: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});

/**
 * extract_tables: Extract tabular data from the page as structured objects.
 */
export const extractTables = tool({
  description: 'Extract structured tabular data (tables, grids) from the page.',
  inputSchema: z.object({
    tabId: z.number().optional().describe('Tab ID. Defaults to active tab.'),
  }),
  execute: async ({ tabId }) => {
    const gate = await pageAccessGate(tabId, 'extract tables');
    if (!gate.ok) return { error: gate.error, tabId: gate.tab?.id };

    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: gate.tab.id! },
        world: 'ISOLATED',
        func: pageActionInjected,
        args: ['tables', {}],
      });
      return { tabId: gate.tab.id, url: gate.url, ...res?.result, untrusted: true };
    } catch (e) {
      return { error: `Failed to extract tables: ${(e as Error).message}`, tabId: gate.tab.id };
    }
  },
});
