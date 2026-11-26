"use client";

import { useRouter } from "next/navigation";
import { ForgotPasswordFlow } from "./forgot-password-flow";

/** The /forgot-password page: the same code-based flow as the sign-in pop-up. */
export function ForgotPasswordForm() {
  const router = useRouter();
  return <ForgotPasswordFlow onDone={() => router.push("/sign-in")} doneLabel="Sign in" />;
}
