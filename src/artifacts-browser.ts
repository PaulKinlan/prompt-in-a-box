/**
 * Artifacts browser UI. Reads the artifact index from chrome.storage
 * directly (it's a plain key we control) and loads individual contents
 * on demand via the background SW so we reuse the OPFS module already
 * bundled there.
 *
 * All rendering is local: no frameworks, no markdown library. The
 * markdown renderer is a tiny line-based pass — good enough for the
 * headers, lists, code blocks, and links that agents produce in
 * practice. If we ever need something richer we can drop in a real
 * library later.
 */

import type { ArtifactIndexEntry, ArtifactKind, Artifact } from './artifacts';

const INDEX_KEY = '__pib_artifact_index';

// ─── State ──────────────────────────────────────────────────────────

interface Filters {
  kind: string;
  tag: string;
  search: string;
}

let index: ArtifactIndexEntry[] = [];
let openArtifact: Artifact | null = null;

const filters: Filters = { kind: '', tag: '', search: '' };

// ─── Helpers ────────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el;
}

function toast(msg: string, kind: 'ok' | 'error' = 'ok'): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', kind === 'error');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}

function formatKB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kindBadgeClass(kind: ArtifactKind): string {
  if (kind.startsWith('image-')) return 'kind-image';
  if (kind === 'html') return 'kind-html';
  if (kind === 'json') return 'kind-json';
  return '';
}

// ─── Data loading ───────────────────────────────────────────────────

async function loadIndex(): Promise<void> {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  index = (stored[INDEX_KEY] as ArtifactIndexEntry[] | undefined) ?? [];
  index.sort((a, b) => b.createdAt - a.createdAt);
}

async function loadArtifact(artifactId: string): Promise<Artifact | null> {
  const reply = await chrome.runtime.sendMessage({ type: 'get-artifact', artifactId });
  if (!reply || reply.error) return null;
  return reply as Artifact;
}

async function deleteArtifact(artifactId: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'delete-artifact', artifactId });
}

async function clearAllArtifacts(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'clear-artifacts' });
}

// ─── Rendering ──────────────────────────────────────────────────────

