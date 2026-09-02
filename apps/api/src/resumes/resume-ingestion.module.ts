import { Module } from "@nestjs/common";
import { getEnv } from "../config/env";
import { DisabledResumeEmbeddingProvider } from "./disabled-resume-embedding.provider";
import { OpenAiCompatibleResumeEmbeddingProvider } from "./openai-compatible-resume-embedding.provider";
import { ResumeChunker } from "./resume-chunker";
import { RESUME_EMBEDDING_PROVIDER } from "./resume-embedding-provider";
import { ResumeIngestionController } from "./resume-ingestion.controller";
import { ResumeIngestionService } from "./resume-ingestion.service";
import { ResumeParser } from "./resume-parser";
import { ResumeTextExtractor } from "./resume-text-extractor";

@Module({
  controllers: [ResumeIngestionController],
  providers: [
    ResumeIngestionService,
    ResumeTextExtractor,
    ResumeParser,
    ResumeChunker,
    DisabledResumeEmbeddingProvider,
    OpenAiCompatibleResumeEmbeddingProvider,
    {
      provide: RESUME_EMBEDDING_PROVIDER,
      inject: [DisabledResumeEmbeddingProvider, OpenAiCompatibleResumeEmbeddingProvider],
      useFactory: (
        disabled: DisabledResumeEmbeddingProvider,
        openAiCompatible: OpenAiCompatibleResumeEmbeddingProvider,
      ) => getEnv().EMBEDDING_PROVIDER === "openai-compatible" ? openAiCompatible : disabled,
    },
  ],
  exports: [ResumeIngestionService],
})
export class ResumeIngestionModule {}
