/**
 * Icon generation library for prompt-in-a-box.
 *
 * Two ways to make an extension icon:
 *
 *   1. AI generation (preferred) — calls Gemini (Imagen / Gemini image) or
 *      OpenAI (gpt-image-1) to render a bespoke icon that reflects what the
 *      extension actually does. Used automatically when an API key is present.
 *
 *   2. Procedural fallback — a clean, modern flat icon built from a per-extension
 *      gradient plus a hand-drawn vector glyph chosen to match the extension's
 *      intent. Always available, needs no API key, and keeps the repo looking
 *      good even offline.
 *
 * Either way the result is rasterised with sharp into the standard Chrome icon
 * sizes (16/32/48/128) plus a 128px `icon.png` for backward compatibility.
 */
import sharp from 'sharp';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const ICON_SIZES = [16, 32, 48, 128];
const MASTER_SIZE = 1024; // size we generate/raster at before downscaling

// ─── Provider detection ─────────────────────────────────────────────

/**
 * Decide which image provider to use based on the environment.
 * Returns null when no key is configured (callers fall back to procedural).
 */
export function detectImageProvider(env = process.env) {
  const googleKey =
    env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || env.GOOGLE_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;

  if (env.ICON_PROVIDER === 'none') return null;

  // Honour an explicit choice first.
  if (env.ICON_PROVIDER === 'google' && googleKey) {
    return { kind: 'google', apiKey: googleKey, model: env.ICON_MODEL || 'imagen-4.0-fast-generate-001' };
  }
  if (env.ICON_PROVIDER === 'openai' && openaiKey) {
    return { kind: 'openai', apiKey: openaiKey, model: env.ICON_MODEL || 'gpt-image-1' };
  }

  // Otherwise auto-detect: Gemini first (matches `npm run create`), then OpenAI.
  if (googleKey) {
    return { kind: 'google', apiKey: googleKey, model: env.ICON_MODEL || 'imagen-4.0-fast-generate-001' };
  }
  if (openaiKey) {
    return { kind: 'openai', apiKey: openaiKey, model: env.ICON_MODEL || 'gpt-image-1' };
  }
  return null;
}

// ─── AI generation ──────────────────────────────────────────────────

/** Build the text prompt handed to the image model. */
export function buildImagePrompt({ name, description }) {
  const subject = [name, description].filter(Boolean).join(' — ');
  return [
    `App icon for a Chrome browser extension: ${subject}.`,
    'Design a single bold, simple symbol that clearly represents what the extension does.',
    'Modern flat vector style, smooth diagonal gradient background, generous padding,',
    'rounded-square shape, centered composition, high contrast, crisp edges.',
    'No text, no words, no letters, no numbers, no photographic detail.',
    'Clean, friendly, professional — App Store / Material You quality.',
  ].join(' ');
}

/**
 * Generate a square icon image via an AI provider.
 * Returns a PNG-able image Buffer (whatever the model produced) or throws.
 */
export async function generateAiImageBuffer({ name, description, provider }) {
  const { generateImage } = await import('ai');
  const prompt = buildImagePrompt({ name, description });

  let model;
  let extra = {};
  if (provider.kind === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const google = createGoogleGenerativeAI({ apiKey: provider.apiKey });
    model = google.image(provider.model);
    extra = { aspectRatio: '1:1' };
  } else if (provider.kind === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({ apiKey: provider.apiKey });
    model = openai.imageModel(provider.model);
    extra = { size: '1024x1024' };
  } else {
    throw new Error(`Unknown image provider: ${provider.kind}`);
  }

  const { image } = await generateImage({ model, prompt, n: 1, ...extra });
  return Buffer.from(image.uint8Array);
}

// ─── Procedural fallback ────────────────────────────────────────────

/** Deterministic 32-bit hash of a string. */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A pleasant diagonal gradient derived deterministically from the name. */
function gradientFor(seed) {
  const h = hashString(seed);
  const hue = h % 360;
  const hue2 = (hue + 38) % 360;
  const c1 = `hsl(${hue}, 72%, 58%)`;
  const c2 = `hsl(${hue2}, 68%, 46%)`;
  return { c1, c2 };
}

/**
 * Hand-drawn vector glyphs, keyed by intent. Each value is SVG markup drawn in
 * a 128×128 coordinate space. Stroke defaults (white, round) come from the
 * wrapping <g>; filled accents set their own fill/stroke.
 */
