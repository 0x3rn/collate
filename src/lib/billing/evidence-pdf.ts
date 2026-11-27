import { brandDocument, esc, money, rows, when } from "@/lib/pdf/brand-document";
import {
  type DisputeEvidence,
  describeCheckoutAgreement,
  describeSignupAgreement,
  type EvidenceEvent,
  formatPaymentProvider,
} from "./evidence-report";

/**
 * The dispute evidence (transaction record) as a branded HTML document, rendered to PDF by
 * Cloudflare Browser Run (the same renderer as chapter exports). Everything is escaped.
 */

function events(list: EvidenceEvent[], empty: string): string {
  if (list.length === 0) return `<p class="muted">${esc(empty)}</p>`;
  return `<table class="grid"><thead><tr><th>When</th><th>What</th><th>IP address</th><th>Device</th><th>Location</th></tr></thead><tbody>${list
    .map(
      (e) =>
        `<tr><td class="nowrap">${esc(when(e.at))}</td><td>${esc(e.what)}</td><td>${esc(e.ip ?? "—")}</td><td>${esc(e.device ?? "—")}</td><td>${esc(e.location ?? "—")}</td></tr>`
    )
    .join("")}</tbody></table>`;
}

export function renderEvidenceHtml(ev: DisputeEvidence, generatedAt: Date): string {
  const { payment, customer, providerDetails } = ev;
  const provider = formatPaymentProvider(payment.provider);

  const agreement = rows([
    ["At checkout", describeCheckoutAgreement(ev)],
    ["At sign-up", describeSignupAgreement(ev)],
    [
      "Email confirmed",
      ev.emailVerifiedAt
        ? `Confirmed on ${when(ev.emailVerifiedAt)}`
        : customer.emailVerified
          ? "Yes"
          : "No",
    ],
  ]);

  const chapters =
    ev.chaptersDelivered.length === 0
      ? ""
      : `<table class="grid"><thead><tr><th>Chapter</th><th>Project</th><th>Words</th><th>Completed</th></tr></thead><tbody>${ev.chaptersDelivered
          .map(
            (c) =>
              `<tr><td>Chapter ${c.number}: ${esc(c.title)}</td><td>${esc(c.project)}</td><td class="nowrap">${c.words ? c.words.toLocaleString("en-US") : "—"}</td><td class="nowrap">${esc(when(c.finishedAt))}</td></tr>`
          )
          .join("")}</tbody></table>`;

  const otherPayments =
    ev.otherPayments.length === 0
      ? `<p class="muted">No other payments.</p>`
      : `<table class="grid"><thead><tr><th>Date</th><th>Amount</th><th>Credits</th><th>Status</th><th>Reference</th></tr></thead><tbody>${ev.otherPayments
          .map(
            (x) =>
              `<tr><td class="nowrap">${esc(when(x.at))}</td><td class="nowrap">${esc(money(x.currency, x.amountMinor))}</td><td>${x.credits}</td><td>${esc(x.disputed ? "disputed" : x.status)}${x.when === "before" ? " (earlier)" : " (later)"}</td><td class="ref">${esc(x.reference)}</td></tr>`
          )
          .join("")}</tbody></table>`;

  const reversals =
    ev.reversals.length === 0
      ? `<p class="muted">None.</p>`
      : `<table class="grid"><thead><tr><th>Type</th><th>Amount</th><th>Status</th><th>Opened</th><th>Credits taken back</th></tr></thead><tbody>${ev.reversals
          .map(
            (r) =>
              `<tr><td>${r.kind === "dispute" ? "Dispute" : "Refund"}</td><td class="nowrap">${esc(money(r.currency, r.amountMinor))}</td><td>${esc(r.status.replace(/_/g, " "))}${r.resolvedAt ? `, closed ${esc(when(r.resolvedAt))}` : ""}</td><td class="nowrap">${esc(when(r.createdAt))}</td><td>${r.creditsRemoved}${r.creditsShort ? ` (${r.creditsShort} already used)` : ""}</td></tr>`
          )
          .join("")}</tbody></table>`;

  const support =
    ev.supportThreads.length === 0
      ? `<p class="muted">No emails from this customer to support, billing, disputes or general inquiries.</p>`
      : `<table class="grid"><thead><tr><th>Subject</th><th>Mailbox</th><th>Date</th></tr></thead><tbody>${ev.supportThreads
          .map(
            (t) =>
              `<tr><td>${esc(t.subject)}</td><td>${esc(t.mailbox)}</td><td class="nowrap">${esc(when(t.at))}</td></tr>`
          )
          .join("")}</tbody></table>`;

  const providerIdSuffix =
    providerDetails.providerTransactionId && providerDetails.providerTransactionIdLabel
      ? ` · ${providerDetails.providerTransactionIdLabel} ${providerDetails.providerTransactionId}`
      : "";

  const paymentRows: Array<[string, string]> = [
    ["Customer", `${customer.name} <${customer.email}>`],
    ["Amount", money(payment.currency, payment.amountMinor)],
    ["Credits bought", String(payment.creditsGranted)],
    ["Paid through", providerDetails.environment === "test" ? `${provider} (test mode)` : provider],
    ["Reference", payment.providerReference],
    ...(providerDetails.providerTransactionId && providerDetails.providerTransactionIdLabel
      ? ([
          [providerDetails.providerTransactionIdLabel, providerDetails.providerTransactionId],
        ] as Array<[string, string]>)
      : []),
    ...(providerDetails.paymentMethod
      ? ([["Payment method", providerDetails.paymentMethod]] as Array<[string, string]>)
      : []),
    ...(providerDetails.gatewayResponse
      ? ([["Gateway response", providerDetails.gatewayResponse]] as Array<[string, string]>)
      : []),
    ...(providerDetails.providerCustomerId
      ? ([[`${provider} customer`, providerDetails.providerCustomerId]] as Array<[string, string]>)
      : []),
    ["Date", when(providerDetails.paidAt ?? payment.createdAt)],
  ];

  const bodyHtml = `<h1>${esc(customer.name)} · ${esc(money(payment.currency, payment.amountMinor))}</h1>
<p class="sub">${esc(provider)} reference ${esc(payment.providerReference)}${esc(providerIdSuffix)} · ${esc(when(providerDetails.paidAt ?? payment.createdAt))}</p>

<h2>Statement</h2>
<div class="statement">${esc(ev.summary)}</div>

<h2>Payment</h2>
${rows(paymentRows)}

<h2>Agreement to the Terms</h2>
${agreement}

<h2>Service delivered after this payment</h2>
${rows([
  ["Credits spent", String(ev.creditsUsedSincePayment)],
  ["Chapters completed", String(ev.chaptersDelivered.length)],
  ["Files generated", String(ev.exportsCreated)],
  ["Downloads", String(ev.downloads.length)],
])}
${chapters}
<h2>Downloads</h2>
${events(ev.downloads, "No downloads recorded since this payment.")}

<h2>Sign-ins</h2>
${events(ev.signIns, "No sign-ins recorded.")}
${ev.ipAddressesSeen.length ? `<p class="ips">IP addresses seen on this account: ${esc(ev.ipAddressesSeen.join(", "))}</p>` : ""}

<h2>Other payments by this customer</h2>
${otherPayments}

<h2>Refunds and disputes on this payment</h2>
${reversals}

<h2>Messages with support</h2>
${support}`;
  return brandDocument({ documentTitle: "Transaction record", generatedAt, bodyHtml });
}
