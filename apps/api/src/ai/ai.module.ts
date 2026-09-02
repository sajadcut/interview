import { Global, Module } from "@nestjs/common";
import { getEnv } from "../config/env";
import { AiGatewayService } from "./ai-gateway.service";
import { AiJobQueueService } from "./ai-job-queue.service";
import { AiWorkerAuthGuard } from "./ai-worker-auth.guard";
import { AiWorkerController } from "./ai-worker.controller";
import { DisabledLlmProvider } from "./disabled-llm.provider";
import { LLM_PROVIDER } from "./llm-provider";
import { OpenAiCompatibleLlmProvider } from "./openai-compatible-llm.provider";

@Global()
@Module({
  controllers: [AiWorkerController],
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
    AiJobQueueService,
    AiWorkerAuthGuard,
  ],
  exports: [AiGatewayService, AiJobQueueService, LLM_PROVIDER],
})
export class AiModule {}
