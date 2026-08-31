import { Injectable } from "@nestjs/common";
import type { GenerateStructuredResult, LlmProvider } from "./llm-provider";

@Injectable()
export class DisabledLlmProvider implements LlmProvider {
  readonly name = "disabled";

  async generateStructured(): Promise<GenerateStructuredResult> {
    throw new Error("LLM provider is disabled. Configure LLM_PROVIDER before invoking AI features.");
  }
}
