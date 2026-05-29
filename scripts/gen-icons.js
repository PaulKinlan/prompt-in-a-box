#!/usr/bin/env node
/**
 * Generate icons for every example extension (and the root project).
 *
 *   npm run icons                 # generate icons for the root + all examples
 *   npm run icons -- --only=focus-mode
 *   npm run icons -- --force      # overwrite icons that already exist
 *   npm run icons -- --no-ai      # skip AI, use the procedural glyph icons
 *
 * With GEMINI_API_KEY (or OPENAI_API_KEY) in the environment, icons are drawn
 * by an image model and reflect what each extension actually does. Without a
 * key, a clean procedural glyph icon is generated instead.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectImageProvider, generateIcons } from './lib/icons.js';

const ROOT = process.cwd();
const EXAMPLES_DIR = path.join(ROOT, 'examples');

// ─── Args ───────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const force = args.includes('--force');
const noAi = args.includes('--no-ai');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;
const skipRoot = args.includes('--no-root') || !!only;

const titleCase = (slug) =>
  slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Read name + description for an example from its manifest, then README. */
function readExampleMeta(dir, slug) {
  let name = titleCase(slug);
  let description = '';

  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (m.name) name = m.name;
      if (m.description) description = m.description;
    } catch {
      /* ignore malformed manifest */
    }
  }

  if (!description) {
    const readmePath = path.join(dir, 'README.md');
    if (fs.existsSync(readmePath)) {
      const lines = fs.readFileSync(readmePath, 'utf8').split('\n');
      // First non-empty paragraph after the heading is the description.
      const firstPara = lines.find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('-'));
      if (firstPara) description = firstPara.trim();
    }
  }

  return { name, description };
}

function listExampleDirs() {
  if (!fs.existsSync(EXAMPLES_DIR)) return [];
  return fs
    .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

async function main() {
  const allowAi = !noAi;
  const provider = allowAi ? detectImageProvider() : null;

  console.log(
    provider
      ? `🎨 Generating icons with ${provider.kind} (${provider.model})…`
      : `🎨 Generating procedural glyph icons${allowAi ? ' (no API key found)' : ' (--no-ai)'}…`,
  );

  const targets = [];

  if (!skipRoot) {
    targets.push({
      label: 'root (Prompt in a Box)',
      dir: ROOT,
      name: 'Prompt in a Box',
      description:
        'A Chrome extension whose entire logic is a prompt — load a prompt, run an agent loop, act through Chrome APIs.',
    });
  }

  let slugs = listExampleDirs();
  if (only) {
    if (!slugs.includes(only)) {
      console.error(`❌ Example "${only}" not found. Available:\n  - ${slugs.join('\n  - ')}`);
      process.exit(1);
    }
    slugs = [only];
  }

  for (const slug of slugs) {
    const dir = path.join(EXAMPLES_DIR, slug);
    const { name, description } = readExampleMeta(dir, slug);
    targets.push({ label: slug, dir, name, description });
  }

  let generated = 0;
  let skipped = 0;
  for (const t of targets) {
    const exists = fs.existsSync(path.join(t.dir, 'icon-128.png'));
    if (exists && !force) {
      console.log(`• ${t.label} — icon exists, skipping (use --force to regenerate)`);
      skipped++;
      continue;
    }
    console.log(`• ${t.label}`);
    const result = await generateIcons({
      name: t.name,
      description: t.description,
      destDir: t.dir,
      provider,
      allowAi,
      log: (m) => console.log(m),
    });
    console.log(`  ✓ ${result.source} icon (${result.files.length} files)`);
    generated++;
  }

  console.log(`\n✨ Done. Generated ${generated}, skipped ${skipped}.`);
}

main().catch((err) => {
  console.error('❌ Icon generation failed:', err);
  process.exit(1);
});
