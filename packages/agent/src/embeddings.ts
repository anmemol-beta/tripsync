import { GoogleAuth } from "google-auth-library";

export type EmbeddingTaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

type VertexEmbeddingOptions = {
  projectId?: string;
  location?: string;
  model?: string;
  outputDimensionality?: number;
};

type PredictResponse = {
  predictions?: Array<{
    embeddings?: { values?: number[] };
    values?: number[];
  }>;
};

export class VertexEmbeddingClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  private readonly projectId?: string;
  private readonly location: string;
  private readonly model: string;
  readonly outputDimensionality: number;

  constructor(options: VertexEmbeddingOptions = {}) {
    this.projectId = options.projectId;
    this.location = options.location ?? "us-central1";
    this.model = options.model ?? "gemini-embedding-001";
    this.outputDimensionality = options.outputDimensionality ?? 768;
  }

  async embed(text: string, taskType: EmbeddingTaskType): Promise<number[]> {
    const projectId = this.projectId ?? (await this.auth.getProjectId());
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    const accessToken = typeof token === "string" ? token : token.token;
    if (!accessToken) throw new Error("VertexEmbeddingClient: failed to load ADC access token");

    const host =
      this.location === "global"
        ? "aiplatform.googleapis.com"
        : `${this.location}-aiplatform.googleapis.com`;
    const url = `https://${host}/v1/projects/${projectId}/locations/${this.location}/publishers/google/models/${this.model}:predict`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        instances: [{ content: text, task_type: taskType }],
        parameters: { outputDimensionality: this.outputDimensionality },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vertex embedding request failed (${res.status}): ${body.slice(0, 500)}`);
    }

    const json = (await res.json()) as PredictResponse;
    const values = json.predictions?.[0]?.embeddings?.values ?? json.predictions?.[0]?.values;
    if (!values?.length) throw new Error("Vertex embedding response did not include values");
    return values;
  }
}
