#!/usr/bin/env node
/**
 * Packs the extension into a Chrome-loadable .zip.
 *
 * Only includes the files Chrome actually needs at runtime:
 *   - manifest.json
 *   - prompt.md            (the program)
 *   - icon.png
 *   - dist/*.{js,html}     (no sourcemaps — zip stays small and the
 *                           store is fine without them)
 *
 * Explicitly excluded: src/, examples/, node_modules/, scripts/,
 * package.json, package-lock.json, build.js, tsconfig.json, *.map.
 * examples/ in particular is developer-facing demo prompts — users pick
 * one and replace prompt.md; the zip ships with just the one prompt
 * that's currently in the repo root.
 *
 * Run: `npm run build && npm run pack`
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
process.chdir(repoRoot);

const ZIP_NAME = 'prompt-in-a-box.zip';

const REQUIRED = [
  'manifest.json',
  'prompt.md',
  'icon.png',
  'dist/background.js',
  'dist/popup.js',
  'dist/popup.html',
  'dist/options.js',
  'dist/options.html',
  'dist/offscreen.js',
  'dist/offscreen.html',
  'dist/artifacts.html',
  'dist/artifacts-browser.js',
];

const missing = REQUIRED.filter((f) => !existsSync(f));
if (missing.length) {
  console.error('Missing required files. Run `npm run build` first.');
  for (const f of missing) console.error('  -', f);
  process.exit(1);
}

if (existsSync(ZIP_NAME)) rmSync(ZIP_NAME);

// `zip -r` with an explicit include list, -x to double-belt exclude
// sourcemaps in case a stray one lurks under dist/.
execSync(`zip -r ${ZIP_NAME} ${REQUIRED.join(' ')} -x '*.map'`, {
  stdio: 'inherit',
});

const size = (statSync(ZIP_NAME).size / 1024).toFixed(1);
console.log(`\nPacked ${ZIP_NAME} (${size} kB)`);
console.log('Upload to chrome://extensions (Developer mode → Pack) or the Chrome Web Store.');
