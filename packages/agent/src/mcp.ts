import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

type Json = Record<string, unknown>;

type McpResponse = {
  id?: number;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    structuredContent?: Json;
    isError?: boolean;
  };
  error?: { message?: string };
};

export type MongoMcpClientOptions = {
  connectionString: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
};

export class MongoMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdout = "";
  private requestId = 0;
  private readonly pending = new Map<number, (message: McpResponse) => void>();
  private readonly options: Required<MongoMcpClientOptions>;
  private ready: Promise<void> | null = null;

  constructor(options: MongoMcpClientOptions) {
    this.options = {
      command: options.command ?? "npx",
      args: options.args ?? ["-y", "mongodb-mcp-server@latest"],
      timeoutMs: options.timeoutMs ?? 20_000,
      connectionString: options.connectionString,
    };
  }

  async connect(): Promise<void> {
    if (this.ready) return this.ready;

    this.child = spawn(this.options.command, this.options.args, {
      env: {
        ...process.env,
        MDB_MCP_CONNECTION_STRING: this.options.connectionString,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (data) => this.handleStdout(String(data)));

    this.ready = (async () => {
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "trippo-agent-api", version: "0.1.0" },
      });
      this.notify("notifications/initialized");
    })();
    return this.ready;
  }

  async close(): Promise<void> {
    this.child?.kill("SIGTERM");
    this.child = null;
    this.ready = null;
  }

  async callTool<T = Json>(name: string, args: Json): Promise<T> {
    await this.connect();
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) throw new Error(response.error.message ?? `MCP ${name} failed`);
    if (response.result?.isError) throw new Error(this.textContent(response));
    return {
      structuredContent: response.result?.structuredContent,
      text: this.textContent(response),
      documents: this.extractDocuments(response),
    } as T;
  }

  async find<T>(database: string, collection: string, filter: Json, options: Json = {}): Promise<T[]> {
    const result = await this.callTool<{ documents: T[] }>("find", {
      database,
      collection,
      filter,
      ...options,
    });
    return result.documents;
  }

  async aggregate<T>(
    database: string,
    collection: string,
    pipeline: Json[],
    options: Json = {},
  ): Promise<T[]> {
    const result = await this.callTool<{ documents: T[] }>("aggregate", {
      database,
      collection,
      pipeline,
      ...options,
    });
    return result.documents;
  }

  async count(database: string, collection: string, query: Json): Promise<number> {
    const result = await this.callTool<{ structuredContent?: Json; text: string }>("count", {
      database,
      collection,
      query,
    });
    const structuredCount = result.structuredContent?.["count"];
    if (typeof structuredCount === "number") return structuredCount;
    const match = result.text.match(/(?:Counted|Found)\s+`?(\d+)`?/i);
    return match ? Number(match[1]) : 0;
  }

  async insertOne(database: string, collection: string, document: Json): Promise<{ insertedId: string }> {
    const result = await this.callTool<{ structuredContent?: Json }>("insert-many", {
      database,
      collection,
      documents: [document],
    });
    const ids = result.structuredContent?.["insertedIds"];
    return { insertedId: Array.isArray(ids) ? String(ids[0]) : String(document["_id"] ?? "") };
  }

  async updateMany(
    database: string,
    collection: string,
    filter: Json,
    update: Json,
    upsert = false,
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedCount: number }> {
    const result = await this.callTool<{ structuredContent?: Json }>("update-many", {
      database,
      collection,
      filter,
      update,
      upsert,
    });
    const structured = result.structuredContent ?? {};
    return {
      matchedCount: Number(structured["matchedCount"] ?? 0),
      modifiedCount: Number(structured["modifiedCount"] ?? 0),
      upsertedCount: Number(structured["upsertedCount"] ?? 0),
    };
  }

  private request(method: string, params: Json = {}): Promise<McpResponse> {
    if (!this.child) throw new Error("MongoMcpClient is not connected");
    const id = ++this.requestId;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for MCP ${method}`)),
        this.options.timeoutMs,
      );
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  private notify(method: string, params: Json = {}): void {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private handleStdout(data: string): void {
    this.stdout += data;
    let newlineIndex;
    while ((newlineIndex = this.stdout.indexOf("\n")) >= 0) {
      const line = this.stdout.slice(0, newlineIndex).trim();
      this.stdout = this.stdout.slice(newlineIndex + 1);
      if (!line) continue;
      let message: McpResponse;
      try {
        message = JSON.parse(line) as McpResponse;
      } catch {
        continue;
      }
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    }
  }

  private textContent(response: McpResponse): string {
    return (response.result?.content ?? [])
      .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
      .join("\n");
  }

  private extractDocuments<T>(response: McpResponse): T[] {
    const text = this.textContent(response);
    const match = text.match(/<untrusted-user-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-user-data-[^>]+>/);
    if (!match?.[1]) return [];
    const raw = match[1].trim();
    if (!raw.startsWith("[") && !raw.startsWith("{")) return [];
    const parsed = JSON.parse(raw) as T | T[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
}
