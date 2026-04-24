/**
 * Generic stub for Node built-ins that agent-do re-exports transitively
 * via its barrel (routines.js → node:fs, stores/filesystem.js → node:fs,
 * etc.). We never hit those code paths in the extension — we only use
 * runAgentLoop + in-memory state — but the bundler parses the barrel
 * and follows every static import.
 *
 * Every export is a no-op placeholder. If any of these is ever called
 * at runtime, throw loudly so it's obvious the extension has reached a
 * code path that doesn't belong in a service worker.
 */

const UNSUPPORTED = 'Node built-ins are not available in the extension service worker.';

function reject(...args: unknown[]): never {
  void args;
  throw new Error(UNSUPPORTED);
}

// The handful of specific named exports agent-do touches from node:fs
// and node:path. If the bundler needs more, add them here.
export const promises = new Proxy({}, { get: () => reject });
export const readFileSync = reject;
export const writeFileSync = reject;
export const existsSync = () => false;
export const mkdirSync = reject;
export const readFile = reject;
export const writeFile = reject;
export const stat = reject;
export const unlink = reject;
export const readdir = reject;
export const mkdir = reject;
export const join = (...parts: string[]) => parts.filter(Boolean).join('/');
export const resolve = (...parts: string[]) => parts.filter(Boolean).join('/');
export const dirname = (p: string) => p.split('/').slice(0, -1).join('/');
export const basename = (p: string) => p.split('/').pop() ?? '';
export const extname = (p: string) => {
  const b = p.split('/').pop() ?? '';
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i) : '';
};

export default {
  promises,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readFile,
  writeFile,
  stat,
  unlink,
  readdir,
  mkdir,
  join,
  resolve,
  dirname,
  basename,
  extname,
};
