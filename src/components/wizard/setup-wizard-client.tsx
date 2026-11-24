"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { SerializedWizardState } from "@/lib/wizard/http-handlers";
import { StepChaptersForm, StepCitationsForm, StepFormattingForm } from "./step-chapters-and-style";
import { StepOutlineConfirm } from "./step-outline-confirm";
import { StepLengthForm, StepResearchSweep } from "./step-research-and-length";
import { StepTopicForm } from "./step-topic-form";
import { WizardStepper } from "./wizard-stepper";

export function SetupWizardClient({
  initialWizard,
  allowDevPreview = false,
}: {
  initialWizard: SerializedWizardState;
  allowDevPreview?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [wizard, setWizard] = useState<SerializedWizardState>(initialWizard);
  const [currentStep, setCurrentStep] = useState<number>(
    Math.max(2, Math.min(8, initialWizard.project.wizardStep))
  );
  const [saving, setSaving] = useState(false);

  async function refreshWizardState() {
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/wizard`);
      if (!res.ok) return;
      const data = (await res.json()) as { ok: boolean; wizard?: SerializedWizardState };
      if (data.ok && data.wizard) {
        setWizard(data.wizard);
      }
    } catch {
      // Keep current state on transient error
    }
  }

  async function saveStep(payload: Record<string, unknown>, advanceTo?: number) {
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
        toast.error(
          data.error ?? "Could not save this step. Please check your entries.",
          "Could not save step"
        );
        return;
      }

      setWizard(data.wizard);
      if (advanceTo !== undefined) {
        setCurrentStep(advanceTo);
      }
    } catch {
      toast.error(
        "Network error while saving your progress. Your inputs are still here; try again.",
        "Connection error"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmOutline() {
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${wizard.project.id}/wizard`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: 8, confirmed: true }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        toast.error(
          data.error ?? "Could not confirm outline. Please try again.",
          "Could not confirm outline"
        );
        return;
      }
      router.push(`/projects/${wizard.project.id}`);
      router.refresh();
    } catch {
      toast.error("Network error while confirming outline. Try again.", "Connection error");
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
          onSelectStep={(stepNum) => setCurrentStep(stepNum)}
        />
      </div>

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
            allowDevPreview={allowDevPreview}
            onSave={(payload) => saveStep(payload)}
            onRefreshWizard={refreshWizardState}
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
