export const RESUME_EMBEDDING_PROVIDER = Symbol("RESUME_EMBEDDING_PROVIDER");

export interface ResumeEmbeddingBatch {
  provider: string;
  model: string;
  dimensions: number;
  vectors: number[][];
}

export interface ResumeEmbeddingProvider {
  readonly configured: boolean;
  embed(texts: string[]): Promise<ResumeEmbeddingBatch>;
}
