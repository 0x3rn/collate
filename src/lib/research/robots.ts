import { checkPublicHttpUrl, safePublicFetch } from "@/lib/security/ssrf";
import { buildPoliteUserAgent } from "./connectors/http";

export interface RobotsRule {
  allow: boolean;
  pathPrefix: string;
}

export function parseRobotsTxt(rawText: string, botName = "collateresearchbot"): RobotsRule[] {
  const lines = rawText.split(/\r?\n/);
  const specificRules: RobotsRule[] = [];
  const wildcardRules: RobotsRule[] = [];

  let activeGroups: Array<"specific" | "wildcard"> = [];
  let sawRuleInBlock = false;

  for (const rawLine of lines) {
    const commentIdx = rawLine.indexOf("#");
    const clean = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
    if (!clean) continue;

    const colonIdx = clean.indexOf(":");
    if (colonIdx <= 0) continue;

    const directive = clean.slice(0, colonIdx).trim().toLowerCase();
    const value = clean.slice(colonIdx + 1).trim();

    if (directive === "user-agent") {
      if (sawRuleInBlock) {
        activeGroups = [];
        sawRuleInBlock = false;
      }
      const agent = value.toLowerCase();
      if (agent === botName || agent.includes("collate")) {
        activeGroups.push("specific");
      } else if (agent === "*") {
        activeGroups.push("wildcard");
      }
      continue;
    }

    if (directive === "disallow" || directive === "allow") {
      sawRuleInBlock = true;
      if (!value) continue;
      const rule: RobotsRule = { allow: directive === "allow", pathPrefix: value };
      if (activeGroups.includes("specific")) specificRules.push(rule);
      if (activeGroups.includes("wildcard")) wildcardRules.push(rule);
    }
  }

  return specificRules.length > 0 ? specificRules : wildcardRules;
}

export function isPathAllowedByRobots(pathnameWithQuery: string, rules: RobotsRule[]): boolean {
  if (rules.length === 0) return true;

  let bestMatch: RobotsRule | null = null;
  for (const rule of rules) {
    const prefix = rule.pathPrefix.replace(/\*.*$/, "");
    if (!prefix) continue;
    if (pathnameWithQuery.startsWith(prefix)) {
      if (
        !bestMatch ||
        prefix.length > bestMatch.pathPrefix.length ||
        (prefix.length === bestMatch.pathPrefix.length && rule.allow)
      ) {
        bestMatch = { allow: rule.allow, pathPrefix: prefix };
      }
    }
  }

  return bestMatch ? bestMatch.allow : true;
}

export class RobotsChecker {
  private readonly cache = new Map<string, RobotsRule[]>();

  async isUrlAllowed(
    targetUrl: string,
    options: { fetchFn: typeof fetch; timeoutMs: number; contactEmail?: string }
  ): Promise<boolean> {
    const check = checkPublicHttpUrl(targetUrl);
    if (!check.safe || !check.parsed) return false;

    const origin = check.parsed.origin;
    const pathAndQuery = `${check.parsed.pathname}${check.parsed.search}`;

    let rules = this.cache.get(origin);
    if (!rules) {
      try {
        const robotsUrl = `${origin}/robots.txt`;
        const { response } = await safePublicFetch(robotsUrl, {
          headers: { "user-agent": buildPoliteUserAgent(options.contactEmail) },
          timeoutMs: Math.min(5000, options.timeoutMs),
          maxRedirects: 2,
          fetchFn: options.fetchFn,
        });
        if (response.ok) {
          const text = await response.text();
          rules = parseRobotsTxt(text.slice(0, 100_000));
        } else {
          rules = [];
        }
      } catch {
        rules = [];
      }
      this.cache.set(origin, rules);
    }

    return isPathAllowedByRobots(pathAndQuery, rules);
  }
}
