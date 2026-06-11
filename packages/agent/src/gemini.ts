import { GoogleAuth } from "google-auth-library";
import { zodToJsonSchema } from "zod-to-json-schema";
import { TOOL_SCHEMAS, type ToolName } from "./tools.js";

export type FunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
};

export type FunctionResponse = {
  id: string;
  name: string;
  result: unknown;
};

export type Turn =
  | { kind: "user"; text: string; author: string }
  | { kind: "model_tool_calls"; calls: FunctionCall[] }
  | { kind: "tool_responses"; responses: FunctionResponse[] }
  | { kind: "model_text"; text: string };

export type GenerateInput = {
  system: string;
  history: Turn[];
  toolNames: string[];
};

export type GenerateOutput =
  | { kind: "tool_calls"; calls: FunctionCall[] }
  | { kind: "text"; text: string };

export interface GeminiClient {
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

type JsonObject = Record<string, unknown>;

type GeminiPart =
  | { text: string; thoughtSignature?: string }
  | { functionCall: { id?: string; name: string; args?: JsonObject }; thoughtSignature?: string }
  | { functionResponse: { id?: string; name: string; response: JsonObject } };

type GeminiContent = {
  role: "user" | "model" | "function";
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
  }>;
};

export type GoogleGeminiClientOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
};

export type VertexGeminiClientOptions = {
  projectId?: string;
  location?: string;
  model?: string;
};

