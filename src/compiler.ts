/**
 * Pure TypeScript In-Browser Chrome Extension Compiler & Packager
 *
 * Compiles extension projects directly in the browser:
 * - Fetches runtime bundles from the Master Extension
 * - Merges and verifies MV3 manifest.json rules (permissions, CSP, sandbox)
 * - Computes deterministic SHA-256 content hashes and auto-bumps version
 * - Generates crisp PNG icon sets (16, 32, 48, 128 px) on HTML5 Canvas
 * - Produces standalone ZIP archives via zero-dependency PKZIP writer (deflate-raw)
 * - Directly writes unpacked extension folders to disk via showDirectoryPicker()
 */

export type IconArtStyle =
  | 'flat-vector'
  | '3d-clay'
  | 'glassmorphic'
  | 'isometric'
  | 'minimal-line'
  | 'pixel-art'
  | 'metallic';

export const MASTER_ICON_SIZE = 512;

export interface IconBrief {
  mode?: 'ai' | 'vector' | 'upload';
  model?: string;
  artStyle?: IconArtStyle;
  symbol?: string;
  colors?: string[];
  styleDescription?: string;
  clipSquircle?: boolean;
  customImageDataUrl?: string;
  aiImageDataUrl?: string;
}

export interface ExtensionProjectData {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string;
  prompt: string;
  alarmMinutes: number;
  permissions: string[];
  optional_permissions: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  agentSettings?: any[];
  iconBrief?: IconBrief;
  uiConfig?: Record<string, boolean>;
  themeConfig?: Record<string, unknown>;
  includeStudio?: boolean;
  lockProvider?: boolean;
  lockModel?: boolean;
  defaultProvider?: string;
  defaultModel?: string;
  lastContentHash?: string;
}

export type CompileSpec = ExtensionProjectData;

// ─── CRC32 & PKZIP Implementation ──────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

export function crc32(buf: Uint8Array): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
  modDate?: Date;
}

async function compressDeflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new (window as any).CompressionStream('deflate-raw'));
      const compressed = await new Response(stream).arrayBuffer();
      return new Uint8Array(compressed);
    } catch {
      // fallback to uncompressed
    }
  }
  return data;
}

/**
 * Builds a valid PKZIP file from a map or array of files in pure TypeScript.
 */
export async function buildZipArchive(entries: ZipEntry[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const filenameBytes = new TextEncoder().encode(entry.name);
    const uncompressedData = entry.data;
    const uncompressedSize = uncompressedData.length;
    const crc = crc32(uncompressedData);

    const compressedData = await compressDeflate(uncompressedData);
    const isDeflated = compressedData.length < uncompressedSize;
    const finalData = isDeflated ? compressedData : uncompressedData;
    const compressionMethod = isDeflated ? 8 : 0;
    const compressedSize = finalData.length;

    const date = entry.modDate || new Date();
    const dosTime =
      ((date.getHours() & 0x1f) << 11) |
      ((date.getMinutes() & 0x3f) << 5) |
      ((Math.floor(date.getSeconds() / 2) & 0x1f));
    const dosDate =
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f);

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const lView = new DataView(localHeader.buffer);
    lView.setUint32(0, 0x04034b50, true); // signature
    lView.setUint16(4, 20, true); // version needed (2.0)
    lView.setUint16(6, 0x0800, true); // general purpose bit flag (UTF-8)
    lView.setUint16(8, compressionMethod, true);
    lView.setUint16(10, dosTime, true);
    lView.setUint16(12, dosDate, true);
    lView.setUint32(14, crc, true);
    lView.setUint32(18, compressedSize, true);
    lView.setUint32(22, uncompressedSize, true);
    lView.setUint16(26, filenameBytes.length, true);
    lView.setUint16(28, 0, true); // extra field length
    localHeader.set(filenameBytes, 30);

    parts.push(localHeader);
    parts.push(finalData);

    // Central directory header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + filenameBytes.length);
    const cView = new DataView(centralHeader.buffer);
    cView.setUint32(0, 0x02014b50, true); // signature
    cView.setUint16(4, 20, true); // version made by
    cView.setUint16(6, 20, true); // version needed
    cView.setUint16(8, 0x0800, true); // flags (UTF-8)
    cView.setUint16(10, compressionMethod, true);
    cView.setUint16(12, dosTime, true);
    cView.setUint16(14, dosDate, true);
    cView.setUint32(16, crc, true);
    cView.setUint32(20, compressedSize, true);
    cView.setUint32(24, uncompressedSize, true);
    cView.setUint16(28, filenameBytes.length, true);
    cView.setUint16(30, 0, true); // extra len
    cView.setUint16(32, 0, true); // comment len
    cView.setUint16(34, 0, true); // disk number
    cView.setUint16(36, 0, true); // internal attrs
    cView.setUint32(38, 0, true); // external attrs
    cView.setUint32(42, offset, true); // relative offset of local header
    centralHeader.set(filenameBytes, 46);

    centralRecords.push(centralHeader);
    offset += localHeader.length + finalData.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const c of centralRecords) {
    parts.push(c);
    centralDirSize += c.length;
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eView = new DataView(eocd.buffer);
  eView.setUint32(0, 0x06054b50, true); // signature
  eView.setUint16(4, 0, true); // disk number
  eView.setUint16(6, 0, true); // disk with central dir
  eView.setUint16(8, entries.length, true); // entries on disk
  eView.setUint16(10, entries.length, true); // total entries
  eView.setUint32(12, centralDirSize, true); // size of central dir
  eView.setUint32(16, centralDirOffset, true); // offset of central dir
  eView.setUint16(20, 0, true); // comment len

  parts.push(eocd);

  return new Blob(parts as any, { type: 'application/zip' });
}

