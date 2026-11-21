export const WORKERS_AI_EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
export const EMBEDDING_DIMENSIONS = 768;

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export interface VectorRecord {
  id: string;
  values: number[];
  metadata: Record<string, string | number | boolean>;
}

export interface VectorQueryMatch {
  id: string;
  score: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface VectorStore {
  upsert(vectors: VectorRecord[]): Promise<void>;
  query(
    vector: number[],
    options: { topK: number; filter?: Record<string, string | number | boolean> }
  ): Promise<VectorQueryMatch[]>;
}

export interface WorkersAiBinding {
  run(model: string, input: { text: string[] }): Promise<{ data?: number[][] }>;
}

export interface CloudflareVectorizeBinding {
  upsert(vectors: VectorRecord[]): Promise<unknown>;
  query(
    vector: number[],
    options: {
      topK: number;
      returnMetadata?: "all" | "indexed" | "none";
      filter?: Record<string, string | number | boolean>;
    }
  ): Promise<{ matches?: VectorQueryMatch[] }>;
}

export function createWorkersAiEmbedder(ai: WorkersAiBinding): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const result = await ai.run(WORKERS_AI_EMBEDDING_MODEL, { text: texts });
      if (!result.data || result.data.length !== texts.length) {
        throw new Error("Workers AI embedding response count mismatch");
      }
      return result.data;
    },
  };
}

export function createVectorizeStore(index: CloudflareVectorizeBinding): VectorStore {
  return {
    async upsert(vectors: VectorRecord[]): Promise<void> {
      if (vectors.length === 0) return;
      for (let i = 0; i < vectors.length; i += 50) {
        await index.upsert(vectors.slice(i, i + 50));
      }
    },
    async query(vector, options): Promise<VectorQueryMatch[]> {
      const res = await index.query(vector, {
        topK: options.topK,
        returnMetadata: "all",
        ...(options.filter ? { filter: options.filter } : {}),
      });
      return res.matches ?? [];
    },
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function buildPassageVectorId(sourceId: string, passageIndex: number): string {
  return `${sourceId}:p${passageIndex}`;
}
