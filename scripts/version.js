#!/usr/bin/env node
/**
 * Version management and content-based auto-incrementing for Prompt in a Box.
 *
 * Usage:
 *   node scripts/version.js                       # Increment patch version of main product (e.g. 0.7.0 -> 0.7.1)
 *   node scripts/version.js minor                 # Increment minor version (e.g. 0.7.0 -> 0.8.0)
 *   node scripts/version.js major                 # Increment major version (e.g. 0.7.0 -> 1.0.0)
 *   node scripts/version.js 0.8.5                 # Set specific version
 *   node scripts/version.js sorting-hat-browser   # Increment patch version of specific example
 *   node scripts/version.js sorting-hat-browser minor
 *   node scripts/version.js --status              # Show version & content hash status across workspace
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
process.chdir(repoRoot);

// ─── Content Hashing ───────────────────────────────────────────────────

/**
 * Computes a deterministic SHA-256 hash across all functional extension files.
 * Ignores the 'version' and 'pack_hash' fields so that bumping the version number
 * does not alter the content hash.
 */
export function computeExtensionContentHash(targetDir = '.') {
  const hash = createHash('sha256');

  // 1. prompt.md
  const promptPath = join(targetDir, 'prompt.md');
  if (existsSync(promptPath)) {
    hash.update('--- prompt.md ---\n');
    hash.update(readFileSync(promptPath));
  }

  // 2. config.json (normalized without version and pack_hash)
  const configPath = join(targetDir, 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      const normalizedCfg = { ...cfg };
      delete normalizedCfg.version;
      delete normalizedCfg.pack_hash;
      hash.update('--- config.json ---\n');
      hash.update(JSON.stringify(normalizedCfg));
    } catch {
      hash.update(readFileSync(configPath));
    }
  }

  // 3. manifest.json (normalized without version and pack_hash)
  const manifestPath = join(targetDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    try {
      const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const normalizedManifest = { ...m };
      delete normalizedManifest.version;
      delete normalizedManifest.version_name;
      if (normalizedManifest.prompt_in_a_box) {
        normalizedManifest.prompt_in_a_box = { ...normalizedManifest.prompt_in_a_box };
        delete normalizedManifest.prompt_in_a_box.pack_hash;
      }
      hash.update('--- manifest.json ---\n');
      hash.update(JSON.stringify(normalizedManifest));
    } catch {
      hash.update(readFileSync(manifestPath));
    }
  }

  // 4. Icons
  const iconFiles = ['icon.png', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png', 'icon-512.png'];
  for (const ic of iconFiles) {
    const icPath = join(targetDir, ic);
    if (existsSync(icPath)) {
      hash.update(`--- ${ic} ---\n`);
      hash.update(readFileSync(icPath));
    }
  }

  // 5. Built files in dist/ (excluding sourcemaps)
  const distDir = join(targetDir, 'dist');
  if (existsSync(distDir)) {
    const files = readdirSync(distDir)
      .filter((f) => !f.endsWith('.map') && !f.startsWith('.'))
      .sort();
    for (const f of files) {
      const fullPath = join(distDir, f);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          hash.update(`--- dist/${f} ---\n`);
          hash.update(readFileSync(fullPath));
        }
      } catch {
        // ignore
      }
    }
  }

  return hash.digest('hex');
}

// ─── Semver Bumping ────────────────────────────────────────────────────

export function bumpSemver(currentVersion, releaseType = 'patch') {
  const clean = String(currentVersion || '0.0.1').trim().replace(/^v/, '');
  // If an explicit version like "1.2.3" was passed, use it directly
  if (/^\d+\.\d+\.\d+$/.test(releaseType)) {
    return releaseType;
  }

  const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    return '0.7.1';
  }

  let major = parseInt(match[1], 10);
  let minor = parseInt(match[2], 10);
  let patch = parseInt(match[3], 10);

  switch (String(releaseType).toLowerCase()) {
    case 'major':
      major += 1;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor += 1;
      patch = 0;
      break;
    case 'patch':
    default:
      patch += 1;
      break;
  }

  return `${major}.${minor}.${patch}`;
}

// ─── File Mutators ─────────────────────────────────────────────────────