function applyFilters(entries: ArtifactIndexEntry[]): ArtifactIndexEntry[] {
  const s = filters.search.toLowerCase();
  return entries.filter((e) => {
    if (filters.kind && e.kind !== filters.kind) return false;
    if (filters.tag && !(e.tags ?? []).includes(filters.tag)) return false;
    if (s) {
      const hay = `${e.title} ${e.preview ?? ''} ${e.sourceUrl ?? ''}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}

function renderStats(): void {
  const now = Date.now();
  const today = isoDate(now);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const byKind = new Set<string>();
  let totalBytes = 0;
  let todayCount = 0;
  let weekCount = 0;
  for (const a of index) {
    byKind.add(a.kind);
    totalBytes += a.size;
    if (isoDate(a.createdAt) === today) todayCount++;
    if (a.createdAt >= weekAgo) weekCount++;
  }
  $('stat-total').textContent = index.length.toString();
  $('stat-today').textContent = todayCount.toString();
  $('stat-week').textContent = weekCount.toString();
  $('stat-kinds').textContent = byKind.size.toString();
  $('stat-size').textContent = formatKB(totalBytes);
}

function renderTagFilter(): void {
  const select = $('filter-tag') as HTMLSelectElement;
  const existing = select.value;
  const tags = new Set<string>();
  for (const a of index) for (const t of a.tags ?? []) tags.add(t);
  const sorted = Array.from(tags).sort();
  select.innerHTML = `<option value="">All</option>${sorted
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
    .join('')}`;
  if (existing && sorted.includes(existing)) select.value = existing;
}

function renderList(): void {
  const filtered = applyFilters(index);
  const listEl = $('list');

  if (filtered.length === 0) {
    listEl.innerHTML = `<div class="empty">No artifacts match the current filters.</div>`;
    return;
  }

  // Group by ISO date.
  const groups = new Map<string, ArtifactIndexEntry[]>();
  for (const a of filtered) {
    const d = isoDate(a.createdAt);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d)!.push(a);
  }

  const dates = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
  listEl.innerHTML = dates
    .map((d) => {
      const items = groups.get(d)!;
      return `<div class="date-group"><h3>${d} (${items.length})</h3>${items
        .map(
          (a) => `
            <div class="artifact" data-id="${a.artifactId}">
              <span class="kind-badge ${kindBadgeClass(a.kind)}">${a.kind}</span>
              <div>
                <div class="title">${escapeHtml(a.title)}</div>
                ${a.preview ? `<div class="preview">${escapeHtml(a.preview)}</div>` : ''}
              </div>
              <div class="tags">${(a.tags ?? [])
                .map((t) => `<span>${escapeHtml(t)}</span>`)
                .join('')}</div>
              <div class="time">${formatTime(a.createdAt)}</div>
            </div>`,
        )
        .join('')}</div>`;
    })
    .join('');

  listEl.querySelectorAll<HTMLElement>('.artifact').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id!;
      void openViewer(id);
    });
  });
}

function render(): void {
  renderStats();
  renderTagFilter();
  renderList();
}

// ─── Minimal markdown renderer ──────────────────────────────────────

function renderMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCodeBlock = false;
  let inList: 'ul' | 'ol' | null = null;

  const flushList = () => {
    if (inList) {
      out.push(`</${inList}>`);
      inList = null;
    }
  };

  const inline = (s: string): string => {
    let r = escapeHtml(s);
    // Inline code.
    r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold.
    r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic (loose).
    r = r.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    // Links.
    r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
    return r;
  };

  for (const raw of lines) {
    if (raw.startsWith('```')) {
      flushList();
      if (inCodeBlock) {
        out.push('</code></pre>');
        inCodeBlock = false;
      } else {
        out.push('<pre><code>');
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(`${escapeHtml(raw)}\n`);
      continue;
    }

    if (/^\s*$/.test(raw)) {
      flushList();
      continue;
    }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushList();
      const n = h[1].length;
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
      continue;
    }

    const ul = raw.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (inList !== 'ul') {
        flushList();
        out.push('<ul>');
        inList = 'ul';
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = raw.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (inList !== 'ol') {
        flushList();
        out.push('<ol>');
        inList = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    flushList();
    out.push(`<p>${inline(raw)}</p>`);
  }
  flushList();
  if (inCodeBlock) out.push('</code></pre>');
  return out.join('');
}

// ─── Viewer ─────────────────────────────────────────────────────────

async function openViewer(artifactId: string): Promise<void> {
  const a = await loadArtifact(artifactId);
  if (!a) {
    toast('Artifact not found — it may have been deleted.', 'error');
    return;
  }
  openArtifact = a;
  $('v-title').textContent = a.title;
  const sourceLink = a.sourceUrl
    ? ` · <a href="${escapeHtml(a.sourceUrl)}" target="_blank" rel="noreferrer noopener">source</a>`
    : '';
  $('v-meta').innerHTML =
    `${new Date(a.createdAt).toLocaleString()} · ${a.kind} · ${formatKB(a.size)}${sourceLink}`;

  const body = $('v-body');
  body.className = 'viewer-body';
  if (a.kind === 'image-png' || a.kind === 'image-jpeg') {
    const mime = a.kind === 'image-png' ? 'image/png' : 'image/jpeg';
    body.innerHTML = `<img src="data:${mime};base64,${a.content}" alt="${escapeHtml(a.title)}" />`;
  } else if (a.kind === 'markdown') {
    body.classList.add('markdown');
    body.innerHTML = renderMarkdown(a.content);
  } else if (a.kind === 'json') {
    try {
      body.innerHTML = `<pre>${escapeHtml(JSON.stringify(JSON.parse(a.content), null, 2))}</pre>`;
    } catch {
      body.innerHTML = `<pre>${escapeHtml(a.content)}</pre>`;
    }
  } else if (a.kind === 'html') {
    // Render HTML as text — we don't want arbitrary page scripts or
    // styles to run in the browser context. If the user wants to see
    // it rendered, they can download it and open locally.
    body.innerHTML = `<pre>${escapeHtml(a.content)}</pre>`;
  } else {
    body.innerHTML = `<pre>${escapeHtml(a.content)}</pre>`;
  }

  $('viewer').hidden = false;
}

function closeViewer(): void {
  $('viewer').hidden = true;
  openArtifact = null;
}

function downloadOpenArtifact(): void {
  if (!openArtifact) return;
  const a = openArtifact;
  let blob: Blob;
  let filename: string;
  if (a.kind === 'image-png' || a.kind === 'image-jpeg') {
    const mime = a.kind === 'image-png' ? 'image/png' : 'image/jpeg';
    const bin = atob(a.content);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: mime });
    filename = `${slug(a.title)}.${a.kind === 'image-png' ? 'png' : 'jpg'}`;
  } else {
    const mime =
      a.kind === 'markdown' ? 'text/markdown'
      : a.kind === 'html' ? 'text/html'
      : a.kind === 'json' ? 'application/json'
      : 'text/plain';
    blob = new Blob([a.content], { type: mime });
    filename = `${slug(a.title)}.${a.kind === 'markdown' ? 'md' : a.kind === 'html' ? 'html' : a.kind === 'json' ? 'json' : 'txt'}`;
  }
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = filename;
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
  URL.revokeObjectURL(url);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artifact';
}

// ─── Wiring ─────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  await loadIndex();
  render();
}

function wireFilters(): void {
  const kind = $('filter-kind') as HTMLSelectElement;
  const tag = $('filter-tag') as HTMLSelectElement;
  const search = $('filter-search') as HTMLInputElement;
  kind.addEventListener('change', () => {
    filters.kind = kind.value;
    renderList();
  });
  tag.addEventListener('change', () => {
    filters.tag = tag.value;
    renderList();
  });
  search.addEventListener('input', () => {
    filters.search = search.value;
    renderList();
  });
}

function wireButtons(): void {
  $('refresh').addEventListener('click', () => {
    void refresh();
  });
  $('clearAll').addEventListener('click', async () => {
    if (!confirm('Delete every artifact? This removes files from OPFS and the index.')) return;
    await clearAllArtifacts();
    await refresh();
    toast('Cleared all artifacts.');
  });
  $('v-close').addEventListener('click', closeViewer);
  $('v-delete').addEventListener('click', async () => {
    if (!openArtifact) return;
    if (!confirm(`Delete "${openArtifact.title}"?`)) return;
    await deleteArtifact(openArtifact.artifactId);
    closeViewer();
    await refresh();
    toast('Deleted.');
  });
  $('v-download').addEventListener('click', downloadOpenArtifact);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('viewer').hidden) closeViewer();
  });
  $('viewer').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).id === 'viewer') closeViewer();
  });
}

wireFilters();
wireButtons();
void refresh();
