/**
 * Build-time stubs for @modelcontextprotocol/sdk.
 *
 * agent-do statically imports the MCP SDK at the top of its loop.ts
 * (to support optional server mounting via config.mcpServers). The
 * SDK in turn imports Node-only primitives (`node:child_process`,
 * `node:fs`) via its stdio transport. Bundling that into a service
 * worker aborts esbuild.
 *
 * We don't use MCP from the extension — the CRX doesn't have a way
 * to spawn subprocesses anyway — so we replace the SDK with a shim.
 * Every export is a class that throws if anyone ever tries to
 * instantiate it. As long as config.mcpServers stays undefined, the
 * stubs are never touched and runAgentLoop's early-exit path fires.
 *
 * See build.js for the alias wiring.
 */

const UNSUPPORTED =
  'MCP servers are not supported in the Chrome extension runtime (no subprocess spawning). Leave AgentConfig.mcpServers undefined.';

export class Client {
  constructor() {
    throw new Error(UNSUPPORTED);
  }
}

export class StdioClientTransport {
  constructor() {
    throw new Error(UNSUPPORTED);
  }
}

export class SSEClientTransport {
  constructor() {
    throw new Error(UNSUPPORTED);
  }
}

export class StreamableHTTPClientTransport {
  constructor() {
    throw new Error(UNSUPPORTED);
  }
}