const GLYPHS = {
  tabs: `
    <rect x="28" y="38" width="72" height="54" rx="9"/>
    <line x1="28" y1="56" x2="100" y2="56"/>
    <line x1="48" y1="38" x2="48" y2="56"/>
    <line x1="68" y1="38" x2="68" y2="56"/>`,
  bookmark: `<path d="M44 28h40v72L64 84 44 100z"/>`,
  download: `
    <line x1="64" y1="30" x2="64" y2="74"/>
    <polyline points="46,57 64,76 82,57"/>
    <line x1="38" y1="92" x2="90" y2="92"/>`,
  clipboard: `
    <rect x="38" y="36" width="52" height="64" rx="9"/>
    <rect x="53" y="27" width="22" height="16" rx="5"/>
    <line x1="50" y1="58" x2="78" y2="58"/>
    <line x1="50" y1="72" x2="78" y2="72"/>
    <line x1="50" y1="86" x2="68" y2="86"/>`,
  document: `
    <path d="M44 28h28l16 16v56H44z"/>
    <polyline points="72,28 72,44 88,44"/>
    <line x1="54" y1="62" x2="78" y2="62"/>
    <line x1="54" y1="76" x2="78" y2="76"/>`,
  clock: `
    <circle cx="64" cy="64" r="34"/>
    <polyline points="64,42 64,64 82,72"/>`,
  history: `
    <path d="M40 64a24 24 0 1 0 7-17"/>
    <polyline points="34,38 34,52 48,52"/>
    <polyline points="64,52 64,66 78,72"/>`,
  search: `
    <circle cx="56" cy="56" r="24"/>
    <line x1="74" y1="74" x2="96" y2="96"/>`,
  focus: `
    <circle cx="64" cy="64" r="32"/>
    <circle cx="64" cy="64" r="15"/>
    <circle cx="64" cy="64" r="4" fill="#fff" stroke="none"/>`,
  tag: `
    <path d="M36 36h26l30 30-26 26-30-30z"/>
    <circle cx="51" cy="51" r="6" fill="#fff" stroke="none"/>`,
  filter: `<path d="M32 38h64L72 66v22l-16 8V66z"/>`,
  globe: `
    <circle cx="64" cy="64" r="33"/>
    <ellipse cx="64" cy="64" rx="14" ry="33"/>
    <line x1="33" y1="64" x2="95" y2="64"/>
    <line x1="40" y1="46" x2="88" y2="46"/>
    <line x1="40" y1="82" x2="88" y2="82"/>`,
  calendar: `
    <rect x="32" y="38" width="64" height="58" rx="9"/>
    <line x1="32" y1="56" x2="96" y2="56"/>
    <line x1="48" y1="30" x2="48" y2="44"/>
    <line x1="80" y1="30" x2="80" y2="44"/>`,
  smiley: `
    <circle cx="64" cy="64" r="34"/>
    <circle cx="52" cy="56" r="4.5" fill="#fff" stroke="none"/>
    <circle cx="76" cy="56" r="4.5" fill="#fff" stroke="none"/>
    <path d="M49 73c6 9 24 9 30 0"/>`,
  book: `
    <path d="M64 42c-9-7-24-7-30-3v50c6-4 21-4 30 3z"/>
    <path d="M64 42c9-7 24-7 30-3v50c-6-4-21-4-30 3z"/>`,
  camera: `
    <rect x="28" y="48" width="72" height="48" rx="9"/>
    <path d="M48 48l7-10h18l7 10"/>
    <circle cx="64" cy="72" r="14"/>`,
  spark: `
    <path d="M64 30l8 22 22 8-22 8-8 22-8-22-22-8 22-8z" fill="#fff" stroke="none"/>
    <circle cx="40" cy="92" r="4" fill="#fff" stroke="none"/>
    <circle cx="92" cy="38" r="3" fill="#fff" stroke="none"/>`,
};

/**
 * Match a single string against the intent keyword table.
 * Ordered most-specific → most-generic; first keyword hit wins. Returns null
 * when nothing matches so callers can try another source of text.
 */
