import type { Metadata } from "next";
import { env } from "cloudflare:workers";
import {
  CopyTextButton,
  DownloadEvidenceButton,
  LiftHoldButton,
} from "@/components/admin/evidence-actions";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { FormAlert } from "@/components/ui/alert";
import { LinkButton } from "@/components/ui/button";
import { createDb } from "@/db/client";
import { requireUser } from "@/lib/auth/server";
import {
  buildDisputeEvidence,
  describeCheckoutAgreement,
  describeSignupAgreement,
  type EvidenceEvent,
} from "@/lib/billing/evidence-report";
import { isAdminEmail } from "@/lib/billing/http-handlers";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Transaction record | Collate admin",
  description: "Everything recorded about one payment, for answering a refund or dispute.",
};

const when = (d: Date | null | undefined) =>
  d
    ? d.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
      }) + " UTC"
    : "—";
const money = (currency: string, minor: number) =>
  `${currency.toUpperCase()} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 break-inside-avoid">
      <h2 className="text-lg font-medium text-[var(--neutral-900)] border-b border-[var(--neutral-200)] pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-x-4 gap-y-0.5 py-1.5 text-sm">
      <dt className="text-[var(--neutral-500)]">{label}</dt>
      <dd className="text-[var(--neutral-900)] [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}

function EventTable({ events, empty }: { events: EvidenceEvent[]; empty: string }) {
  if (events.length === 0) return <p className="text-sm text-[var(--neutral-500)]">{empty}</p>;
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-sm min-w-[560px]">
        <thead>
          <tr className="text-left text-xs text-[var(--neutral-500)]">
            <th className="py-1.5 pr-3 font-medium">When</th>
            <th className="py-1.5 pr-3 font-medium">What</th>
            <th className="py-1.5 pr-3 font-medium">IP address</th>
            <th className="py-1.5 pr-3 font-medium">Device</th>
            <th className="py-1.5 font-medium">Location</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--neutral-200)]">
          {events.map((e, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{when(e.at)}</td>
              <td className="py-1.5 pr-3">{e.what}</td>
              <td className="py-1.5 pr-3 tabular-nums">{e.ip ?? "—"}</td>
              <td className="py-1.5 pr-3">{e.device ?? "—"}</td>
              <td className="py-1.5">{e.location ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PaymentEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/admin/payments/${id}`);
  const runtimeEnv = env as unknown as Record<string, string | undefined>;
  if (!user.emailVerified || !isAdminEmail(user.email, runtimeEnv.ADMIN_EMAILS)) {
    return (
      <WorkspaceShell user={user} maxWidthClassName="max-w-[600px]">
        <div className="py-8 space-y-5">
          <FormAlert tone="error">Admin access required.</FormAlert>
          <LinkButton href="/dashboard" variant="secondary">
            Back to overview
          </LinkButton>
        </div>
      </WorkspaceShell>
    );
  }

  const ev = await buildDisputeEvidence(createDb(env.DB), id);
  if (!ev) {
    return (
      <WorkspaceShell user={user} maxWidthClassName="max-w-[600px]">
        <div className="py-8 space-y-5">
          <FormAlert tone="error">Payment not found.</FormAlert>
          <LinkButton href="/admin" variant="secondary">
            Back to admin
          </LinkButton>
        </div>
      </WorkspaceShell>
    );
  }
  const { payment, customer } = ev;
  const openDispute = ev.reversals.find((r) => r.kind === "dispute" && !r.resolvedAt);

  return (
    <WorkspaceShell user={user} maxWidthClassName="max-w-[980px]">
      <article className="space-y-8 print:space-y-6">
        <header className="border-b border-[var(--neutral-200)] pb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--neutral-500)]">Transaction record</p>
            <h1 className="text-[2rem] font-medium leading-tight [overflow-wrap:anywhere]">
              {customer.name} · {money(payment.currency, payment.amountMinor)}
            </h1>
            <p className="text-sm text-[var(--neutral-600)] mt-1.5">
              Prepared {when(new Date())} from Collate&rsquo;s records.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <LinkButton href="/admin" variant="secondary">
              Admin
            </LinkButton>
            <DownloadEvidenceButton paymentId={payment.id} />
          </div>
        </header>

        {openDispute && (
          <FormAlert tone="error">
            Dispute open ({openDispute.status.replace(/_/g, " ")})
            {openDispute.dueAt ? ` · respond by ${when(openDispute.dueAt)}` : ""}.{" "}
            {payment.provider === "polar"
              ? "Respond in the Polar dashboard: Sales → Disputes (or the order's Disputes section) → Counter dispute, and upload the PDF from Download PDF."
              : "Respond on the dispute in your Paystack dashboard and attach the PDF from Download PDF."}
          </FormAlert>
        )}

        {customer.holdReason && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--neutral-300)] bg-[var(--neutral-50)] px-4 py-3 print:hidden">
            <p className="text-sm text-[var(--neutral-800)]">
              <strong>Account on hold:</strong> {customer.holdReason}
            </p>
            <LiftHoldButton userId={customer.id} email={customer.email} />
          </div>
        )}

        <Section title="Statement">
          <p className="text-sm leading-relaxed text-[var(--neutral-800)] whitespace-pre-wrap">
            {ev.summary}
          </p>
          <div className="print:hidden">
            <CopyTextButton text={ev.summary} />
          </div>
        </Section>

        <Section title="Payment">
          <dl>
            <Row label="Customer" value={`${customer.name} <${customer.email}>`} />
            <Row label="Amount" value={money(payment.currency, payment.amountMinor)} />
            <Row label="Credits bought" value={payment.creditsGranted} />
            <Row label="Paid through" value={payment.provider === "polar" ? "Polar" : "Paystack"} />
            <Row label="Reference" value={payment.providerReference} />
            {payment.providerOrderId && <Row label="Polar order" value={payment.providerOrderId} />}
            <Row label="Date" value={when(payment.createdAt)} />
            <Row label="Status" value={payment.status} />
          </dl>
        </Section>

        <Section title="Agreement to the Terms">
          <dl>
            <Row label="At checkout" value={describeCheckoutAgreement(ev)} />
            <Row label="At sign-up" value={describeSignupAgreement(ev)} />
            <Row
              label="Email confirmed"
              value={
                ev.emailVerifiedAt
                  ? `Confirmed on ${when(ev.emailVerifiedAt)}`
                  : customer.emailVerified
                    ? "Yes"
                    : "No"
              }
            />
          </dl>
        </Section>

        <Section title="Service delivered after payment">
          <dl>
            <Row label="Credits spent" value={ev.creditsUsedSincePayment} />
            <Row label="Chapters completed" value={ev.chaptersDelivered.length} />
            <Row label="Files generated" value={ev.exportsCreated} />
            <Row label="Downloads" value={ev.downloads.length} />
          </dl>
          {ev.chaptersDelivered.length > 0 && (
            <ul className="text-sm divide-y divide-[var(--neutral-200)] border-y border-[var(--neutral-200)]">
              {ev.chaptersDelivered.map((c, i) => (
                <li key={i} className="py-1.5 flex flex-wrap justify-between gap-2">
                  <span className="[overflow-wrap:anywhere]">
                    Chapter {c.number}: {c.title}
                    <span className="text-[var(--neutral-500)]"> · {c.project}</span>
                  </span>
                  <span className="text-[var(--neutral-500)] tabular-nums">
                    {c.words ? `${c.words.toLocaleString("en-US")} words · ` : ""}
                    {when(c.finishedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="text-sm font-medium pt-2">Downloads</h3>
          <EventTable events={ev.downloads} empty="No downloads recorded since this payment." />
        </Section>

        <Section title="Sign-ins">
          <EventTable events={ev.signIns} empty="No sign-ins recorded." />
          {ev.activeSessions.length > 0 && (
            <>
              <h3 className="text-sm font-medium pt-2">Devices still signed in</h3>
              <EventTable events={ev.activeSessions} empty="" />
            </>
          )}
          {ev.ipAddressesSeen.length > 0 && (
            <p className="text-sm text-[var(--neutral-600)] [overflow-wrap:anywhere]">
              IP addresses seen: {ev.ipAddressesSeen.join(", ")}
            </p>
          )}
        </Section>

        <Section title="Other payments by this customer">
          {ev.otherPayments.length === 0 ? (
            <p className="text-sm text-[var(--neutral-500)]">No other payments.</p>
          ) : (
            <ul className="text-sm divide-y divide-[var(--neutral-200)] border-y border-[var(--neutral-200)]">
              {ev.otherPayments.map((x) => (
                <li key={x.id} className="py-1.5 flex flex-wrap justify-between gap-2">
                  <a
                    href={`/admin/payments/${encodeURIComponent(x.id)}`}
                    className="underline underline-offset-2 text-[var(--accent-700)]"
                  >
                    {money(x.currency, x.amountMinor)} · {x.credits} credits
                  </a>
                  <span className="text-[var(--neutral-500)]">
                    {x.disputed ? "disputed" : x.status} ·{" "}
                    {x.when === "before" ? "earlier" : "later"} · {when(x.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Refunds and disputes">
          {ev.reversals.length === 0 ? (
            <p className="text-sm text-[var(--neutral-500)]">None.</p>
          ) : (
            <ul className="text-sm divide-y divide-[var(--neutral-200)] border-y border-[var(--neutral-200)]">
              {ev.reversals.map((r) => (
                <li key={r.id} className="py-2 space-y-0.5">
                  <p>
                    <strong>{r.kind === "dispute" ? "Dispute" : "Refund"}</strong> ·{" "}
                    {money(r.currency, r.amountMinor)} · {r.status.replace(/_/g, " ")}
                    {r.resolvedAt ? ` · closed ${when(r.resolvedAt)}` : ""}
                  </p>
                  <p className="text-[var(--neutral-600)]">
                    Opened {when(r.createdAt)} · {r.creditsRemoved} credits taken back
                    {r.creditsShort ? `, ${r.creditsShort} already used` : ""}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Messages with support">
          {ev.supportThreads.length === 0 ? (
            <p className="text-sm text-[var(--neutral-500)]">
              No emails from this customer to support, billing or general inquiries.
            </p>
          ) : (
            <ul className="text-sm divide-y divide-[var(--neutral-200)] border-y border-[var(--neutral-200)]">
              {ev.supportThreads.map((t, i) => (
                <li key={i} className="py-1.5 flex flex-wrap justify-between gap-2">
                  <span className="[overflow-wrap:anywhere]">{t.subject}</span>
                  <span className="text-[var(--neutral-500)]">
                    {t.mailbox} · {when(t.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </article>
    </WorkspaceShell>
  );
}