// ─── Canvas Icon Generation ────────────────────────────────────────────

const GLYPH_PATHS: Record<string, string> = {
  spark: 'M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z',
  tabs: 'M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zm0 4h16V6H4v2zm0 10h16v-8H4v8z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z',
  folder: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  bookmark: 'M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z',
  wand: 'M7.5 5.6L5 7l1.4-2.5L5 2l2.5 1.4L10 2 8.6 4.5 10 7 7.5 5.6zm12 9.8L17 14l1.4 2.5L17 19l2.5-1.4L22 19l-1.4-2.5L22 14l-2.5 1.4zM2.81 19.78l1.41 1.41L18.4 6.99l-1.41-1.41L2.81 19.78z',
  terminal: 'M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-12-3l-1.41-1.41L9.17 11 6.59 8.41 8 7l4 4-4 4zm4 0h6v2h-6v-2z',
};

export function traceSquirclePath(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  size: number
): void {
  const radius = Math.round(size * 0.22);
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
}

/**
 * Renders the master 512×512 icon canvas.
 * Handles AI/custom image uploads (with optional squircle clipping)
 * or renders modern vector squircle background + glyph centered at 512×512.
 */
export async function renderMasterIconCanvas(
  brief?: IconBrief
): Promise<OffscreenCanvas | HTMLCanvasElement> {
  const size = MASTER_ICON_SIZE;
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof document !== 'undefined'
      ? document.createElement('canvas')
      : new OffscreenCanvas(size, size);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const imageUrl = brief?.aiImageDataUrl || brief?.customImageDataUrl;
  if (imageUrl && brief?.mode !== 'vector') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    await new Promise<void>((resolve, reject) => {
      if (img.complete) return resolve();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load icon image data'));
    });

    if (brief?.clipSquircle !== false) {
      ctx.save();
      traceSquirclePath(ctx, size);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = Math.max(1, size * 0.02);
      traceSquirclePath(ctx, size);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.drawImage(img, 0, 0, size, size);
    }
  } else {
    // Render modern gradient squircle scaled to 512x512 master
    const colors = brief?.colors && brief.colors.length >= 2 ? brief.colors : ['#8b5cf6', '#d946ef'];

    ctx.save();
    traceSquirclePath(ctx, size);
    ctx.clip();

    // Gradient background
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Subtle gloss highlight
    const highlight = ctx.createLinearGradient(0, 0, 0, size * 0.5);
    highlight.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
    highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, size, size * 0.5);

    // Draw Glyph centered
    const symbol = brief?.symbol || 'spark';
    const pathD = GLYPH_PATHS[symbol] || GLYPH_PATHS.spark;

    ctx.save();
    const glyphScale = (size * 0.55) / 24;
    const offset = (size - 24 * glyphScale) / 2;
    ctx.translate(offset, offset);
    ctx.scale(glyphScale, glyphScale);

    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = Math.max(1, size * 0.05);
    ctx.shadowOffsetY = Math.max(1, size * 0.02);

    ctx.fillStyle = '#ffffff';
    const p2d = new Path2D(pathD);
    ctx.fill(p2d);
    ctx.restore();

    ctx.restore();
  }

  return canvas;
}

/**
 * Multi-step progressive downsampler that steps down by halves
 * (512 -> 256 -> 128 -> 64 -> targetSize) with imageSmoothingQuality = 'high'
 * at each step to prevent aliasing and blurriness on small icon sizes (48, 32, 16px).
 */
