import { describe, expect, it } from "vitest";
import { describeJobStep, shortTopic } from "@/lib/admin/job-labels";

describe("admin job labels", () => {
  it("names every step the workflows log", () => {
    expect(describeJobStep("memory_summary_ch1")).toBe("Chapter 1 summary");
    expect(describeJobStep("classify_revision_targets_ch2")).toBe(
      "Chapter 2: sorting change requests"
    );
    expect(describeJobStep("draft_section:Background of the study")).toBe(
      "Writing “Background of the study”"
    );
    expect(describeJobStep("verify_claims:Aim and objectives:a0")).toBe(
      "Checking sources in “Aim and objectives” (check 1)"
    );
    expect(describeJobStep("rewrite_section:Scope and delimitations:r2")).toBe(
      "Fixing “Scope and delimitations” (fix 2)"
    );
    expect(describeJobStep("copy_edit_section:Conceptual review")).toBe(
      "Copy-editing “Conceptual review”"
    );
    expect(describeJobStep("originality_rewrite_1")).toBe("Similarity rewrite 1");
    expect(describeJobStep("research_query_plan")).toBe("Planning the source search");
    expect(describeJobStep("something_new")).toBe("something new");
    // A heading containing a colon still parses.
    expect(describeJobStep("verify_claims:Chapter 2: Review:a1")).toBe(
      "Checking sources in “Chapter 2: Review” (check 2)"
    );
  });

  it("shortens topics at a word boundary", () => {
    expect(shortTopic("Short topic")).toBe("Short topic");
    expect(shortTopic(null)).toBe("");
    const long =
      "Effect of kola nut caffeine on the academic performance of undergraduate students in Lagos";
    const short = shortTopic(long);
    expect(short.endsWith("…")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(61);
    expect(long.startsWith(short.slice(0, -1))).toBe(true);
  });
});
