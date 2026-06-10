import { GoogleAuth } from "google-auth-library";
import { MongoClient } from "mongodb";

const uri = process.env["MONGODB_URI"];
const database = process.env["MONGODB_DATABASE"] ?? "trippo_agent";
const projectId = process.env["GOOGLE_CLOUD_PROJECT"] ?? "theta-bliss-486220-s1";
const location = process.env["VERTEX_EMBEDDING_LOCATION"] ?? "us-central1";
const model = process.env["VERTEX_EMBEDDING_MODEL"] ?? "gemini-embedding-001";
const dimensions = Number(process.env["VERTEX_EMBEDDING_DIMENSIONS"] ?? 768);
const indexName = process.env["ATLAS_VECTOR_SEARCH_INDEX"] ?? "trip_memories_vector";
const query = process.env["VECTOR_SMOKE_QUERY"] ?? "quiet Tokyo plan for cinematic travel video without crowds";

if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

async function embed(text) {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const accessToken = typeof token === "string" ? token : token.token;
  if (!accessToken) throw new Error("Failed to load ADC access token.");

  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ content: text, task_type: "RETRIEVAL_QUERY" }],
      parameters: { outputDimensionality: dimensions },
    }),
  });
  if (!res.ok) throw new Error(`Embedding failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  const body = await res.json();
  const values = body.predictions?.[0]?.embeddings?.values ?? body.predictions?.[0]?.values;
  if (!values?.length) throw new Error("Embedding response did not include values.");
  return values;
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const collection = client.db(database).collection("trip_memories");
    await waitForVectorIndex(collection);
    const queryVector = await embed(query);
    const results = await collection
      .aggregate([
        {
          $vectorSearch: {
            index: indexName,
            path: "embedding",
            queryVector,
            numCandidates: 50,
            limit: 5,
            filter: { trip_id: "trip_tokyo_2026_05" },
          },
        },
        { $match: { rating: { $gte: 4 } } },
        {
          $project: {
            _id: 1,
            title: 1,
            rating: 1,
            location: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ])
      .toArray();

    if (results.length === 0) throw new Error("Vector Search returned no rated memories.");
    console.log(JSON.stringify({ query, results }, null, 2));
  } finally {
    await client.close();
  }
}

async function waitForVectorIndex(collection) {
  const deadline = Date.now() + Number(process.env["VECTOR_INDEX_WAIT_MS"] ?? 120000);
  while (Date.now() < deadline) {
    for await (const index of collection.listSearchIndexes()) {
      if (index.name === indexName && index.queryable) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Vector Search index ${indexName} was not queryable before timeout.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