export function downsampleCanvas(
  source: OffscreenCanvas | HTMLCanvasElement,
  targetSize: number
): OffscreenCanvas | HTMLCanvasElement {
  if (source.width === targetSize && source.height === targetSize) {
    return source;
  }

  let currentCanvas: OffscreenCanvas | HTMLCanvasElement = source;
  let currentWidth = source.width;
  let currentHeight = source.height;

  // Step down by halves while half of current size is strictly greater than targetSize
  while (Math.floor(currentWidth / 2) > targetSize) {
    const nextWidth = Math.floor(currentWidth / 2);
    const nextHeight = Math.floor(currentHeight / 2);

    const stepCanvas: OffscreenCanvas | HTMLCanvasElement =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : new OffscreenCanvas(nextWidth, nextHeight);
    stepCanvas.width = nextWidth;
    stepCanvas.height = nextHeight;

    const ctx = stepCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Canvas 2D context unavailable during downsampling');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(currentCanvas, 0, 0, currentWidth, currentHeight, 0, 0, nextWidth, nextHeight);

    currentCanvas = stepCanvas;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  // Final step down to exact targetSize
  if (currentWidth !== targetSize || currentHeight !== targetSize) {
    const finalCanvas: OffscreenCanvas | HTMLCanvasElement =
      typeof document !== 'undefined'
        ? document.createElement('canvas')
        : new OffscreenCanvas(targetSize, targetSize);
    finalCanvas.width = targetSize;
    finalCanvas.height = targetSize;

    const ctx = finalCanvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('Canvas 2D context unavailable during downsampling');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(currentCanvas, 0, 0, currentWidth, currentHeight, 0, 0, targetSize, targetSize);

    currentCanvas = finalCanvas;
  }

  return currentCanvas;
}

export async function canvasToBlob(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Blob> {
  if ('convertToBlob' in canvas && typeof (canvas as any).convertToBlob === 'function') {
    return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  }
  if ('toBlob' in canvas && typeof (canvas as any).toBlob === 'function') {
    return new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create PNG blob from canvas'));
      }, 'image/png');
    });
  }
  throw new Error('Unsupported canvas type for toBlob');
}

export async function renderIconPngBlob(size: number, brief?: IconBrief): Promise<Blob> {
  const master = await renderMasterIconCanvas(brief);
  const canvas = size === MASTER_ICON_SIZE ? master : downsampleCanvas(master, size);
  return canvasToBlob(canvas);
}

// ─── Content Hashing & Version Bump ────────────────────────────────────

