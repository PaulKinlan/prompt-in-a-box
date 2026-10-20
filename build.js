#!/usr/bin/env node
/**
 * esbuild driver for the extension.
 *
 * Supports building a specific example as a standalone unpacked extension:
 *   npm run build <example-name>
 *   npm run build -- --example=<example-name>
 *
 * Default built files go to dist/.
 * Standalone example files go to examples/<example-name>/dist/.
 */
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');

/**
 * Scans all examples/ subdirectories and generates a catalog of starter templates
 * saved to src/generated-examples.json for Studio consumption.
 */
export function generateExamplesCatalog() {
  const examplesDir = resolve('examples');
  if (!existsSync(examplesDir)) {
    return [];
  }
  const dirents = readdirSync(examplesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const catalog = [];

  for (const dirent of dirents) {
    const slug = dirent.name;
    const exampleDir = join(examplesDir, slug);

    const manifestPath = join(exampleDir, 'manifest.json');
    const configPath = join(exampleDir, 'config.json');
    const promptPath = join(exampleDir, 'prompt.md');

    let manifest = {};
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch (err) {
        console.warn(`Warning: Could not parse manifest for example ${slug}:`, err.message);
      }
    }

    let config = {};
    if (existsSync(configPath)) {
      try {
        config = JSON.parse(readFileSync(configPath, 'utf8'));
      } catch (err) {
        console.warn(`Warning: Could not parse config for example ${slug}:`, err.message);
      }
    }

    let prompt = '';
    if (existsSync(promptPath)) {
      try {
        prompt = readFileSync(promptPath, 'utf8');
      } catch (err) {
        console.warn(`Warning: Could not read prompt for example ${slug}:`, err.message);
      }
    }

    // Determine clean name
    let name = manifest.name;
    if (!name && prompt) {
      const match = prompt.match(/^#\s+(.+)$/m);
      if (match) {
        name = match[1].trim();
      }
    }
    if (!name) {
      name = slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    // Determine clean description
    let description = manifest.description;
    if (!description && prompt) {
      const lines = prompt.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('```')) {
          description = trimmed;
          break;
        }
      }
    }
    if (!description) {
      description = `Standalone ${name} Chrome Extension built with prompt-in-a-box.`;
    }

    // Determine permissions
    let permissions = manifest.permissions;
    if (!Array.isArray(permissions) || permissions.length === 0) {
      permissions = ['storage', 'alarms'];
    }

    let optional_permissions = Array.isArray(manifest.optional_permissions)
      ? manifest.optional_permissions
      : [];

    // If prompt mentions permissions and manifest wasn't explicit, check prompt
    if (!existsSync(manifestPath) && prompt) {
      const permMatch = prompt.match(/##\s+Required permissions\s*\n+([^#\n]+)/i);
      if (permMatch) {
        const rawPerms = permMatch[1].match(/`([^`]+)`/g);
        if (rawPerms) {
          for (const raw of rawPerms) {
            const p = raw.replace(/`/g, '').trim();
            if (p && !permissions.includes(p) && !optional_permissions.includes(p)) {
              if (p === 'storage' || p === 'alarms') {
                permissions.push(p);
              } else {
                optional_permissions.push(p);
              }
            }
          }
        }
      }
    }

    let host_permissions = Array.isArray(manifest.host_permissions)
      ? manifest.host_permissions
      : ['<all_urls>'];

    let alarmMinutes = 30;
    if (config.schedule?.defaultAlarmMinutes !== undefined) {
      alarmMinutes = config.schedule.defaultAlarmMinutes;
    } else if (manifest.prompt_in_a_box?.alarm_minutes !== undefined) {
      alarmMinutes = manifest.prompt_in_a_box.alarm_minutes;
    }

    const agentSettings = Array.isArray(config.agentSettings) ? config.agentSettings : undefined;
    const uiConfig = config.ui || undefined;

    catalog.push({
      id: `example-${slug}`,
      slug,
      name,
      description,
      prompt,
      permissions,
      optional_permissions,
      host_permissions,
      alarmMinutes,
      agentSettings,
      uiConfig,
    });
  }

  const outputPath = resolve('src/generated-examples.json');
  writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');
  console.log(`📦 Generated examples catalog (${catalog.length} templates) → src/generated-examples.json`);
  return catalog;
}