export class GoogleGeminiClient implements GeminiClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(options: GoogleGeminiClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-3-pro";
    this.endpoint = options.endpoint ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const url = `${this.endpoint}/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: turnsToContents(input.history),
        ...(input.toolNames.length > 0
          ? { tools: [{ functionDeclarations: input.toolNames.map(functionDeclaration) }] }
          : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 500)}`);
    }

    const json = (await res.json()) as GeminiResponse;
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.flatMap((part, index) => {
      if (!("functionCall" in part)) return [];
      return [
        {
          id: part.functionCall.id ?? `gemini_call_${Date.now().toString(36)}_${index}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
        },
      ];
    });
    if (calls.length > 0) return { kind: "tool_calls", calls };

    const text = parts
      .flatMap((part) => ("text" in part ? [part.text] : []))
      .join("\n")
      .trim();
    return { kind: "text", text: text || "Done." };
  }
}

export class VertexGeminiClient implements GeminiClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  private readonly projectId?: string;
  private readonly location: string;
  private readonly model: string;

  constructor(options: VertexGeminiClientOptions = {}) {
    this.projectId = options.projectId;
    this.location = options.location ?? "global";
    this.model = options.model ?? "gemini-3-pro-preview";
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const projectId = this.projectId ?? (await this.auth.getProjectId());
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token.token;
    if (!accessToken) throw new Error("VertexGeminiClient: failed to load ADC access token");

    const host =
      this.location === "global"
        ? "aiplatform.googleapis.com"
        : `${this.location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${projectId}/locations/${this.location}/publishers/google/models/${this.model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: turnsToContents(input.history),
        ...(input.toolNames.length > 0
          ? { tools: [{ functionDeclarations: input.toolNames.map(functionDeclaration) }] }
          : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Vertex Gemini request failed (${res.status}): ${text.slice(0, 500)}`);
    }

    return parseGeminiResponse((await res.json()) as GeminiResponse);
  }
}

function turnsToContents(history: Turn[]): GeminiContent[] {
  return history.map((turn) => {
    if (turn.kind === "user") {
      return { role: "user", parts: [{ text: `${turn.author}: ${turn.text}` }] };
    }
    if (turn.kind === "model_text") {
      return { role: "model", parts: [{ text: turn.text }] };
    }
    if (turn.kind === "model_tool_calls") {
      return {
        role: "model",
        parts: turn.calls.map((call) => ({
          functionCall: { name: call.name, args: call.args },
          ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
        })),
      };
    }
    return {
      role: "function",
      parts: turn.responses.map((response) => ({
        functionResponse: {
          name: response.name,
          response: { result: response.result },
        },
      })),
    };
  });
}

function functionDeclaration(name: string): JsonObject {
  return {
    name,
    description: toolDescription(name),
    parameters: parametersForTool(name),
  };
}

function parametersForTool(name: string): JsonObject {
  if (!(name in TOOL_SCHEMAS)) {
    return { type: "object", properties: {}, additionalProperties: true };
  }
  const schema = TOOL_SCHEMAS[name as ToolName];
  const converted = zodToJsonSchema(schema, { target: "openApi3" }) as JsonObject;
  const { $schema: _schema, definitions: _definitions, ...rest } = converted;
  return sanitizeVertexSchema(rest) as JsonObject;
}

function sanitizeVertexSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeVertexSchema);
  if (!value || typeof value !== "object") return value;

  const input = value as JsonObject;
  if (Array.isArray(input["anyOf"])) {
    const options = input["anyOf"] as unknown[];
    const literalValues = options.flatMap((option) => {
      if (!option || typeof option !== "object") return [];
      const enumValue = (option as JsonObject)["enum"];
      return Array.isArray(enumValue) && enumValue.length === 1 ? [enumValue[0]] : [];
    });
    if (literalValues.length === options.length && literalValues.length > 0) {
      const allStrings = literalValues.every((item) => typeof item === "string");
      if (allStrings) return { type: "string", enum: literalValues };
      const allNumbers = literalValues.every((item) => typeof item === "number");
      if (allNumbers) {
        return {
          type: "number",
          description: `Allowed values: ${literalValues.join(", ")}`,
        };
      }
    }
  }

  const output: JsonObject = {};
  for (const [key, raw] of Object.entries(input)) {
    if (
      key === "$schema" ||
      key === "definitions" ||
      key === "exclusiveMinimum" ||
      key === "exclusiveMaximum" ||
      key === "additionalProperties"
    ) {
      continue;
    }
    if (key === "const") {
      if (typeof raw === "string") output["enum"] = [raw];
      continue;
    }
    output[key] = sanitizeVertexSchema(raw);
  }
  return output;
}

function parseGeminiResponse(json: GeminiResponse): GenerateOutput {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const calls = parts.flatMap((part, index) => {
    if (!("functionCall" in part)) return [];
    return [
        {
          id: part.functionCall.id ?? `gemini_call_${Date.now().toString(36)}_${index}`,
          name: part.functionCall.name,
          args: part.functionCall.args ?? {},
          thoughtSignature: part.thoughtSignature,
        },
      ];
  });
  if (calls.length > 0) return { kind: "tool_calls", calls };

  const text = parts
    .flatMap((part) => ("text" in part ? [part.text] : []))
    .join("\n")
    .trim();
  return { kind: "text", text: text || "Done." };
}

function toolDescription(name: string): string {
  const descriptions: Record<string, string> = {
    find_trip: "Read the current trip document from MongoDB.",
    list_members: "List the members of the trip group.",
    search_hotels: "Find hotel candidates before inserting a proposal.",
    search_flights: "Find flight candidates before inserting a proposal.",
    search_activities: "Find activity candidates before inserting a proposal.",
    search_semantic_memories:
      "Retrieve highly rated, semantically similar trip memories from MongoDB Atlas Vector Search.",
    insert_proposal: "Persist a voteable proposal with options to MongoDB.",
    append_vote: "Persist or update one member's vote.",
    tally_votes: "Aggregate MongoDB votes and return quorum and winner information.",
    update_trip_decision: "Persist the winning option into the trip decisions field.",
    append_history: "Append an auditable trip history event after state changes.",
    create_travel_video: "Persist a vertical travel recap video brief with concrete scenes.",
  };
  return descriptions[name] ?? "Tripsync tool.";
}

export type MockStep =
  | { kind: "tool_calls"; calls: Array<{ name: string; args: Record<string, unknown> }> }
  | { kind: "text"; text: string };

export class MockGeminiClient implements GeminiClient {
  private steps: MockStep[];
  private idCounter = 0;

  constructor(steps: MockStep[]) {
    this.steps = [...steps];
  }

  async generate(_input: GenerateInput): Promise<GenerateOutput> {
    const step = this.steps.shift();
    if (!step) {
      throw new Error("MockGeminiClient: no more scripted steps");
    }
    if (step.kind === "tool_calls") {
      return {
        kind: "tool_calls",
        calls: step.calls.map((c) => ({
          id: `mock_call_${++this.idCounter}`,
          name: c.name,
          args: c.args,
        })),
      };
    }
    return { kind: "text", text: step.text };
  }
}
