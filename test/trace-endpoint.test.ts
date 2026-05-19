import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { BOSTON_CREW_TRIP_ID, seedBostonCrew } from "@tripsync/seed";
import { MockGeminiClient } from "@tripsync/agent";
import { buildApp } from "../apps/api/src/app.js";
import { createMemDb } from "./utils/memdb.js";

let db: Db;

beforeAll(async () => {
  db = createMemDb();
  await seedBostonCrew(db);
});

describe("GET /trace/:trip_id", () => {
  it("returns empty array before any turn", async () => {
    const gemini = new MockGeminiClient([]);
    const app = buildApp({ db, gemini });
    const res = await app.request(`/trace/${BOSTON_CREW_TRIP_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it("returns structured trace after a happy-path turn", async () => {
    const gemini = new MockGeminiClient([
      {
        kind: "tool_calls",
        calls: [{ name: "find_trip", args: { trip_id: BOSTON_CREW_TRIP_ID } }],
      },
      { kind: "text", text: "도쿄 여행 정보를 찾았어요." },
    ]);
    const app = buildApp({ db, gemini });

    const chatRes = await app.request("/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trip_id: BOSTON_CREW_TRIP_ID,
        author: "seo",
        text: "여행 정보 알려줘",
      }),
    });
    expect(chatRes.status).toBe(200);
    const chatBody = await chatRes.json();
    expect(chatBody.reply).toContain("도쿄");

    const traceRes = await app.request(`/trace/${BOSTON_CREW_TRIP_ID}`);
    expect(traceRes.status).toBe(200);
    const traces = await traceRes.json();
    expect(Array.isArray(traces)).toBe(true);
    expect(traces.length).toBeGreaterThanOrEqual(1);

    const last = traces[traces.length - 1];
    expect(last).toHaveProperty("trip_id", BOSTON_CREW_TRIP_ID);
    expect(Array.isArray(last.calls)).toBe(true);
    expect(last.calls[0]).toMatchObject({ name: "find_trip" });
    expect(last.reply).toBe("도쿄 여행 정보를 찾았어요.");
    expect(typeof last.created_at).toBe("string");
  });
});
