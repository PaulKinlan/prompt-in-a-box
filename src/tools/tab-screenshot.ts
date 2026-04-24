import { tool } from 'ai';
import { z } from 'zod';
import { opfs } from '../storage/opfs';

/**
 * Capture the visible area of a tab and save it to OPFS.
 *
 * Returns the OPFS path so the prompt can hand the image to another
 * tool (e.g. email/upload) without having to marshal a multi-MB base64
 * string through the agent loop. The path is stable — the model can
 * read it back later with opfs_read if it needs to.
 *
 * Only the active tab of the given window can be captured. Chrome
 * enforces this to avoid background-tab snooping.
 */
export const tabScreenshot = tool({
  description:
    "Capture the visible area of the active tab in a window and save it as PNG to OPFS under `screenshots/<timestamp>.png`. Returns the OPFS path.",
  inputSchema: z.object({
    windowId: z.number().optional().describe('Target window. Default: the currently-focused window.'),
    quality: z.number().int().min(1).max(100).optional().describe('JPEG quality 1-100. Omit for lossless PNG.'),
  }),
  execute: async ({ windowId, quality }) => {
    const format: 'png' | 'jpeg' = quality === undefined ? 'png' : 'jpeg';
    const options: chrome.tabs.CaptureVisibleTabOptions = { format };
    if (quality !== undefined) options.quality = quality;
    const dataUrl =
      windowId === undefined
        ? await chrome.tabs.captureVisibleTab(options)
        : await chrome.tabs.captureVisibleTab(windowId, options);
    // Strip the "data:image/...;base64," prefix and decode.
    const base64 = dataUrl.split(',')[1] ?? '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = format === 'png' ? 'png' : 'jpg';
    const path = `screenshots/${ts}.${ext}`;

    // OPFS's writeText is text-only; screenshots are binary. Use the
    // underlying handle API directly rather than stringifying bytes.
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('screenshots', { create: true });
    const fh = await dir.getFileHandle(`${ts}.${ext}`, { create: true });
    const w = await fh.createWritable();
    await w.write(bytes);
    await w.close();
    void opfs; // keep the import so the module stays coherent

    return { path, bytes: bytes.length, format };
  },
});