export async function computeContentHash(content: string): Promise<string> {
  const enc = new TextEncoder().encode(content);
  const hashBuf = await crypto.subtle.digest('SHA-256', enc);
  const hashArr = Array.from(new Uint8Array(hashBuf));
  return hashArr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function bumpPatchVersion(version: string): string {
  const parts = version.split('.').map((p) => parseInt(p, 10));
  if (parts.length >= 3 && !isNaN(parts[2])) {
    parts[2] += 1;
    return parts.join('.');
  }
  return `${version}.1`;
}

// ─── Extension Compilation ─────────────────────────────────────────────

export interface CompiledExtensionResult {
  zipBlob: Blob;
  version: string;
  contentHash: string;
  files: Map<string, Uint8Array>;
  manifest: Record<string, unknown>;
  config: Record<string, unknown>;
}

export async function compileExtensionProject(
  project: ExtensionProjectData,
  options: { forceBump?: boolean } = {}
): Promise<CompiledExtensionResult> {
  const files = new Map<string, Uint8Array>();

  // 1. Fetch base templates and runtime dist files from the running Master Extension
  const DIST_FILES = [
    'dist/background.js',
    'dist/popup.js',
    'dist/popup.html',
    'dist/sidepanel.js',
    'dist/sidepanel.html',
    'dist/ui-renderer.css',
    'dist/options.js',
    'dist/options.html',
    'dist/offscreen.js',
    'dist/offscreen.html',
    'dist/artifacts.html',
    'dist/artifacts-browser.js',
    'dist/sandbox.html',
    'dist/sandbox.js',
  ];

  if (project.includeStudio) {
    DIST_FILES.push('dist/studio.html', 'dist/studio.js');
  }

  for (const f of DIST_FILES) {
    try {
      const url = chrome.runtime.getURL(f);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      files.set(f, new Uint8Array(buf));
    } catch (err) {
      console.warn(`[compiler] Failed to bundle ${f}:`, err);
    }
  }

  // 2. Build config.json
  const baseConfig: Record<string, unknown> = {
    version: project.version || '1.0.0',
    prompt: 'prompt.md',
    pack_hash: '',
    providers: {
      allowed: ['google', 'anthropic', 'openai'],
      default: project.defaultProvider || 'google',
      lockProvider: Boolean(project.lockProvider),
    },
    models: {
      default: project.defaultModel || 'gemini-3.8-flash',
      lockModel: Boolean(project.lockModel),
      allowCustomModelInput: true,
      allowed: {
        google: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.7-flash', 'gemini-3.6-flash'],
      },
    },
    schedule: {
      defaultAlarmMinutes: project.alarmMinutes ?? 30,
      lockSchedule: false,
    },
    ui: {
      showStudio: Boolean(project.includeStudio),
      showAuditUI: true,
      showCosts: true,
      showTokenUsage: true,
      showToolCallDetails: true,
      showHistory: true,
      showVersionBadge: true,
      showPolicyBadge: true,
      showPopupHeader: true,
      showViewSwitcher: true,
      showStatusCard: true,
      showKeyStatusBadge: true,
      showScheduleSummary: true,
      showRecentArtifacts: true,
      showPopupFooter: true,
      allowSettingsAccess: true,
      allowSidePanel: true,
      showSidePanelHeader: true,
      showSidePanelStatusBar: true,
      showActivityDrawer: true,
      showRecentRuns: true,
      showOnboardingBanner: true,
      showProviderSelector: !project.lockProvider,
      showApiKeyInput: true,
      showModelSelector: !project.lockModel,
      showProviderTools: true,
      showPermissionsManager: true,
      showSchedule: true,
      allowTestConnection: true,
      allowManualRun: true,
      showAuditLog: true,
      showAuditStats: true,
      showAuditFilters: true,
      allowExportAudit: true,
      allowClearAudit: true,
      allowArtifacts: true,
      showArtifactStats: true,
      showArtifactFilters: true,
      allowCopyArtifact: true,
      allowDownloadArtifact: true,
      allowDeleteArtifacts: true,
    },
  };

  if (project.themeConfig) {
    baseConfig.themeConfig = project.themeConfig;
  }

  if (project.uiConfig) {
    Object.assign(baseConfig.ui as Record<string, unknown>, project.uiConfig);
  }
  (baseConfig.ui as Record<string, unknown>).showStudio = Boolean(project.includeStudio);

  if (project.agentSettings && project.agentSettings.length > 0) {
    baseConfig.agentSettings = {
      storageKey: `${project.slug.replace(/-/g, '_')}_settings`,
      title: `${project.name} Preferences`,
      fields: project.agentSettings,
    };
  }

  // 3. Compute Content Hash and Auto-Bump Version
  const rawHashPayload = JSON.stringify({
    name: project.name,
    prompt: project.prompt,
    config: baseConfig,
    permissions: project.permissions,
    optional_permissions: project.optional_permissions,
    host_permissions: project.host_permissions,
    optional_host_permissions: project.optional_host_permissions,
    alarmMinutes: project.alarmMinutes,
    iconBrief: project.iconBrief,
  });

  const contentHash = await computeContentHash(rawHashPayload);
  let effectiveVersion = project.version || '1.0.0';

  if (options.forceBump || (project.lastContentHash && project.lastContentHash !== contentHash)) {
    effectiveVersion = bumpPatchVersion(effectiveVersion);
  }
  baseConfig.version = effectiveVersion;
  baseConfig.pack_hash = contentHash;

  // 4. Build manifest.json (pure standard MV3 manifest without non-standard prompt_in_a_box)
  const corePerms = new Set(['storage', 'alarms', 'offscreen']);
  for (const p of project.permissions || []) corePerms.add(p);

  const optPerms = new Set<string>();
  for (const p of project.optional_permissions || []) {
    if (!corePerms.has(p)) optPerms.add(p);
  }

  const manifestData: Record<string, unknown> = {
    manifest_version: 3,
    name: project.name,
    version: effectiveVersion,
    description: project.description || `Standalone ${project.name} extension powered by Prompt in a Box.`,
    icons: {
      '16': 'icon-16.png',
      '32': 'icon-32.png',
      '48': 'icon-48.png',
      '128': 'icon-128.png',
      '512': 'icon-512.png',
    },
    action: {
      default_title: project.name,
      default_popup: 'dist/popup.html',
      default_icon: {
        '16': 'icon-16.png',
        '32': 'icon-32.png',
        '48': 'icon-48.png',
        '128': 'icon-128.png',
        '512': 'icon-512.png',
      },
    },
    background: {
      service_worker: 'dist/background.js',
      type: 'module',
    },
    options_ui: {
      page: 'dist/options.html',
      open_in_tab: true,
    },
    side_panel: {
      default_path: 'dist/sidepanel.html',
    },
    sandbox: {
      pages: ['dist/sandbox.html'],
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
      sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval' blob:; connect-src 'none';",
    },
    permissions: Array.from(corePerms),
    optional_permissions: Array.from(optPerms),
    web_accessible_resources: [
      {
        resources: [
          'config.json',
          'prompt.md',
          'icon.png',
          'icon-16.png',
          'icon-32.png',
          'icon-48.png',
          'icon-128.png',
          'icon-512.png',
        ],
        matches: ['<all_urls>'],
      },
    ],
  };

  const baseHostPerms = [
    'https://generativelanguage.googleapis.com/*',
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
  ];
  const mergedHostPerms = new Set(baseHostPerms);
  for (const hp of project.host_permissions || ['<all_urls>']) {
    mergedHostPerms.add(hp);
  }
  manifestData.host_permissions = Array.from(mergedHostPerms);

  if (project.optional_host_permissions && project.optional_host_permissions.length > 0) {
    const optHostSet = new Set(project.optional_host_permissions);
    for (const reqHp of mergedHostPerms) {
      optHostSet.delete(reqHp);
    }
    if (optHostSet.size > 0) {
      manifestData.optional_host_permissions = Array.from(optHostSet);
    }
  }

  // 5. Build prompt.md
  files.set('prompt.md', new TextEncoder().encode(project.prompt));
  files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifestData, null, 2) + '\n'));
  files.set('config.json', new TextEncoder().encode(JSON.stringify(baseConfig, null, 2) + '\n'));

  // 6. Generate crisp icons (512 master progressively downsampled)
  const iconSizes = [512, 128, 48, 32, 16];
  for (const s of iconSizes) {
    const blob = await renderIconPngBlob(s, project.iconBrief);
    const buf = new Uint8Array(await blob.arrayBuffer());
    files.set(`icon-${s}.png`, buf);
    if (s === 512) {
      files.set('icon.png', buf);
    }
  }

  // 7. Generate README.md
  let readme = `# ${project.name} (v${effectiveVersion})\n\n`;
  readme += `${project.description}\n\n`;
  readme += `## Installation in Google Chrome (Developer Mode)\n\n`;
  readme += `1. Unzip this package (or use the exported unpacked directory).\n`;
  readme += `2. Navigate to \`chrome://extensions\` in Google Chrome.\n`;
  readme += `3. Toggle on **Developer mode** at the top-right corner.\n`;
  readme += `4. Click **Load unpacked** and select this directory.\n`;
  readme += `5. Pin the extension to your toolbar, open **Settings**, and paste your API key.\n\n`;
  readme += `## Capabilities & Security\n`;
  readme += `- **Required Permissions**: ${Array.from(corePerms).join(', ') || 'none'}\n`;
  readme += `- **Optional Permissions**: ${Array.from(optPerms).join(', ') || 'none'}\n`;
  readme += `- **Alarm Interval**: Every ${project.alarmMinutes} minutes\n\n`;
  readme += `Built with [Prompt in a Box](https://github.com/paulkinlan/prompt-in-a-box).\n`;
  files.set('README.md', new TextEncoder().encode(readme));

  // 8. Package to ZIP Archive
  const zipEntries: ZipEntry[] = [];
  for (const [name, data] of files.entries()) {
    zipEntries.push({ name, data });
  }

  const zipBlob = await buildZipArchive(zipEntries);

  return {
    zipBlob,
    version: effectiveVersion,
    contentHash,
    files,
    manifest: manifestData,
    config: baseConfig,
  };
}

export const compileExtensionZip = compileExtensionProject;

// ─── Export Utilities ──────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function exportUnpackedToDirectory(
  files: Map<string, Uint8Array>,
  slug: string
): Promise<{ ok: boolean; folderName: string }> {
  if (typeof (window as any).showDirectoryPicker !== 'function') {
    throw new Error('File System Access API (showDirectoryPicker) is not supported in this browser.');
  }

  const rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  const subDir = await rootHandle.getDirectoryHandle(slug, { create: true });

  for (const [pathStr, data] of files.entries()) {
    const parts = pathStr.split('/');
    let currentDir = subDir;
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileName = parts[parts.length - 1];
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  return { ok: true, folderName: slug };
}
