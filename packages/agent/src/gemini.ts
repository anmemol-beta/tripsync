export type FunctionCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
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
