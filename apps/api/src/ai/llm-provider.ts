export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateStructuredRequest {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
}

export interface GenerateStructuredResult {
  output: unknown;
  promptTokens?: number;
  completionTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult>;
}

export const LLM_PROVIDER = Symbol("LLM_PROVIDER");
