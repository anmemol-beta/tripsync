import { GoogleAuth } from "google-auth-library";
import { MongoClient } from "mongodb";

const uri = process.env["MONGODB_URI"];
const database = process.env["MONGODB_DATABASE"] ?? "trippo_agent";
const projectId = process.env["GOOGLE_CLOUD_PROJECT"] ?? "theta-bliss-486220-s1";
const location = process.env["VERTEX_EMBEDDING_LOCATION"] ?? "us-central1";
const model = process.env["VERTEX_EMBEDDING_MODEL"] ?? "gemini-embedding-001";
const dimensions = Number(process.env["VERTEX_EMBEDDING_DIMENSIONS"] ?? 768);
const indexName = process.env["ATLAS_VECTOR_SEARCH_INDEX"] ?? "trip_memories_vector";

if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const tripId = "trip_tokyo_2026_05";
const createdAt = "2026-05-01T12:00:00.000Z";

const memories = [
  {
    _id: "mem_tokyo_quiet_yoyogi",
    trip_id: tripId,
    user_handle: "seo",
    title: "Quiet Yoyogi morning walk",
    memory_text:
      "Rated 5. Quiet morning walk near Yoyogi Park. Not crowded, soft light, easy cinematic video clips, good recovery time between busy Tokyo stops.",
    rating: 5,
    tags: ["quiet", "morning", "cinematic", "not_crowded", "park"],
    location: "Yoyogi Park, Tokyo",
    companions: ["seo", "jamie", "min"],
    media_refs: ["asset_yoyogi_morning_01"],
    created_at: createdAt,
  },
  {
    _id: "mem_tokyo_daikanyama_cafe",
    trip_id: tripId,
    user_handle: "jamie",
    title: "Daikanyama cafe street",
    memory_text:
      "Rated 5. Daikanyama side streets felt calm and stylish. Great cafe b-roll, fewer tourists, and good walking shots for a relaxed travel recap.",
    rating: 5,
    tags: ["cafe", "quiet", "stylish", "walking", "video"],
    location: "Daikanyama, Tokyo",
    companions: ["seo", "jamie"],
    media_refs: ["asset_daikanyama_cafe_01"],
    created_at: createdAt,
  },
  {
    _id: "mem_tokyo_shibuya_crossing",
    trip_id: tripId,
    user_handle: "min",
    title: "Shibuya crossing overload",
    memory_text:
      "Rated 2. Shibuya Crossing was iconic but too crowded and stressful. Good for one quick establishing shot, not good for long relaxed filming.",
    rating: 2,
    tags: ["crowded", "iconic", "stressful", "quick_shot"],
    location: "Shibuya Crossing, Tokyo",
    companions: ["seo", "jamie", "min"],
    media_refs: ["asset_shibuya_crossing_01"],
    created_at: createdAt,
  },
  {
    _id: "mem_tokyo_nakameguro_river",
    trip_id: tripId,
    user_handle: "seo",
    title: "Nakameguro riverside golden hour",
    memory_text:
      "Rated 4. Nakameguro riverside at golden hour was easy to walk, visually warm, and better for couple or friend group video than packed tourist landmarks.",
    rating: 4,
    tags: ["golden_hour", "riverside", "walking", "cinematic"],
    location: "Nakameguro, Tokyo",
    companions: ["seo", "min"],
    media_refs: ["asset_nakameguro_river_01"],
    created_at: createdAt,
  },
  {
    _id: "mem_tokyo_shinjuku_gyoen",
    trip_id: tripId,
    user_handle: "jamie",
    title: "Shinjuku Gyoen slow afternoon",
    memory_text:
      "Rated 5. Shinjuku Gyoen was spacious and calm in the afternoon. Good place to film slow scenes, picnic cuts, and a peaceful contrast to nightlife.",
    rating: 5,
    tags: ["park", "spacious", "afternoon", "peaceful", "video"],
    location: "Shinjuku Gyoen, Tokyo",
    companions: ["jamie", "min"],
    media_refs: ["asset_shinjuku_gyoen_01"],
    created_at: createdAt,
  },
];

async function embed(text, taskType) {
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
      instances: [{ content: text, task_type: taskType }],
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
    for (const memory of memories) {
      const embedding = await embed(memory.memory_text, "RETRIEVAL_DOCUMENT");
      await collection.replaceOne(
        { _id: memory._id },
        { ...memory, embedding, embedding_model: `${model}:${dimensions}` },
        { upsert: true },
      );
    }

    try {
      await collection.createSearchIndex({
        name: indexName,
        type: "vectorSearch",
        definition: {
          fields: [
            { type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine" },
            { type: "filter", path: "trip_id" },
          ],
        },
      });
    } catch (err) {
      if (!String(err).includes("already exists")) {
        console.warn(`Vector index creation skipped: ${err.message}`);
      }
    }

    const count = await collection.countDocuments({ trip_id: tripId });
    console.log(JSON.stringify({ database, collection: "trip_memories", trip_id: tripId, count, index: indexName }, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