function updateJsonField(filePath, updater) {
  if (!existsSync(filePath)) return false;
  try {
    const content = JSON.parse(readFileSync(filePath, 'utf8'));
    updater(content);
    writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    console.warn(`Failed to update ${filePath}:`, err);
    return false;
  }
}

export function updateMainProductVersion(newVersion, newHash) {
  // 1. package.json
  updateJsonField('package.json', (pkg) => {
    pkg.version = newVersion;
  });

  // 2. package-lock.json
  if (existsSync('package-lock.json')) {
    updateJsonField('package-lock.json', (lock) => {
      lock.version = newVersion;
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = newVersion;
      }
    });
  }

  // 3. manifest.json
  updateJsonField('manifest.json', (m) => {
    m.version = newVersion;
    if (m.prompt_in_a_box) {
      delete m.prompt_in_a_box;
    }
  });

  // 4. config.json
  if (existsSync('config.json')) {
    updateJsonField('config.json', (cfg) => {
      cfg.version = newVersion;
      if (newHash) {
        cfg.pack_hash = newHash;
      }
      if (!cfg.prompt) {
        cfg.prompt = 'prompt.md';
      }
    });
  }

  // 5. scripts/templates
  if (existsSync('scripts/templates/manifest.json')) {
    updateJsonField('scripts/templates/manifest.json', (m) => {
      m.version = newVersion;
      if (m.prompt_in_a_box) {
        delete m.prompt_in_a_box;
      }
    });
  }
  if (existsSync('scripts/templates/config.json')) {
    updateJsonField('scripts/templates/config.json', (cfg) => {
      cfg.version = newVersion;
    });
  }
}

export function updateExampleVersion(exampleName, newVersion, newHash) {
  const exampleDir = join('examples', exampleName);
  if (!existsSync(exampleDir)) return;

  const manifestPath = join(exampleDir, 'manifest.json');
  updateJsonField(manifestPath, (m) => {
    m.version = newVersion;
    if (m.prompt_in_a_box) {
      delete m.prompt_in_a_box;
    }
  });

  const configPath = join(exampleDir, 'config.json');
  if (existsSync(configPath)) {
    updateJsonField(configPath, (cfg) => {
      cfg.version = newVersion;
      if (newHash) {
        cfg.pack_hash = newHash;
      }
      if (!cfg.prompt) {
        cfg.prompt = 'prompt.md';
      }
    });
  }
}

// ─── Sync on Pack Handler ──────────────────────────────────────────────

export function syncVersionOnPack(exampleName, options = {}) {
  const targetDir = exampleName ? join('examples', exampleName) : '.';
  const manifestPath = join(targetDir, 'manifest.json');
  const configPath = join(targetDir, 'config.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found in ${targetDir}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {}
  }

  const currentVersion = manifest.version || config.version || '0.0.1';
  const previousHash = config.pack_hash || manifest.prompt_in_a_box?.pack_hash;
  const currentHash = computeExtensionContentHash(targetDir);

  if (options.noBump) {
    return {
      bumped: false,
      version: currentVersion,
      hash: currentHash,
      previousHash,
    };
  }

  const hasChanged = previousHash !== currentHash;

  if (options.forceBump || (previousHash && hasChanged)) {
    const releaseType = options.releaseType || 'patch';
    const newVersion = bumpSemver(currentVersion, releaseType);

    if (exampleName) {
      updateExampleVersion(exampleName, newVersion, currentHash);
    } else {
      updateMainProductVersion(newVersion, currentHash);
    }

    const prevShort = previousHash ? previousHash.slice(0, 8) : 'none';
    const currShort = currentHash.slice(0, 8);
    console.log(
      `🔼 Extension contents changed (${prevShort} → ${currShort}) — auto-bumped version: v${currentVersion} → v${newVersion}`,
    );

    return {
      bumped: true,
      version: newVersion,
      previousVersion: currentVersion,
      hash: currentHash,
      previousHash,
    };
  }

  if (!previousHash) {
    // Stamp the hash without bumping if this is the first hashed pack
    if (exampleName) {
      updateExampleVersion(exampleName, currentVersion, currentHash);
    } else {
      updateMainProductVersion(currentVersion, currentHash);
    }
    console.log(`📌 Stamped initial content hash (${currentHash.slice(0, 8)}) for v${currentVersion}`);
    return {
      bumped: false,
      version: currentVersion,
      hash: currentHash,
    };
  }

  console.log(`✅ Extension contents unchanged (${currentHash.slice(0, 8)}) — version remains v${currentVersion}`);
  return {
    bumped: false,
    version: currentVersion,
    hash: currentHash,
    previousHash,
  };
}