/**
 * Packs/prepares a standalone example, writing pack_hash into config.json
 * and stripping prompt_in_a_box from manifest.json.
 */
export function packExample(exampleName) {
  const exampleDir = join('examples', exampleName);
  const exampleManifest = join(exampleDir, 'manifest.json');
  const exampleConfig = join(exampleDir, 'config.json');

  let packHash = null;

  // If manifest has prompt_in_a_box, extract pack_hash if present, then strip prompt_in_a_box
  if (existsSync(exampleManifest)) {
    try {
      const manifest = JSON.parse(readFileSync(exampleManifest, 'utf8'));
      if (manifest.prompt_in_a_box) {
        if (manifest.prompt_in_a_box.pack_hash) {
          packHash = manifest.prompt_in_a_box.pack_hash;
        }
        delete manifest.prompt_in_a_box;
        writeFileSync(exampleManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
        console.log(`🧹 Stripped prompt_in_a_box from ${exampleManifest}`);
      }
    } catch (err) {
      console.warn(`Warning: Could not process manifest in packExample:`, err.message);
    }
  }

  // Write pack_hash into config.json
  if (existsSync(exampleConfig)) {
    try {
      const config = JSON.parse(readFileSync(exampleConfig, 'utf8'));
      if (packHash) {
        config.pack_hash = packHash;
      }
      writeFileSync(exampleConfig, JSON.stringify(config, null, 2) + '\n', 'utf8');
      console.log(`📝 Updated pack_hash in ${exampleConfig}`);
    } catch (err) {
      console.warn(`Warning: Could not update config in packExample:`, err.message);
    }
  }
}

// Parse target example
const args = process.argv.slice(2);
let exampleName = null;
for (const arg of args) {
  if (arg.startsWith('--example=')) {
    exampleName = arg.split('=')[1];
  } else if (!arg.startsWith('-') && arg !== 'default') {
    exampleName = arg;
  }
}

let outDir = 'dist';

if (exampleName) {
  const examplesDir = resolve('examples');
  const examples = readdirSync(examplesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map(dirent => dirent.name);

  if (!examples.includes(exampleName)) {
    console.error(`\n❌ Error: Example "${exampleName}" not found.\n`);
    console.error('Available examples:');
    for (const ex of examples) {
      console.error(`  - ${ex}`);
    }
    process.exit(1);
  }

  const exampleDir = join('examples', exampleName);
  outDir = join(exampleDir, 'dist');
  console.log(`🔨 Building standalone example "${exampleName}" → ${outDir}...`);

  // Ensure prompt.md exists in the example folder (must)
  if (!existsSync(join(exampleDir, 'prompt.md'))) {
    console.error(`❌ Error: Example "${exampleName}" is missing "prompt.md".`);
    process.exit(1);
  }

  // Ensure manifest.json exists, and merge it with the baseline template
  const defaultManifestPath = resolve('scripts/templates/manifest.json');
  if (existsSync(defaultManifestPath)) {
    try {
      const manifestContent = JSON.parse(readFileSync(defaultManifestPath, 'utf8'));
      const exampleManifest = join(exampleDir, 'manifest.json');
      
      if (existsSync(exampleManifest)) {
        const exampleContent = JSON.parse(readFileSync(exampleManifest, 'utf8'));
        
        if (exampleContent.name) manifestContent.name = exampleContent.name;
        if (exampleContent.version) manifestContent.version = exampleContent.version;
        if (exampleContent.description) manifestContent.description = exampleContent.description;
        if (exampleContent.action) {
          manifestContent.action = { ...manifestContent.action, ...exampleContent.action };
        } else if (exampleContent.name) {
          manifestContent.action = manifestContent.action || {};
          manifestContent.action.default_title = exampleContent.name;
        }
        
        if (exampleContent.prompt_in_a_box) {
          manifestContent.prompt_in_a_box = {
            ...manifestContent.prompt_in_a_box,
            ...exampleContent.prompt_in_a_box
          };
        }
        delete manifestContent.prompt_in_a_box;
        
        if (exampleContent.permissions) {
          const mergedPerms = new Set([...manifestContent.permissions, ...exampleContent.permissions]);
          manifestContent.permissions = Array.from(mergedPerms);
        }
        
        if (exampleContent.host_permissions) {
          const mergedHosts = new Set([...manifestContent.host_permissions, ...exampleContent.host_permissions]);
          manifestContent.host_permissions = Array.from(mergedHosts);
        }

        if (exampleContent.optional_permissions) {
          const mergedOptPerms = new Set([...(manifestContent.optional_permissions || []), ...exampleContent.optional_permissions]);
          manifestContent.optional_permissions = Array.from(mergedOptPerms);
        }

        // Deduplicate: optional permissions must never contain required permissions
        if (manifestContent.optional_permissions && manifestContent.permissions) {
          const reqSet = new Set(manifestContent.permissions);
          manifestContent.optional_permissions = manifestContent.optional_permissions.filter(p => !reqSet.has(p));
        }

        // Deduplicate: optional host permissions must never contain required host permissions
        if (manifestContent.optional_host_permissions && manifestContent.host_permissions) {
          const reqHostSet = new Set(manifestContent.host_permissions);
          manifestContent.optional_host_permissions = manifestContent.optional_host_permissions.filter(h => !reqHostSet.has(h));
        }
        
        // Ensure standard sandbox and content_security_policy from template are applied
        const baseTmpl = JSON.parse(readFileSync(defaultManifestPath, 'utf8'));
        if (baseTmpl.sandbox) manifestContent.sandbox = baseTmpl.sandbox;
        if (baseTmpl.content_security_policy) manifestContent.content_security_policy = baseTmpl.content_security_policy;

        console.log(`📋 Merging custom manifest settings for ${exampleName}...`);
      } else {
        const titleCaseName = exampleName
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        
        manifestContent.name = titleCaseName;
        manifestContent.description = `Standalone ${titleCaseName} Chrome Extension built with prompt-in-a-box.`;
        manifestContent.action = manifestContent.action || {};
        manifestContent.action.default_title = titleCaseName;
        
        console.log(`📋 Generating default standalone manifest for ${exampleName}...`);
      }
      
      writeFileSync(exampleManifest, JSON.stringify(manifestContent, null, 2), 'utf8');
      console.log(`✨ Manifest written successfully to ${exampleManifest}`);
    } catch (err) {
      console.error(`❌ Error building manifest for example:`, err.message);
      process.exit(1);
    }
  }

  // Ensure config.json exists in example folder, otherwise copy default template
  const exampleConfig = join(exampleDir, 'config.json');
  if (!existsSync(exampleConfig)) {
    const templateConfig = resolve('scripts/templates/config.json');
    if (existsSync(templateConfig)) {
      cpSync(templateConfig, exampleConfig);
      console.log(`⚙️ Copied default config.json to ${exampleConfig}`);
    } else if (existsSync('config.json')) {
      cpSync('config.json', exampleConfig);
      console.log(`⚙️ Copied config.json to ${exampleConfig}`);
    }
  }

  // Ensure the icon set exists, otherwise copy each missing size from root.
  const iconFiles = ['icon.png', 'icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-128.png'];
  for (const iconFile of iconFiles) {
    const exampleIcon = join(exampleDir, iconFile);
    if (!existsSync(exampleIcon) && existsSync(iconFile)) {
      cpSync(iconFile, exampleIcon);
      console.log(`🎨 Copied ${iconFile} to ${exampleIcon}`);
    }
  }

  // Pack/prepare example: write pack_hash into config.json and strip prompt_in_a_box from manifest.json
  packExample(exampleName);
} else {
  console.log('🔨 Building default workspace extension → dist/...');
}

const MCP_STUB = resolve('src/stubs/mcp-sdk.ts');
const NODE_MODULE_STUB = resolve('src/stubs/node-module.ts');
const NODE_BUILTIN_STUB = resolve('src/stubs/node-only.ts');

/**
 * esbuild plugin: redirect agent-do's node-only imports to SW-safe
 * stubs.
 */
const stubNodeOnlyImports = {
  name: 'stub-node-only-imports',
  setup(build) {
    build.onResolve({ filter: /^@modelcontextprotocol\/sdk\// }, () => ({
      path: MCP_STUB,
    }));
    build.onResolve({ filter: /^node:module$/ }, () => ({
      path: NODE_MODULE_STUB,
    }));
    build.onResolve({ filter: /^node:/ }, () => ({
      path: NODE_BUILTIN_STUB,
    }));
    build.onResolve({ filter: /^just-bash$/ }, () => ({
      path: NODE_BUILTIN_STUB,
    }));
  },
};

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120'],
  sourcemap: prod ? false : 'linked',
  minify: prod,
  logLevel: 'info',
  plugins: [stubNodeOnlyImports],
  define: {
    'import.meta.vitest': 'undefined',
  },
};

