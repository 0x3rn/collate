"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ variant = "ghost" }: { variant?: "ghost" | "secondary" }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleSignOut() {
    setSubmitting(true);
    try {
      await fetch("/api/auth/signout", { method: "POST" });
    } finally {
      router.push("/sign-in");
      router.refresh();
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      loading={submitting}
      loadingLabel="Signing out..."
      onClick={handleSignOut}
    >
      Sign out
    </Button>
  );
}
