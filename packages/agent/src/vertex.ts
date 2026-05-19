import type { GeminiClient, GenerateInput, GenerateOutput, Turn } from "./gemini.js";

// TODO(needs-user): set up Application Default Credentials or GOOGLE_AI_API_KEY before calling generate()
export type VertexConfig = {
  /** GCP project ID */
  project: string;
  /** GCP region, e.g. "us-central1" */
  location: string;
  /** Model name, e.g. "gemini-3-pro" */
  model: string;
  /**
   * Returns a fresh Bearer token.
   * TODO(needs-user): implement via google-auth-library ADC or return GOOGLE_AI_API_KEY directly.
   */
  getAccessToken: () => Promise<string>;
};

type VPart =
  | { text: string }
  | { functionCall: { id: string; name: string; args: Record<string, unknown> } }
  | { functionResponse: { id: string; name: string; response: unknown } };

type VContent = { role: string; parts: VPart[] };

type VResponse = {
  candidates: Array<{ content: VContent }>;
};

function turnToContent(turn: Turn): VContent {
  switch (turn.kind) {
    case "user":
      return { role: "user", parts: [{ text: turn.text }] };
    case "model_text":
      return { role: "model", parts: [{ text: turn.text }] };
    case "model_tool_calls":
      return {
        role: "model",
        parts: turn.calls.map((c) => ({
          functionCall: { id: c.id, name: c.name, args: c.args },
        })),
      };
    case "tool_responses":
      return {
        role: "user",
        parts: turn.responses.map((r) => ({
          functionResponse: { id: r.id, name: r.name, response: r.result },
        })),
      };
  }
}

export class VertexGeminiClient implements GeminiClient {
  constructor(private readonly cfg: VertexConfig) {}

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    // TODO(needs-user): live network call — requires GOOGLE_AI_API_KEY / ADC configured
    const token = await this.cfg.getAccessToken();
    const { project, location, model } = this.cfg;
    const url =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/${location}/publishers/google/models/${model}:generateContent`;

    const body = {
      system_instruction: { parts: [{ text: input.system }] },
      contents: input.history.map(turnToContent),
      tools: [{ functionDeclarations: input.toolNames.map((name) => ({ name })) }],
      tool_config: { function_calling_config: { mode: "AUTO" } },
    };

    // fetch is available in Node 20+ (matches engines.node >=20 in package.json)
    const res = await (fetch as (url: string, init?: RequestInit) => Promise<Response>)(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Vertex AI error: ${res.status} ${await res.text()}`);
    }

    const json = (await res.json()) as VResponse;
    const content = json.candidates[0]?.content;
    if (!content) {
      throw new Error("Vertex AI: no candidates in response");
    }

    const funcParts = content.parts.filter(
      (p): p is { functionCall: { id: string; name: string; args: Record<string, unknown> } } =>
        "functionCall" in p,
    );
    if (funcParts.length > 0) {
      return {
        kind: "tool_calls",
        calls: funcParts.map((p) => ({
          id: p.functionCall.id,
          name: p.functionCall.name,
          args: p.functionCall.args,
        })),
      };
    }

    const textPart = content.parts.find((p): p is { text: string } => "text" in p);
    if (textPart) {
      return { kind: "text", text: textPart.text };
    }

    throw new Error("Vertex AI: response has neither text nor function calls");
  }
}
