#!/usr/bin/env node
/**
 * esbuild driver for the extension.
 *
 * Three entry points land in dist/:
 *   - dist/background.js  (service worker)
 *   - dist/popup.js       (popup UI)
 *   - dist/offscreen.js   (reserved for future offscreen document work)
 *
 * agent-do + @ai-sdk/anthropic + ai + zod all get bundled in. The
 * service worker's module-level imports mean we need `format: 'esm'`
 * plus a single self-contained output per entry — no code-splitting,
 * chrome can't resolve chunks from the extension origin outside the
 * zip.
 *
 * CSP note: agent-do's current build uses no `eval`. The only runtime
 * requiring `wasm-unsafe-eval` would be a provider that ships WASM
 * tokenisers; we don't include those. Plain 'self' for script-src
 * is enough.
 */
import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const watch = process.argv.includes('--watch');
const prod = process.argv.includes('--prod');

const MCP_STUB = resolve('src/stubs/mcp-sdk.ts');
const NODE_MODULE_STUB = resolve('src/stubs/node-module.ts');
const NODE_BUILTIN_STUB = resolve('src/stubs/node-only.ts');

/**
 * esbuild plugin: redirect agent-do's node-only imports to SW-safe
 * stubs. agent-do's barrel re-exports several modules that statically
 * import `@modelcontextprotocol/sdk`, `node:fs`, `node:path`,
 * `node:module`, etc. We never take those code paths in the extension,
 * but esbuild still has to resolve them at bundle time.
 *
 * All node:* imports go to a single generic stub that throws if
 * actually invoked. All @modelcontextprotocol/sdk/* imports go to the
 * MCP-specific stub.
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
  { in: 'src/background.ts', out: 'dist/background.js' },
  { in: 'src/popup.ts', out: 'dist/popup.js' },
  { in: 'src/options.ts', out: 'dist/options.js' },
  { in: 'src/offscreen.ts', out: 'dist/offscreen.js' },
  { in: 'src/artifacts-browser.ts', out: 'dist/artifacts-browser.js' },
];

async function run() {
  mkdirSync('dist', { recursive: true });
  // Copy static assets that aren't TS sources.
  cpSync('src/popup.html', 'dist/popup.html');
  cpSync('src/options.html', 'dist/options.html');
  cpSync('src/offscreen.html', 'dist/offscreen.html');
  cpSync('src/artifacts.html', 'dist/artifacts.html');

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
