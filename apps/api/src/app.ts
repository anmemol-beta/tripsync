import { Hono } from "hono";
import type { Db } from "mongodb";
import { z } from "zod";
import { COLLECTIONS, type TripDoc } from "@tripsync/schema";
import {
  appendVote,
  runTurn,
  type GeminiClient,
} from "@tripsync/agent";

export type AppDeps = {
  db: Db;
  gemini: GeminiClient;
};

const ChatBody = z.object({
  trip_id: z.string(),
  author: z.string(),
  text: z.string().min(1),
});

const VoteBody = z.object({
  proposal_id: z.string(),
  voter: z.string(),
  option_id: z.string(),
});

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/chat", async (c) => {
    const body = ChatBody.parse(await c.req.json());
    const trace = await runTurn({
      db: deps.db,
      gemini: deps.gemini,
      tripId: body.trip_id,
      author: body.author,
      userText: body.text,
    });
    return c.json({ reply: trace.reply, tool_calls: trace.calls });
  });

  app.post("/vote", async (c) => {
    const body = VoteBody.parse(await c.req.json());
    const result = await appendVote(
      { db: deps.db, now: () => new Date().toISOString() },
      body,
    );
    return c.json(result);
  });

  app.get("/trip/:id", async (c) => {
    const id = c.req.param("id");
    const doc = await deps.db
      .collection<TripDoc>(COLLECTIONS.trips)
      .findOne({ _id: id });
    if (!doc) return c.json({ error: "not_found" }, 404);
    return c.json(doc);
  });

  return app;
}
