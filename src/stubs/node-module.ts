/**
 * Build-time stub for node:module.
 *
 * agent-do's mcp.ts calls `createRequire(import.meta.url)` to read its
 * own package.json for the MCP client version string. The browser
 * doesn't have CommonJS require; we never call the code path that
 * uses this (see ./mcp-sdk.ts), but the top-level import still needs
 * to resolve. Provide a no-op createRequire that returns a function
 * which throws if invoked.
 */

export function createRequire(): (...args: unknown[]) => unknown {
  return () => {
    throw new Error('createRequire is not available in the extension runtime.');
  };
}

export default { createRequire };
