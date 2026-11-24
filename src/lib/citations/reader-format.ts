import type { CslItem } from "./csl";
import { getCitationFormatter } from "./formatter";

export interface FormattedCitationCluster {
  label: string;
  citeKeys: string[];
}

/**
 * Formats every bracketed `[@key]` / `[@key1; @key2]` citation cluster in chapter Markdown
 * using the project's exact citation style (Harvard, APA 7, MLA 9, Chicago, IEEE, Vancouver),
 * so the on-screen chapter reader matches the exported PDF/Word academic formatting while
 * keeping every citation clickable to inspect its verified source.
 */
export function buildReaderCitationLabels(params: {
  markdown: string;
  registry: Map<string, CslItem>;
  style: string;
}): {
  clusters: Record<string, FormattedCitationCluster>;
  singleKeyLabels: Record<string, string>;
} {
  const formatter = getCitationFormatter(params.style);
  const citedOrder: string[] = [];
  const numberByKey = new Map<string, number>();
  const clusters: Record<string, FormattedCitationCluster> = {};
  const singleKeyLabels: Record<string, string> = {};

  const matches = params.markdown.matchAll(/\[(@[^\]]+)\]/g);

  for (const match of matches) {
    const rawToken = match[0];
    const inner = match[1] ?? "";
    const segments = inner
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    const resolvedEntries: Array<{
      citeKey: string;
      item: CslItem;
      numericIndex: number;
      locator?: string;
    }> = [];

    for (const seg of segments) {
      if (!seg.startsWith("@")) continue;
      const withoutAt = seg.slice(1).trim();
      const commaIdx = withoutAt.indexOf(",");
      const key = (commaIdx >= 0 ? withoutAt.slice(0, commaIdx) : withoutAt).trim();
      const locator = commaIdx >= 0 ? withoutAt.slice(commaIdx + 1).trim() : undefined;

      if (!/^[a-zA-Z0-9_:-]+$/.test(key)) continue;

      const item = params.registry.get(key);
      if (!item) continue;

      if (!numberByKey.has(key)) {
        citedOrder.push(key);
        numberByKey.set(key, citedOrder.length);
      }

      const numericIndex = numberByKey.get(key)!;
      resolvedEntries.push({
        citeKey: key,
        item,
        numericIndex,
        locator: locator || undefined,
      });

      if (!singleKeyLabels[key]) {
        singleKeyLabels[key] = formatter.formatInTextGroup([{ item, numericIndex }]);
      }
    }

    if (resolvedEntries.length > 0 && !clusters[rawToken]) {
      clusters[rawToken] = {
        label: formatter.formatInTextGroup(resolvedEntries),
        citeKeys: resolvedEntries.map((e) => e.citeKey),
      };
    }
  }

  return { clusters, singleKeyLabels };
}
