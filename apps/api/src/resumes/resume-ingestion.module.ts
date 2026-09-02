import { Module } from "@nestjs/common";
import { ResumeChunker } from "./resume-chunker";
import { ResumeIngestionController } from "./resume-ingestion.controller";
import { ResumeIngestionService } from "./resume-ingestion.service";
import { ResumeParser } from "./resume-parser";
import { ResumeTextExtractor } from "./resume-text-extractor";

@Module({
  controllers: [ResumeIngestionController],
  providers: [ResumeIngestionService, ResumeTextExtractor, ResumeParser, ResumeChunker],
  exports: [ResumeIngestionService],
})
export class ResumeIngestionModule {}
