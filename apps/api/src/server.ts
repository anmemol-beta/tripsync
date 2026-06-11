import { serve } from "@hono/node-server";
import { MongoClient } from "mongodb";
import {
  GoogleGeminiClient,
  MongoMcpClient,
  MockGeminiClient,
  VertexEmbeddingClient,
  VertexGeminiClient,
  type GeminiClient,
} from "@tripsync/agent";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) {
    console.error("MONGODB_URI is required to run the server. Tests use mongodb-memory-server.");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const gemini = createGeminiClient();
  const embeddings = createEmbeddingClient();
  const mcp = createMongoMcpClient(uri);
  if (mcp) await mcp.connect();

  const app = buildApp({
    db,
    gemini,
    embeddings,
    vectorSearchIndex: process.env["ATLAS_VECTOR_SEARCH_INDEX"] ?? "trip_memories_vector",
    publicBaseUrl: process.env["PUBLIC_API_BASE_URL"] ?? `http://localhost:${process.env["PORT"] ?? 4000}`,
    ...(mcp ? { mcp, mcpDatabase: db.databaseName } : {}),
  });
  const port = Number(process.env["PORT"] ?? 4000);
  serve({ fetch: app.fetch, port });
  console.log(`tripsync-api listening on :${port}`);

  const shutdown = async (): Promise<void> => {
    await mcp?.close();
    await client.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

function createMongoMcpClient(connectionString: string): MongoMcpClient | undefined {
  const enabled = process.env["MONGODB_MCP_ENABLED"] ?? "true";
  if (enabled === "false") return undefined;
  return new MongoMcpClient({ connectionString });
}

function createGeminiClient(): GeminiClient {
  const provider = process.env["AGENT_PROVIDER"] ?? "vertex";
  if (provider === "mock") {
    return new MockGeminiClient([
      {
        kind: "text",
        text: "Mock mode입니다. 실제 개발 검증은 AGENT_PROVIDER=gemini와 GEMINI_API_KEY로 실행하세요.",
      },
    ]);
  }

  if (provider === "vertex") {
    return new VertexGeminiClient({
      projectId: process.env["GOOGLE_CLOUD_PROJECT"],
      location: process.env["GOOGLE_CLOUD_LOCATION"] ?? "global",
      model: process.env["GEMINI_MODEL"] ?? "gemini-3-flash-preview",
    });
  }

  const apiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_AI_API_KEY"];
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for AGENT_PROVIDER=gemini.");
  }
  return new GoogleGeminiClient({
    apiKey,
    model: process.env["GEMINI_MODEL"] ?? "gemini-3-pro",
  });
}

function createEmbeddingClient(): VertexEmbeddingClient | undefined {
  if ((process.env["VERTEX_EMBEDDINGS_ENABLED"] ?? "true") === "false") return undefined;
  return new VertexEmbeddingClient({
    projectId: process.env["GOOGLE_CLOUD_PROJECT"],
    location: process.env["VERTEX_EMBEDDING_LOCATION"] ?? "us-central1",
    model: process.env["VERTEX_EMBEDDING_MODEL"] ?? "gemini-embedding-001",
    outputDimensionality: Number(process.env["VERTEX_EMBEDDING_DIMENSIONS"] ?? 768),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