function matchGlyph(text) {
  const t = text.toLowerCase();
  const has = (...kw) => kw.some((k) => t.includes(k));

  if (has('translate', 'translation', 'language')) return 'globe';
  if (has('screenshot', 'camera', 'capture')) return 'camera';
  if (has('clipboard', 'copy', 'paste')) return 'clipboard';
  if (has('download')) return 'download';
  if (has('calendar', 'meeting', 'agenda')) return 'calendar';
  if (has('sentiment', 'mood', 'emotion')) return 'smiley';
  if (has('reading', 'read time', 'read-time')) return 'book';
  if (has('bookmark', 'favorite', 'favourite', 'pin')) return 'bookmark';
  if (has('history')) return 'history';
  if (has('search', 'omnibox', 'ask', 'explore', 'query')) return 'search';
  if (has('focus', 'distraction', 'concentrate')) return 'focus';
  if (has('topic', 'extract', 'quote', 'note')) return 'tag';
  if (has('summar', 'digest', 'brief', 'report', 'review')) return 'document';
  if (has('sort', 'organi', 'group', 'categor', 'hat')) return 'filter';
  if (has('clean', 'dedupe', 'duplicate', 'dead', 'stale', 'hygiene', 'tidy')) return 'spark';
  if (has('daily', 'weekly', 'nightly', 'time', 'minute', 'hour')) return 'clock';
  if (has('tab', 'window')) return 'tabs';
  return null;
}

/**
 * Pick the glyph that best matches an extension's intent. The name (a clean
 * slug like "dead-bookmark-cleaner") is the strongest signal, so it's matched
 * first; the description is only consulted when the name yields nothing. This
 * avoids generic boilerplate in descriptions (e.g. "Event-driven.",
 * "Schedule-driven.") hijacking the match.
 */
export function pickGlyph(name = '', description = '') {
  return matchGlyph(name) || matchGlyph(description) || 'spark';
}

/** Build the full procedural SVG for an extension icon. */
export function buildProceduralSvg({ name, description }) {
  const glyphKey = pickGlyph(name, description);
  const glyph = GLYPHS[glyphKey];
  const { c1, c2 } = gradientFor(name || description || 'prompt-in-a-box');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="128" height="128" rx="28" fill="url(#bg)"/>
  <g fill="none" stroke="#ffffff" stroke-width="8.5" stroke-linecap="round" stroke-linejoin="round">
    ${glyph}
  </g>
</svg>`;
}

async function proceduralMasterBuffer({ name, description }) {
  const svg = buildProceduralSvg({ name, description });
  return sharp(Buffer.from(svg))
    .resize(MASTER_SIZE, MASTER_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

// ─── Writing the icon set ───────────────────────────────────────────

/**
 * Given a master PNG buffer, write every Chrome icon size into destDir,
 * plus a 128px `icon.png` for backward compatibility.
 */
export async function writeIconSet(masterBuffer, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const written = [];
  for (const size of ICON_SIZES) {
    const out = path.join(destDir, `icon-${size}.png`);
    await sharp(masterBuffer).resize(size, size, { fit: 'cover' }).png().toFile(out);
    written.push(out);
  }
  // Backward-compatible single icon (128px) still referenced by older manifests.
  const legacy = path.join(destDir, 'icon.png');
  await sharp(masterBuffer).resize(128, 128, { fit: 'cover' }).png().toFile(legacy);
  written.push(legacy);
  return written;
}

/**
 * High-level entry point: generate an icon for an extension and write the full
 * icon set into destDir. Tries the AI provider first (when available and not
 * disabled), then falls back to the procedural glyph icon.
 *
 * @returns {Promise<{ source: 'ai'|'procedural', glyph?: string, files: string[] }>}
 */
export async function generateIcons({ name, description, destDir, provider, allowAi = true, log = () => {} }) {
  const chosen = provider ?? (allowAi ? detectImageProvider() : null);

  if (chosen) {
    try {
      log(`  ↳ generating AI icon via ${chosen.kind} (${chosen.model})…`);
      const master = await generateAiImageBuffer({ name, description, provider: chosen });
      const files = await writeIconSet(master, destDir);
      return { source: 'ai', files };
    } catch (err) {
      log(`  ⚠️  AI icon generation failed (${err.message}); using procedural fallback.`);
    }
  }

  const glyph = pickGlyph(name, description);
  log(`  ↳ generating procedural icon (glyph: ${glyph})…`);
  const master = await proceduralMasterBuffer({ name, description });
  const files = await writeIconSet(master, destDir);
  return { source: 'procedural', glyph, files };
}
