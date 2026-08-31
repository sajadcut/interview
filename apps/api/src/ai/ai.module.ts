import { Global, Module } from "@nestjs/common";
import { getEnv } from "../config/env";
import { AiGatewayService } from "./ai-gateway.service";
import { DisabledLlmProvider } from "./disabled-llm.provider";
import { LLM_PROVIDER } from "./llm-provider";
import { OpenAiCompatibleLlmProvider } from "./openai-compatible-llm.provider";

@Global()
@Module({
  providers: [
    DisabledLlmProvider,
    OpenAiCompatibleLlmProvider,
    {
      provide: LLM_PROVIDER,
      inject: [DisabledLlmProvider, OpenAiCompatibleLlmProvider],
      useFactory: (
        disabled: DisabledLlmProvider,
        openAiCompatible: OpenAiCompatibleLlmProvider,
      ) => {
        const provider = getEnv().LLM_PROVIDER;
        if (provider === "openai-compatible") return openAiCompatible;
        return disabled;
      },
    },
    AiGatewayService,
  ],
  exports: [AiGatewayService, LLM_PROVIDER],
})
export class AiModule {}