// ─── CLI Entrypoint ────────────────────────────────────────────────────

function printStatus() {
  console.log('\n📊 Extension Version & Content Hash Status:');
  console.log('═'.repeat(60));

  // Root
  try {
    const rootManifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    let rootConfig = {};
    if (existsSync('config.json')) {
      try {
        rootConfig = JSON.parse(readFileSync('config.json', 'utf8'));
      } catch {}
    }
    const rootHash = computeExtensionContentHash('.');
    const savedHash = rootConfig.pack_hash || rootManifest.prompt_in_a_box?.pack_hash || 'not set';
    const match = savedHash === rootHash ? '✅ current' : '⚠️ modified';
    console.log(`Main Product (prompt-in-a-box):`);
    console.log(`  Version:      v${rootManifest.version}`);
    console.log(`  Content Hash: ${rootHash.slice(0, 10)}... (${match})`);
  } catch (err) {
    console.log(`Main Product error: ${err.message}`);
  }

  console.log('─'.repeat(60));

  // Examples
  if (existsSync('examples')) {
    const examples = readdirSync('examples', { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort();

    for (const ex of examples) {
      const exDir = join('examples', ex);
      const mPath = join(exDir, 'manifest.json');
      const cPath = join(exDir, 'config.json');
      if (existsSync(mPath)) {
        try {
          const exM = JSON.parse(readFileSync(mPath, 'utf8'));
          let exC = {};
          if (existsSync(cPath)) {
            try {
              exC = JSON.parse(readFileSync(cPath, 'utf8'));
            } catch {}
          }
          const exHash = computeExtensionContentHash(exDir);
          const saved = exC.pack_hash || exM.prompt_in_a_box?.pack_hash || 'not set';
          const match = saved === exHash ? '✅ current' : '⚠️ modified';
          console.log(`Example: ${ex}`);
          console.log(`  Version:      v${exM.version}`);
          console.log(`  Content Hash: ${exHash.slice(0, 10)}... (${match})`);
        } catch {
          // ignore
        }
      }
    }
  }
  console.log('═'.repeat(60) + '\n');
}

// If invoked as a CLI script
const currentScriptUrl = import.meta.url;
if (process.argv[1] && currentScriptUrl.endsWith(process.argv[1].replace(/.*\//, ''))) {
  const args = process.argv.slice(2);

  if (args.includes('--status') || args.includes('-s')) {
    printStatus();
    process.exit(0);
  }

  let targetExample = null;
  let releaseType = 'patch';

  for (const arg of args) {
    if (arg.startsWith('--example=')) {
      targetExample = arg.split('=')[1];
    } else if (['patch', 'minor', 'major'].includes(arg.toLowerCase()) || /^\d+\.\d+\.\d+$/.test(arg)) {
      releaseType = arg.toLowerCase();
    } else if (!arg.startsWith('-')) {
      targetExample = arg;
    }
  }

  if (targetExample) {
    const exampleDir = join('examples', targetExample);
    if (!existsSync(exampleDir)) {
      console.error(`❌ Example "${targetExample}" not found.`);
      process.exit(1);
    }
    const manifestPath = join(exampleDir, 'manifest.json');
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const oldV = m.version || '0.0.1';
    const newV = bumpSemver(oldV, releaseType);
    updateExampleVersion(targetExample, newV);
    console.log(`✨ Bumped ${targetExample} version: v${oldV} → v${newV}`);
  } else {
    const rootManifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const oldV = rootManifest.version || '0.0.1';
    const newV = bumpSemver(oldV, releaseType);
    updateMainProductVersion(newV);
    console.log(`✨ Bumped Main Product version across workspace: v${oldV} → v${newV}`);
  }
}
