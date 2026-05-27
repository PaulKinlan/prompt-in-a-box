#!/usr/bin/env node
/**
 * Activates an example by copying its prompt.md and manifest.json (if present)
 * to the repository root. This makes it extremely easy to run and test any
 * example in Chrome using the unpacked developer mode.
 *
 * Usage:
 *   npm run use <example-name>
 *   npm run use default
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const examplesDir = path.join(repoRoot, 'examples');
const templatesDir = path.join(repoRoot, 'scripts', 'templates');

// Find all examples (subdirectories under examples/ that are not README.md or hidden)
const getExamples = () => {
  try {
    return fs.readdirSync(examplesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => dirent.name)
      .sort();
  } catch (err) {
    console.error('Error reading examples directory:', err.message);
    return [];
  }
};

const examples = getExamples();
const target = process.argv[2];

if (!target) {
  console.log('\n🔍 Prompt in a Box - Example Switcher');
  console.log('Usage: npm run use <example-name> | default | reset\n');
  console.log('Available examples:');
  for (const ex of examples) {
    console.log(`  - ${ex}`);
  }
  console.log('\nSpecial options:');
  console.log('  - default / reset : Restore the default/baseline templates\n');
  process.exit(0);
}

if (target === 'default' || target === 'reset') {
  const defaultPrompt = path.join(templatesDir, 'prompt.md');
  const defaultManifest = path.join(templatesDir, 'manifest.json');

  if (!fs.existsSync(defaultPrompt) || !fs.existsSync(defaultManifest)) {
    console.error('Error: Baseline templates not found in scripts/templates/');
    process.exit(1);
  }

  fs.copyFileSync(defaultPrompt, path.join(repoRoot, 'prompt.md'));
  fs.copyFileSync(defaultManifest, path.join(repoRoot, 'manifest.json'));

  console.log('\n✨ Reset workspace to baseline prompt.md and manifest.json!');
  process.exit(0);
}

if (!examples.includes(target)) {
  console.error(`\n❌ Error: Example "${target}" not found.\n`);
  console.error('Available examples:');
  for (const ex of examples) {
    console.error(`  - ${ex}`);
  }
  process.exit(1);
}

const exampleDir = path.join(examplesDir, target);
const examplePrompt = path.join(exampleDir, 'prompt.md');
const exampleManifest = path.join(exampleDir, 'manifest.json');

if (!fs.existsSync(examplePrompt)) {
  console.error(`\n❌ Error: Example "${target}" is missing "prompt.md".`);
  process.exit(1);
}

// Copy prompt.md
fs.copyFileSync(examplePrompt, path.join(repoRoot, 'prompt.md'));
console.log(`📝 Copied examples/${target}/prompt.md -> prompt.md`);

// Copy manifest.json or restore default
if (fs.existsSync(exampleManifest)) {
  fs.copyFileSync(exampleManifest, path.join(repoRoot, 'manifest.json'));
  console.log(`📋 Copied examples/${target}/manifest.json -> manifest.json (custom manifest)`);
} else {
  const defaultManifest = path.join(templatesDir, 'manifest.json');
  if (fs.existsSync(defaultManifest)) {
    fs.copyFileSync(defaultManifest, path.join(repoRoot, 'manifest.json'));
    console.log(`📋 No custom manifest found. Restored baseline to manifest.json`);
  }
}

console.log(`\n✨ Activated example "${target}"!`);
console.log('👉 Next steps:');
console.log('   1. Run `npm run build` to update the extension logic.');
console.log('   2. Reload the extension in chrome://extensions to apply changes.\n');
