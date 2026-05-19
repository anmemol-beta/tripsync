// Minimal in-memory Db stub for unit tests.
// Replaces MongoMemoryServer to avoid network access for binary download.
// Supports: findOne, find, insertOne, insertMany, updateOne (upsert/$set/$setOnInsert/$push),
//           aggregate (match+group pipeline), countDocuments.

import type { Db } from "mongodb";

type PlainDoc = Record<string, unknown>;

function matchesFilter(doc: PlainDoc, filter: PlainDoc): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (doc[k] !== v) return false;
  }
  return true;
}

function setPath(obj: PlainDoc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: PlainDoc = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] == null) cur[p] = {};
    cur = cur[p] as PlainDoc;
  }
  cur[parts[parts.length - 1]!] = value;
}

function pushPath(obj: PlainDoc, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: PlainDoc = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (typeof cur[p] !== "object" || cur[p] == null) cur[p] = {};
    cur = cur[p] as PlainDoc;
  }
  const last = parts[parts.length - 1]!;
  if (!Array.isArray(cur[last])) cur[last] = [];
  (cur[last] as unknown[]).push(value);
}

class MemCollection<T extends PlainDoc> {
  private docs: T[] = [];

  async findOne(filter: Partial<T>): Promise<T | null> {
    return this.docs.find((d) => matchesFilter(d as PlainDoc, filter as PlainDoc)) ?? null;
  }

  find(filter?: Partial<T>) {
    const matched = filter
      ? this.docs.filter((d) => matchesFilter(d as PlainDoc, filter as PlainDoc))
      : [...this.docs];
    return { toArray: async () => matched };
  }

  async insertOne(doc: T): Promise<{ insertedId: unknown }> {
    this.docs.push(JSON.parse(JSON.stringify(doc)) as T);
    return { insertedId: (doc as PlainDoc)["_id"] };
  }

  async insertMany(docs: T[]): Promise<void> {
    for (const doc of docs) this.docs.push(JSON.parse(JSON.stringify(doc)) as T);
  }

  async updateOne(
    filter: Partial<T>,
    update: PlainDoc,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const idx = this.docs.findIndex((d) =>
      matchesFilter(d as PlainDoc, filter as PlainDoc),
    );
    if (idx === -1) {
      if (options?.upsert) {
        const newDoc: PlainDoc = { ...(filter as PlainDoc) };
        const $set = update["$set"] as PlainDoc | undefined;
        const $setOnInsert = update["$setOnInsert"] as PlainDoc | undefined;
        const $push = update["$push"] as PlainDoc | undefined;
        if ($set) for (const [k, v] of Object.entries($set)) setPath(newDoc, k, v);
        if ($setOnInsert) for (const [k, v] of Object.entries($setOnInsert)) setPath(newDoc, k, v);
        if ($push) for (const [k, v] of Object.entries($push)) pushPath(newDoc, k, v);
        this.docs.push(newDoc as T);
        return { matchedCount: 0, modifiedCount: 0 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }
    const doc = this.docs[idx]! as PlainDoc;
    const $set = update["$set"] as PlainDoc | undefined;
    const $push = update["$push"] as PlainDoc | undefined;
    if ($set) for (const [k, v] of Object.entries($set)) setPath(doc, k, v);
    if ($push) for (const [k, v] of Object.entries($push)) pushPath(doc, k, v);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  aggregate<R>(pipeline: PlainDoc[]) {
    let docs: PlainDoc[] = this.docs.map((d) => ({ ...(d as PlainDoc) }));
    for (const stage of pipeline) {
      if ("$match" in stage) {
        const f = stage["$match"] as PlainDoc;
        docs = docs.filter((d) => matchesFilter(d, f));
      } else if ("$group" in stage) {
        const spec = stage["$group"] as PlainDoc;
        const rawKey = spec["_id"] as string;
        const groupField = rawKey.startsWith("$") ? rawKey.slice(1) : rawKey;
        const groups = new Map<unknown, PlainDoc>();
        for (const doc of docs) {
          const gv = doc[groupField];
          if (!groups.has(gv)) groups.set(gv, { _id: gv });
          const g = groups.get(gv)!;
          for (const [out, accSpec] of Object.entries(spec)) {
            if (out === "_id") continue;
            const acc = accSpec as PlainDoc;
            if ("$sum" in acc) {
              g[out] = ((g[out] as number | undefined) ?? 0) + (acc["$sum"] as number);
            } else if ("$addToSet" in acc) {
              const srcField = (acc["$addToSet"] as string).slice(1);
              if (!Array.isArray(g[out])) g[out] = [];
              const arr = g[out] as unknown[];
              const val = doc[srcField];
              if (!arr.includes(val)) arr.push(val);
            }
          }
        }
        docs = [...groups.values()];
      }
    }
    return { toArray: async () => docs as R[] };
  }

  async countDocuments(filter?: Partial<T>): Promise<number> {
    if (!filter) return this.docs.length;
    return this.docs.filter((d) => matchesFilter(d as PlainDoc, filter as PlainDoc)).length;
  }
}

class MemDb {
  private cols = new Map<string, MemCollection<PlainDoc>>();

  collection<T extends PlainDoc>(name: string): MemCollection<T> {
    if (!this.cols.has(name)) this.cols.set(name, new MemCollection<PlainDoc>());
    return this.cols.get(name) as unknown as MemCollection<T>;
  }
}

export function createMemDb(): Db {
  return new MemDb() as unknown as Db;
}