const includeStudio = !exampleName || args.includes('--with-studio');

const entries = [
  { in: 'src/background.ts', out: join(outDir, 'background.js') },
  { in: 'src/popup.ts', out: join(outDir, 'popup.js') },
  { in: 'src/sidepanel.ts', out: join(outDir, 'sidepanel.js') },
  { in: 'src/options.ts', out: join(outDir, 'options.js') },
  { in: 'src/offscreen.ts', out: join(outDir, 'offscreen.js') },
  { in: 'src/artifacts-browser.ts', out: join(outDir, 'artifacts-browser.js') },
  { in: 'src/sandbox.ts', out: join(outDir, 'sandbox.js') },
];

if (includeStudio) {
  entries.push({ in: 'src/studio.ts', out: join(outDir, 'studio.js') });
}

async function run() {
  generateExamplesCatalog();
  mkdirSync(outDir, { recursive: true });
  // Copy static assets that aren't TS sources.
  cpSync('src/popup.html', join(outDir, 'popup.html'));
  cpSync('src/sidepanel.html', join(outDir, 'sidepanel.html'));
  cpSync('src/ui-renderer.css', join(outDir, 'ui-renderer.css'));
  cpSync('src/options.html', join(outDir, 'options.html'));
  cpSync('src/offscreen.html', join(outDir, 'offscreen.html'));
  cpSync('src/artifacts.html', join(outDir, 'artifacts.html'));
  cpSync('src/sandbox.html', join(outDir, 'sandbox.html'));

  if (includeStudio) {
    cpSync('src/studio.html', join(outDir, 'studio.html'));
  } else {
    // Ensure no stale studio files exist in standalone example dist
    rmSync(join(outDir, 'studio.html'), { force: true });
    rmSync(join(outDir, 'studio.js'), { force: true });
    rmSync(join(outDir, 'studio.js.map'), { force: true });
  }

  if (watch) {
    for (const e of entries) {
      const ctx = await context({
        ...common,
        entryPoints: [e.in],
        outfile: e.out,
      });
      await ctx.watch();
      console.log(`watching ${e.in} → ${e.out}`);
    }
    return;
  }

  for (const e of entries) {
    await build({ ...common, entryPoints: [e.in], outfile: e.out });
  }
  console.log('build complete');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
