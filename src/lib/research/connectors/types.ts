import type { RawSourceCandidate } from "@/lib/research/types";

export interface ConnectorEnv {
  TAVILY_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;
  SEMANTIC_SCHOLAR_API_KEY?: string;
  CORE_API_KEY?: string;
  SCHOLARLY_CONTACT_EMAIL?: string;
}

export interface ConnectorSearchOptions {
  maxResults: number;
  timeoutMs: number;
  fetchFn: typeof fetch;
  env: ConnectorEnv;
  now: Date;
}

export interface SourceConnector {
  readonly name: string;
  readonly kind: "scholarly" | "web";
  isEnabled(env: ConnectorEnv): boolean;
  search(query: string, options: ConnectorSearchOptions): Promise<RawSourceCandidate[]>;
}
