#!/usr/bin/env node
/**
 * Packs the extension into a Chrome-loadable .zip.
 *
 * Supports zipping specific examples directly inside their own folders:
 *   npm run pack <example-name>
 *   npm run pack -- --example=<example-name>
 *
 * This builds the example directly under examples/<example-name>/dist/
 * and zips the example directory into examples/<example-name>/<example-name>.zip.
 *
 * Default workspace is built under dist/ and zipped into prompt-in-a-box.zip.
 */
import { execSync } from 'node:child_process';
import { existsSync, rmSync, statSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
process.chdir(repoRoot);

// Helper to get available examples
const getExamples = () => {
  try {
    return readdirSync('examples', { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => dirent.name)
      .sort();
  } catch (err) {
    return [];
  }
};

const examples = getExamples();

// Parse command line arguments
const args = process.argv.slice(2);
let exampleName = null;
for (const arg of args) {
  if (arg.startsWith('--example=')) {
    exampleName = arg.split('=')[1];
  } else if (!arg.startsWith('-') && arg !== 'default') {
    exampleName = arg;
  }
}

if (exampleName) {
  if (!examples.includes(exampleName)) {
    console.error(`\n❌ Error: Example "${exampleName}" not found.\n`);
    console.error('Available examples:');
    for (const ex of examples) {
      console.error(`  - ${ex}`);
    }
    process.exit(1);
  }

  console.log(`📦 Building standalone example "${exampleName}"...`);
  try {
    // 1. Run build for this specific example
    execSync(`node build.js ${exampleName}`, { stdio: 'inherit' });
  } catch (err) {
    console.error(`\n❌ Error building example "${exampleName}":`, err.message);
    process.exit(1);
  }

  const exampleDir = join('examples', exampleName);
  const zipName = `${exampleName}.zip`;
  const absoluteExampleDir = resolve(exampleDir);
  const absoluteZipPath = join(absoluteExampleDir, zipName);

  // 2. Remove old zip if exists inside example folder
  if (existsSync(absoluteZipPath)) {
    rmSync(absoluteZipPath);
  }

  // Ensure all required files exist
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

  const missing = REQUIRED.filter((f) => !existsSync(join(exampleDir, f)));
  if (missing.length) {
    console.error('\n❌ Error: Missing required built files in example directory.');
    for (const f of missing) console.error('  -', join(exampleDir, f));
    process.exit(1);
  }

  console.log(`\n📦 Zipping example extension directly from "${exampleDir}"...`);

  try {
    // 3. Zip inside the example directory so all files are at the root level of the zip
    execSync(`zip -r ${zipName} . -x "*.map" "*.zip"`, {
      cwd: absoluteExampleDir,
      stdio: 'inherit',
    });

    const size = (statSync(absoluteZipPath).size / 1024).toFixed(1);
    console.log(`\n✨ Successfully built and packaged standalone example!`);
    console.log(`📂 Unpacked extension folder:  file://${absoluteExampleDir}`);
    console.log(`📦 Standalone zip file:        file://${absoluteZipPath} (${size} kB)`);
    console.log('\nLoad either unpacked folder directly in chrome://extensions or upload the ZIP to the Chrome Web Store.');
  } catch (err) {
    console.error('\n❌ Error during zipping:', err.message);
    process.exit(1);
  }
} else {
  // --- Default Root Extension Pack ---
  console.log('📦 Building default workspace extension...');
  try {
    execSync('node build.js', { stdio: 'inherit' });
  } catch (err) {
    console.error('\n❌ Error building default workspace:', err.message);
    process.exit(1);
  }

  const ZIP_NAME = 'prompt-in-a-box.zip';
  if (existsSync(ZIP_NAME)) {
    rmSync(ZIP_NAME);
  }

  const REQUIRED_DIST = [
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

  const missing = [...REQUIRED_DIST, 'icon.png', 'prompt.md', 'manifest.json'].filter((f) => !existsSync(f));
  if (missing.length) {
    console.error('\n❌ Error: Missing required files for default pack.');
    for (const f of missing) console.error('  -', f);
    process.exit(1);
  }

  // Setup staging directory for root pack to ensure clean files
  const STAGING_DIR = '.temp-pack';
  if (existsSync(STAGING_DIR)) {
    rmSync(STAGING_DIR, { recursive: true, force: true });
  }

  mkdirSync(STAGING_DIR);
  mkdirSync(join(STAGING_DIR, 'dist'));

  // Copy files to staging
  cpSync('prompt.md', join(STAGING_DIR, 'prompt.md'));
  cpSync('manifest.json', join(STAGING_DIR, 'manifest.json'));
  cpSync('icon.png', join(STAGING_DIR, 'icon.png'));

  // Copy dist files
  for (const f of REQUIRED_DIST) {
    cpSync(f, join(STAGING_DIR, f));
  }

  console.log('\n📦 Zipping default extension into root ZIP...');
  try {
    execSync(`zip -r ../${ZIP_NAME} . -x "*.map"`, {
      cwd: resolve(STAGING_DIR),
      stdio: 'inherit',
    });

    const size = (statSync(ZIP_NAME).size / 1024).toFixed(1);
    console.log(`\n✨ Packed ${ZIP_NAME} (${size} kB) successfully at repository root!`);
  } catch (err) {
    console.error('\n❌ Error during zipping default extension:', err.message);
    process.exit(1);
  } finally {
    if (existsSync(STAGING_DIR)) {
      rmSync(STAGING_DIR, { recursive: true, force: true });
    }
  }
}
