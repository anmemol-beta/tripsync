import { serve } from "@hono/node-server";
import { MongoClient } from "mongodb";
import { MockGeminiClient } from "@tripsync/agent";
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

  const gemini = new MockGeminiClient([
    { kind: "text", text: "TODO(real-key): swap MockGeminiClient for VertexGeminiClient." },
  ]);

  const app = buildApp({ db, gemini });
  const port = Number(process.env["PORT"] ?? 4000);
  serve({ fetch: app.fetch, port });
  console.log(`tripsync-api listening on :${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
