import type { AnchorHTMLAttributes, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FormAlert } from "@/components/ui/alert";
import { StepLengthForm, StepResearchSweep } from "@/components/wizard/step-research-and-length";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Report = SerializedWizardState["feasibilityReports"][number];

function report(over: Partial<Report> = {}): Report {
  return {
    id: "rep_1",
    questionId: null,
    verdict: "feasible",
    score: 87,
    isMocked: false,
    reasons: ["Enough recent peer-reviewed studies cover the topic."],
    coverage: {
      sourcesFound: 70,
      credibleRelevantSources: 56,
      subtopicsCovered: 8,
      idealPagesReason: "Typical length for a masters thesis.",
    },
    createdAt: "2026-11-25T00:00:00.000Z",
    ...over,
  };
}

function wizard(reports: Report[]): SerializedWizardState {
  return {
    project: { id: "prj_1", type: "thesis", idealPages: 60, targetPages: null },
    feasibilityReports: reports,
    questions: [],
  } as unknown as SerializedWizardState;
}

const noop = async () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");

function renderSweep(reports: Report[]) {
  return text(
    renderToStaticMarkup(
      <StepResearchSweep
        wizard={wizard(reports)}
        saving={false}
        onSave={noop}
        onBackToTopic={() => {}}
        onContinueToLength={() => {}}
      />
    )
  );
}

describe("source check step", () => {
  it("shows a plain result with no evidence score or 'Confirmed' prefix", () => {
    const out = renderSweep([report()]);
    expect(out).toContain(
      "Good news: this topic has enough sources. 56 credible sources found, covering 8 parts of your topic."
    );
    expect(out).not.toMatch(/Evidence score|87\/100|Confirmed:/);
  });

  it("uses singular wording for counts of one and explains a failed check", () => {
    const out = renderSweep([
      report({
        verdict: "needs_refinement",
        coverage: {
          sourcesFound: 1,
          credibleRelevantSources: 1,
          subtopicsCovered: 1,
          idealPagesReason: "",
        },
      }),
    ]);
    expect(out).toContain(
      "Your topic needs narrowing. 1 credible source found, covering 1 part of your topic."
    );
    expect(out).toContain("Edit your topic and run the check again.");
    expect(out).not.toContain("feasibility gate");
  });

  it("tells a new user to start the check, and never lists retrieved sources", () => {
    const out = renderSweep([]);
    expect(out).toContain("Start the check to see whether your topic has enough sources.");
    expect(out).not.toMatch(/retrieved sources|feasibility gate/i);
  });
});

describe("page length step", () => {
  it("has no 'Use recommended' button but still shows the recommendation", () => {
    const out = text(
      renderToStaticMarkup(
        <StepLengthForm
          wizard={wizard([report()])}
          saving={false}
          onSave={noop}
          onBack={() => {}}
        />
      )
    );
    expect(out).toContain("60 pages");
    expect(out).not.toContain("Use recommended");
  });
});

describe("FormAlert label", () => {
  it("shows no prefix on success, keeps it for errors, and can replace or hide it", () => {
    expect(text(renderToStaticMarkup(<FormAlert tone="success">Saved.</FormAlert>))).toBe("Saved.");
    expect(text(renderToStaticMarkup(<FormAlert tone="error">Failed.</FormAlert>))).toBe(
      "Error: Failed."
    );
    expect(
      text(
        renderToStaticMarkup(
          <FormAlert tone="success" label="Done">
            Saved.
          </FormAlert>
        )
      )
    ).toContain("Done: Saved.");
    expect(
      text(
        renderToStaticMarkup(
          <FormAlert tone="success" label={null}>
            Saved.
          </FormAlert>
        )
      )
    ).toBe("Saved.");
  });
});
