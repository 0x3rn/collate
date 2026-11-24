"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ReviseOutlineButton({
  projectId,
  outlineLocked,
}: {
  projectId: string;
  outlineLocked: boolean;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function handleClick() {
    setWorking(true);
    try {
      if (outlineLocked) {
        await fetch(`/api/projects/${projectId}/outline/unlock`, { method: "POST" });
      }
      router.push(`/projects/${projectId}/setup`);
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      loading={working}
      loadingLabel="Opening outline..."
      onClick={handleClick}
      className="whitespace-nowrap shrink-0"
    >
      {outlineLocked ? "Revise outline" : "Edit outline"}
    </Button>
  );
}
