import { RESEARCH_CONFIG } from "@/config/research";
import type { RawSourceCandidate } from "@/lib/research/types";
import {
  arxivConnector,
  coreConnector,
  crossrefConnector,
  doajConnector,
  europePmcConnector,
  openAlexConnector,
  semanticScholarConnector,
} from "./scholarly";
import type { ConnectorEnv, SourceConnector } from "./types";
import { braveSearchConnector, tavilyConnector } from "./web";

export function getDefaultConnectors(): SourceConnector[] {
  return [
    openAlexConnector,
    crossrefConnector,
    semanticScholarConnector,
    coreConnector,
    arxivConnector,
    europePmcConnector,
    doajConnector,
    tavilyConnector,
    braveSearchConnector,
  ];
}

export interface ConnectorRunStat {
  connector: string;
  kind: "scholarly" | "web";
  queriesAttempted: number;
  queriesSucceeded: number;
  queriesFailed: number;
  candidatesFound: number;
  errors: string[];
}

export interface FanOutSearchResult {
  candidates: RawSourceCandidate[];
  stats: ConnectorRunStat[];
  enabledConnectors: string[];
  skippedConnectors: string[];
}

export interface FanOutSearchOptions {
  connectors?: SourceConnector[];
  env: ConnectorEnv;
  maxResultsPerQuery?: number;
  maxQueriesPerConnector?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  now?: Date;
}

export async function runConnectorsForQueries(
  queries: Array<{ query: string; intent: string }>,
  options: FanOutSearchOptions
): Promise<FanOutSearchResult> {
  const allConnectors = options.connectors ?? getDefaultConnectors();
  const enabled: SourceConnector[] = [];
  const skippedConnectors: string[] = [];

  for (const connector of allConnectors) {
    if (connector.isEnabled(options.env)) {
      enabled.push(connector);
    } else {
      skippedConnectors.push(connector.name);
    }
  }

  const maxResults = options.maxResultsPerQuery ?? 10;
  const maxQueriesPerConnector = options.maxQueriesPerConnector ?? 6;
  const timeoutMs = options.timeoutMs ?? RESEARCH_CONFIG.caps.perRequestTimeoutMs;
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const now = options.now ?? new Date();

  const allCandidates: RawSourceCandidate[] = [];
  const stats: ConnectorRunStat[] = [];

  await Promise.all(
    enabled.map(async (connector) => {
      const prioritized = [
        ...queries.filter((q) =>
          connector.kind === "web"
            ? q.intent === "web" || q.intent === "statistics" || q.intent === "case_study"
            : q.intent !== "web"
        ),
        ...queries,
      ];
      const uniqueQueries: string[] = [];
      const seenQ = new Set<string>();
      for (const item of prioritized) {
        const key = item.query.trim().toLowerCase();
        if (!seenQ.has(key) && uniqueQueries.length < maxQueriesPerConnector) {
          seenQ.add(key);
          uniqueQueries.push(item.query.trim());
        }
      }

      const stat: ConnectorRunStat = {
        connector: connector.name,
        kind: connector.kind,
        queriesAttempted: 0,
        queriesSucceeded: 0,
        queriesFailed: 0,
        candidatesFound: 0,
        errors: [],
      };

      for (const q of uniqueQueries) {
        stat.queriesAttempted++;
        try {
          const found = await connector.search(q, {
            maxResults,
            timeoutMs,
            fetchFn,
            env: options.env,
            now,
          });
          stat.queriesSucceeded++;
          stat.candidatesFound += found.length;
          allCandidates.push(...found);
        } catch (err) {
          stat.queriesFailed++;
          const msg = err instanceof Error ? err.message : String(err);
          if (stat.errors.length < 3) {
            stat.errors.push(msg.slice(0, 200));
          }
        }
      }

      stats.push(stat);
    })
  );

  return {
    candidates: allCandidates,
    stats,
    enabledConnectors: enabled.map((c) => c.name),
    skippedConnectors,
  };
}
