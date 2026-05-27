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
import { cpSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');

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
        
        if (exampleContent.prompt_in_a_box) {
          manifestContent.prompt_in_a_box = {
            ...manifestContent.prompt_in_a_box,
            ...exampleContent.prompt_in_a_box
          };
        }
        
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

  // Ensure icon.png exists, otherwise copy from root
  const exampleIcon = join(exampleDir, 'icon.png');
  if (!existsSync(exampleIcon) && existsSync('icon.png')) {
    cpSync('icon.png', exampleIcon);
    console.log(`🎨 Copied icon.png to ${exampleIcon}`);
  }
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

const entries = [
  { in: 'src/background.ts', out: join(outDir, 'background.js') },
  { in: 'src/popup.ts', out: join(outDir, 'popup.js') },
  { in: 'src/options.ts', out: join(outDir, 'options.js') },
  { in: 'src/offscreen.ts', out: join(outDir, 'offscreen.js') },
  { in: 'src/artifacts-browser.ts', out: join(outDir, 'artifacts-browser.js') },
  { in: 'src/sandbox.ts', out: join(outDir, 'sandbox.js') },
];

async function run() {
  mkdirSync(outDir, { recursive: true });
  // Copy static assets that aren't TS sources.
  cpSync('src/popup.html', join(outDir, 'popup.html'));
  cpSync('src/options.html', join(outDir, 'options.html'));
  cpSync('src/offscreen.html', join(outDir, 'offscreen.html'));
  cpSync('src/artifacts.html', join(outDir, 'artifacts.html'));
  cpSync('src/sandbox.html', join(outDir, 'sandbox.html'));

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
