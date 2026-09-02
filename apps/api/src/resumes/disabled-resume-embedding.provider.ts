import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { ResumeEmbeddingProvider } from "./resume-embedding-provider";

@Injectable()
export class DisabledResumeEmbeddingProvider implements ResumeEmbeddingProvider {
  readonly configured = false;

  async embed(): Promise<never> {
    throw new ServiceUnavailableException("Resume embedding provider is not configured");
  }
}
