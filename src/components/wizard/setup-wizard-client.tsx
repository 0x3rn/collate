"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormAlert } from "@/components/ui/alert";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";
import { StepChaptersForm, StepCitationsForm, StepFormattingForm } from "./step-chapters-and-style";
import { StepOutlineConfirm } from "./step-outline-confirm";
import { StepLengthForm, StepResearchSweep } from "./step-research-and-length";
import { StepTopicForm } from "./step-topic-form";
import { WizardStepper } from "./wizard-stepper";

export function SetupWizardClient({ initialWizard }: { initialWizard: SerializedWizardState }) {
  const router = useRouter();
  const [wizard, setWizard] = useState<SerializedWizardState>(initialWizard);
  const [currentStep, setCurrentStep] = useState<number>(
    Math.max(2, Math.min(8, initialWizard.project.wizardStep))
  );
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  async function saveStep(payload: Record<string, unknown>, advanceTo?: number) {
    setApiError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/wizard`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok: boolean;
        wizard?: SerializedWizardState;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.wizard) {
        setApiError(data.error ?? "Could not save this step. Please check your entries.");
        return;
      }

      setWizard(data.wizard);
      if (advanceTo !== undefined) {
        setCurrentStep(advanceTo);
      }
    } catch {
      setApiError(
        "Network error while saving your progress. Your inputs are still here—try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmOutline() {
    setApiError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/wizard`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: 8, confirmed: true }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setApiError(data.error ?? "Could not confirm outline. Please try again.");
        return;
      }
      router.push(`/projects/${wizard.project.id}`);
      router.refresh();
    } catch {
      setApiError("Network error while confirming outline. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-5">
        <WizardStepper
          projectType={wizard.project.type}
          currentStep={currentStep}
          maxReachedStep={Math.max(wizard.project.wizardStep, currentStep)}
          onSelectStep={(stepNum) => {
            setApiError(null);
            setCurrentStep(stepNum);
          }}
        />
      </div>

      {apiError ? <FormAlert tone="error">{apiError}</FormAlert> : null}

      <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 shadow-[var(--shadow-subtle)]">
        {currentStep === 2 ? (
          <StepTopicForm
            wizard={wizard}
            saving={saving}
            onSave={(payload) => saveStep(payload, 3)}
          />
        ) : null}

        {currentStep === 3 ? (
          <StepResearchSweep
            wizard={wizard}
            saving={saving}
            onSave={(payload) => saveStep(payload)}
            onBackToTopic={() => setCurrentStep(2)}
            onContinueToLength={() => setCurrentStep(4)}
          />
        ) : null}

        {currentStep === 4 ? (
          <StepLengthForm
            wizard={wizard}
            saving={saving}
            onSave={(payload) => saveStep(payload, wizard.project.type === "assignment" ? 6 : 5)}
            onBack={() => setCurrentStep(3)}
          />
        ) : null}

        {currentStep === 5 ? (
          <StepChaptersForm
            wizard={wizard}
            saving={saving}
            onSave={(payload) => saveStep(payload, 6)}
            onBack={() => setCurrentStep(4)}
          />
        ) : null}

        {currentStep === 6 ? (
          <StepCitationsForm
            wizard={wizard}
            saving={saving}
            onSave={(payload) => saveStep(payload, 7)}
            onBack={() => setCurrentStep(wizard.project.type === "assignment" ? 4 : 5)}
          />
        ) : null}

        {currentStep === 7 ? (
          <StepFormattingForm
            wizard={wizard}
            saving={saving}
            onSave={(payload) => saveStep(payload, 8)}
            onBack={() => setCurrentStep(6)}
          />
        ) : null}

        {currentStep === 8 ? (
          <StepOutlineConfirm
            wizard={wizard}
            saving={saving}
            onConfirm={handleConfirmOutline}
            onBack={() => setCurrentStep(7)}
          />
        ) : null}
      </div>
    </div>
  );
}
