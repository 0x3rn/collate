import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a new password | Collate",
  description: "Set a new password for your Collate account.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : null;

  return (
    <>
      <SiteHeader user={user} />
      <main className="flex-1 mx-auto w-full max-w-[460px] px-4 sm:px-6 py-12 sm:py-16">
        <div className="bg-white border border-[var(--neutral-200)] rounded-[var(--radius-md)] p-6 sm:p-8 shadow-[var(--shadow-subtle)] space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-[1.75rem] font-medium">Choose a new password</h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Updating your password signs out existing sessions on all devices.
            </p>
          </div>

          <ResetPasswordForm token={token} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
