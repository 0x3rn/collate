/**
 * Plain-English names for the step ids written to jobs_log, for the admin job list.
 * Unknown ids fall back to the id with underscores turned into spaces.
 */
export function describeJobStep(step: string): string {
  let m: RegExpMatchArray | null;
  if ((m = step.match(/^memory_summary_ch(\d+)$/))) return `Chapter ${m[1]} summary`;
  if ((m = step.match(/^classify_revision_targets_ch(\d+)$/)))
    return `Chapter ${m[1]}: sorting change requests`;
  if ((m = step.match(/^draft_section:(.+)$/))) return `Writing “${m[1]}”`;
  if ((m = step.match(/^copy_edit_section:(.+)$/))) return `Copy-editing “${m[1]}”`;
  if ((m = step.match(/^verify_claims:(.+):a(\d+)$/)))
    return `Checking sources in “${m[1]}” (check ${Number(m[2]) + 1})`;
  if ((m = step.match(/^rewrite_section:(.+):r(\d+)$/))) return `Fixing “${m[1]}” (fix ${m[2]})`;
  if ((m = step.match(/^originality_rewrite_(\d+)$/))) return `Similarity rewrite ${m[1]}`;
  if (step === "research_query_plan") return "Planning the source search";
  return step.replace(/_/g, " ");
}

/** First words of a topic, cut at a word boundary. */
export function shortTopic(title: string | null | undefined, max = 60): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}
