import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset password | Collate",
  description: "Reset the password for your Collate account with an emailed code.",
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 w-full flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="w-full max-w-[460px] bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 shadow-[var(--shadow-subtle)] space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-[1.875rem] sm:text-[2rem] font-medium leading-tight">
              Reset your password
            </h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Enter the email on your account and we will send you a 6-digit code.
            </p>
          </div>

          <ForgotPasswordForm />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
