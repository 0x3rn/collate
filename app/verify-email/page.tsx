import type { Metadata } from "next";
import { VerifyEmailClient } from "@/components/auth/verify-email-client";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify email | Collate",
  description: "Confirm your email address to activate your Collate account.",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
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
      <main className="flex-1 mx-auto w-full max-w-[420px] px-4 sm:px-0 py-14 sm:py-20">
        <div className="space-y-7">
          <div className="space-y-1.5">
            <h1 className="text-[2rem] font-medium leading-tight">Verify your email</h1>
            <p className="text-sm text-[var(--neutral-600)]">
              Email confirmation keeps your projects private and ensures chapter alerts reach you.
            </p>
          </div>

          <VerifyEmailClient token={token} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
