import { spawn } from "node:child_process";

const connectionString = process.env["MDB_MCP_CONNECTION_STRING"] ?? process.env["MONGODB_URI"];
const database = process.env["MCP_SMOKE_DATABASE"] ?? "trippo_agent";
const tripId = process.env["MCP_SMOKE_TRIP_ID"] ?? "trip_tokyo_2026_05";

if (!connectionString) {
  console.error("MDB_MCP_CONNECTION_STRING or MONGODB_URI is required.");
  process.exit(1);
}

const child = spawn("npx", ["-y", "mongodb-mcp-server@latest", "--readOnly"], {
  env: { ...process.env, MDB_MCP_CONNECTION_STRING: connectionString },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
const pending = new Map();

child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stderr.on("data", (data) => {
  const text = String(data);
  if (text.includes("warn deprecated")) return;
  process.stderr.write(text);
});

child.stdout.on("data", (data) => {
  stdout += data;
  let newlineIndex;
  while ((newlineIndex = stdout.indexOf("\n")) >= 0) {
    const line = stdout.slice(0, newlineIndex).trim();
    stdout = stdout.slice(newlineIndex + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

let requestId = 0;

function request(method, params = {}) {
  const payload = { jsonrpc: "2.0", id: ++requestId, method, params };
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 20_000);
    pending.set(payload.id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

function textContent(response) {
  return (response.result?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n");
}

try {
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "trippo-mcp-smoke", version: "0.1.0" },
  });
  notify("notifications/initialized");

  const toolsResponse = await request("tools/list");
  const tools = toolsResponse.result?.tools ?? [];
  const toolNames = tools.map((tool) => tool.name);
  if (!toolNames.includes("find")) {
    throw new Error(`MongoDB MCP find tool not available. Tools: ${toolNames.join(", ")}`);
  }

  const findResponse = await request("tools/call", {
    name: "find",
    arguments: {
      database,
      collection: "trips",
      filter: { _id: tripId },
      limit: 1,
    },
  });

  if (findResponse.result?.isError) {
    throw new Error(textContent(findResponse));
  }

  const findText = textContent(findResponse);
  if (!findText.includes(tripId)) {
    throw new Error(`Trip ${tripId} not found through MongoDB MCP.`);
  }

  console.log(
    JSON.stringify(
      {
        server: init.result?.serverInfo,
        tool_count: tools.length,
        verified_tool: "find",
        database,
        collection: "trips",
        trip_id: tripId,
      },
      null,
      2,
    ),
  );
} finally {
  child.kill("SIGTERM");
}
