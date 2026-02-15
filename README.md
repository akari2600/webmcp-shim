# webmcp-shim

A polyfill for the [Web Model Context Protocol](https://webmachinelearning.github.io/webmcp/) `navigator.modelContext` API.

## Why

The WebMCP spec defines a browser-native way for pages to register tools that AI agents can discover and invoke. No browser ships it yet. This shim lets page code adopt the API today, and includes a bridge server so external LLM clients — Claude Code, Cursor, or anything that can call HTTP — can discover and execute those tools.

## How it works

```
Browser page              Shim              Bridge server        MCP server         LLM client
  │                        │                     │                   │                  │
  │─ registerTool(tool) ──→│                     │                   │                  │
  │                        │── tools (WS) ──────→│                   │                  │
  │                        │                     │←── GET /tools ────│                  │
  │                        │                     │                   │←─ list_tools ────│
  │                        │                     │                   │── tool defs ────→│
  │                        │                     │                   │                  │
  │                        │                     │                   │←─ call_tool ─────│
  │                        │                     │←── POST /execute ─│                  │
  │                        │←── execute (WS) ────│                   │                  │
  │← execute callback ────│                     │                   │                  │
  │─ result ──────────────→│── result (WS) ─────→│── result ────────→│── result ───────→│
```

1. A page loads the shim and calls `navigator.modelContext.registerTool()`
2. The bridge server picks up registered tools over WebSocket
3. The MCP server polls the bridge and exposes tools to LLM clients via the Model Context Protocol
4. When the LLM calls a tool, the request flows back through the MCP server → bridge → page

## Quick start

```bash
npm install
npm run build
npm run demo
```

This starts the bridge server on `http://localhost:3001`. Open that URL in a browser — the demo page connects and registers two tools (`get_weather`, `add_to_cart`).

Then from another terminal:

```bash
# List available tools
curl http://localhost:3001/tools

# Execute a tool
curl -X POST http://localhost:3001/tools/get_weather/execute \
  -H "Content-Type: application/json" \
  -d '{"city": "Tokyo"}'
```

### Adding the MCP server to your LLM client

The bridge server exposes tools over HTTP. The included MCP server (`examples/mcp-server.mjs`) wraps those HTTP endpoints in the [Model Context Protocol](https://modelcontextprotocol.io/) so Claude Code, Cursor, and other MCP-compatible clients can pick up tools automatically.

**1. Start the bridge server** (keep this running):

```bash
npm run demo
```

**2. Open the demo page** at `http://localhost:3001` in a browser so tools get registered.

**3. Add the MCP server to your client config:**

**Claude Code** — add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "webmcp": {
      "command": "node",
      "args": ["/absolute/path/to/webmcp-shim/examples/mcp-server.mjs"]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "webmcp": {
      "command": "node",
      "args": ["/absolute/path/to/webmcp-shim/examples/mcp-server.mjs"]
    }
  }
}
```

Replace `/absolute/path/to/webmcp-shim` with the actual path to this repo.

If the bridge is on a different host or port, pass `--bridge-url`:

```json
{
  "mcpServers": {
    "webmcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/webmcp-shim/examples/mcp-server.mjs",
        "--bridge-url", "http://192.168.1.50:3001"
      ]
    }
  }
}
```

Once configured, any tools the page registers via `navigator.modelContext.registerTool()` appear as callable tools in your LLM client. The MCP server polls the bridge every 2 seconds for changes.

## Install

```
npm install webmcp-shim
```

## Build from source

```bash
git clone <repo-url>
cd webmcp-shim
npm install
npm run build        # compiles to dist/
npm run typecheck    # type-check without emitting
```

## Usage

### As a polyfill

Import the package to install `navigator.modelContext` globally:

```ts
import "webmcp-shim";
```

### Registering tools (page code)

```ts
navigator.modelContext.registerTool({
  name: "get_weather",
  description: "Get the current weather for a city",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  execute(input) {
    return { temperature: 22, unit: "C", city: input.city };
  },
});
```

### Consumer API (non-spec, for chat clients)

If you're building an in-browser chat client instead of using the bridge server, you can consume tools directly:

```ts
navigator.modelContext.addEventListener("change", () => {
  const tools = navigator.modelContext.getTools();
  // [{ name, description, input_schema }] — Anthropic-compatible
});

const result = await navigator.modelContext.executeTool("get_weather", {
  city: "Tokyo",
});
```

## API reference

### Spec surface

| Method | Description |
|---|---|
| `registerTool(tool)` | Register a single tool. Throws on duplicate name or missing fields. |
| `unregisterTool(name)` | Remove a tool by name. |
| `provideContext(options?)` | Bulk-register tools, replacing any existing ones. |
| `clearContext()` | Remove all tools. |

### Consumer API

| Method | Description |
|---|---|
| `getTools()` | Returns tools as `{ name, description, input_schema }[]`. |
| `executeTool(name, input)` | Calls the tool's `execute` callback. Returns a promise. |
| `addEventListener('change', fn)` | Fires when tools change. |
| `removeEventListener('change', fn)` | Remove a change listener. |

### Bridge server HTTP API

| Endpoint | Description |
|---|---|
| `GET /tools` | Returns the current tool list as JSON. |
| `POST /tools/:name/execute` | Execute a tool. Send JSON body matching the tool's input schema. |

## Browser support

The shim targets ES2020. It works in all modern browsers:

- Chrome/Edge 80+
- Firefox 74+
- Safari 14+

The bridge server requires Node.js 18+.

## Spec reference

- [WebMCP specification](https://webmachinelearning.github.io/webmcp/) — W3C Web Machine Learning Working Group

## License

[MIT](LICENSE)
