import type { SourceAccessStatus, SourceType } from "@/db/schema";

export interface RawSourceCandidate {
  url: string;
  doi?: string | null;
  title: string;
  authors: string[];
  year?: number | null;
  publisher?: string | null;
  venue?: string | null;
  sourceType: SourceType;
  connectorName: string;
  citationCount?: number | null;
  abstractText?: string | null;
  openAccessPdfUrl?: string | null;
  retrievedAt: Date;
}

export interface DeduplicatedSource {
  url: string;
  canonicalUrl: string;
  doi: string | null;
  title: string;
  normalizedTitle: string;
  authors: string[];
  year: number | null;
  publisher: string | null;
  venue: string | null;
  sourceType: SourceType;
  connectorName: string;
  connectorNames: string[];
  citationCount: number | null;
  abstractText: string | null;
  openAccessPdfUrl: string | null;
  accessStatus: SourceAccessStatus;
  retrievedAt: Date;
}

export interface ScoredSource extends DeduplicatedSource {
  credibilityScore: number;
  relevanceScore: number;
  matchedSubtopics: string[];
}
