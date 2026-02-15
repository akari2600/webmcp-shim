#!/usr/bin/env node
// MCP server that proxies tools from the bridge server.
//
// Run the bridge server first (npm run demo), then point Claude Code
// or Cursor at this script. It polls the bridge for tool changes and
// forwards execute calls over HTTP.
//
// Usage:
//   node examples/mcp-server.mjs [--bridge-url http://localhost:3001]

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const BRIDGE_URL = process.argv.includes("--bridge-url")
  ? process.argv[process.argv.indexOf("--bridge-url") + 1]
  : (process.env.BRIDGE_URL || "http://localhost:3001");

const POLL_INTERVAL = 2000;

const server = new McpServer({
  name: "webmcp-bridge",
  version: "0.1.0",
});

// ---- State ----

let knownTools = [];       // tool defs from the bridge
let registered = new Set(); // names we've registered with the MCP server

// ---- Poll the bridge for tool changes ----

async function fetchTools() {
  try {
    const res = await fetch(`${BRIDGE_URL}/tools`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function executeTool(name, input) {
  const res = await fetch(`${BRIDGE_URL}/tools/${encodeURIComponent(name)}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Bridge returned ${res.status}`);
  }
  return await res.json();
}

function syncTools(tools) {
  if (!tools) return;

  const names = new Set(tools.map((t) => t.name));

  // Check if the tool set actually changed
  if (
    names.size === registered.size &&
    [...names].every((n) => registered.has(n))
  ) {
    return;
  }

  knownTools = tools;
  registered = names;

  // Log tool changes to stderr (stdout is the MCP transport)
  const list = tools.map((t) => t.name).join(", ");
  process.stderr.write(`[mcp-server] Tools synced: [${list}]\n`);
}

// Register a catch-all tool handler via the low-level API.
// We re-register tools each poll cycle by building the tool list dynamically.
// The MCP SDK's server.tool() is static, so instead we use setRequestHandler.
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

server.server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: knownTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
    })),
  };
});

server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const result = await executeTool(name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ---- Start ----

async function main() {
  // Initial fetch
  const tools = await fetchTools();
  if (tools) {
    syncTools(tools);
  } else {
    process.stderr.write(
      `[mcp-server] Warning: could not reach bridge at ${BRIDGE_URL}. ` +
      `Make sure the bridge server is running (npm run demo).\n`
    );
  }

  // Start polling in the background
  setInterval(async () => {
    const tools = await fetchTools();
    syncTools(tools);
  }, POLL_INTERVAL);

  // Connect MCP over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[mcp-server] Connected (bridge: ${BRIDGE_URL})\n`);
}

main().catch((err) => {
  process.stderr.write(`[mcp-server] Fatal: ${err.message}\n`);
  process.exit(1);
});
