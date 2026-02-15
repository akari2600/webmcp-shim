// Bridge server: connects a browser page (WebSocket) to external LLM clients (HTTP).
//
// Browser page registers tools via the shim → sends them here over WebSocket.
// External clients call GET /tools and POST /tools/:name/execute over HTTP.
//
// Requires: npm install (ws is a devDependency)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

// ---- State ----

let tools = [];        // Current tool defs from the page
let pageSocket = null; // WebSocket connection to the browser page
let nextId = 1;
const pending = new Map(); // id → { resolve, reject } for in-flight execute calls

// ---- HTTP server ----

const server = createServer(async (req, res) => {
  // Serve the demo page
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(join(__dirname, "demo.html")));
    return;
  }

  // Serve the built shim for the page to import
  if (req.method === "GET" && req.url.startsWith("/dist/")) {
    try {
      const file = readFileSync(join(__dirname, "..", req.url));
      const ct = req.url.endsWith(".map") ? "application/json" : "application/javascript";
      res.writeHead(200, { "Content-Type": ct });
      res.end(file);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
    return;
  }

  // ---- API: list tools ----
  if (req.method === "GET" && req.url === "/tools") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(tools, null, 2));
    return;
  }

  // ---- API: execute tool ----
  const execMatch = req.method === "POST" && req.url.match(/^\/tools\/([^/]+)\/execute$/);
  if (execMatch) {
    const name = decodeURIComponent(execMatch[1]);

    if (!pageSocket) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No browser page connected" }));
      return;
    }

    if (!tools.find((t) => t.name === name)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `Tool "${name}" not found` }));
      return;
    }

    // Read request body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON body" }));
      return;
    }

    // Send execute request to the page via WebSocket
    const id = nextId++;
    pageSocket.send(JSON.stringify({ type: "execute", id, name, input }));

    try {
      const result = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error("Tool execution timed out"));
          }
        }, 30_000);
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ---- WebSocket server (same port) ----

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[bridge] Browser page connected");
  pageSocket = ws;

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === "tools") {
      tools = msg.tools;
      console.log(`[bridge] Tools updated: [${tools.map((t) => t.name).join(", ")}]`);
    }

    if (msg.type === "result" && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg.result);
      pending.delete(msg.id);
    }

    if (msg.type === "error" && pending.has(msg.id)) {
      pending.get(msg.id).reject(new Error(msg.error));
      pending.delete(msg.id);
    }
  });

  ws.on("close", () => {
    console.log("[bridge] Browser page disconnected");
    if (pageSocket === ws) {
      pageSocket = null;
      tools = [];
    }
  });
});

server.listen(PORT, () => {
  console.log(`[bridge] Listening on http://localhost:${PORT}`);
  console.log(`[bridge] Open http://localhost:${PORT} in a browser to connect the page`);
  console.log(`[bridge] Then use the HTTP API from your LLM client:`);
  console.log(`         GET  http://localhost:${PORT}/tools`);
  console.log(`         POST http://localhost:${PORT}/tools/<name>/execute`);
});
