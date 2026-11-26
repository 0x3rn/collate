import { LEGAL_CONFIG } from "./config";
import { a, b, c, t, type LegalDocumentData } from "./types";

const privacyMail = a(LEGAL_CONFIG.privacyEmail, `mailto:${LEGAL_CONFIG.privacyEmail}`);

export const COOKIE_POLICY: LegalDocumentData = {
  slug: "/cookies",
  title: "Cookie & Local Storage Policy",
  subtitle:
    "A complete inventory of Collate's strictly necessary authentication and security cookies, browser storage practices, and third-party checkout cookies.",
  effectiveDate: LEGAL_CONFIG.effectiveDate,
  lastUpdated: LEGAL_CONFIG.lastUpdated,
  intro: [
    [
      t("This Cookie & Local Storage Policy explains how "),
      b("Collate"),
      t(" uses cookies and browser storage technologies when you visit "),
      a(LEGAL_CONFIG.siteUrl, LEGAL_CONFIG.siteUrl),
      t(
        " and use your research workspace. Because academic work frequently involves unpublished theses, primary datasets, and sensitive pre-publication manuscripts, Collate operates on a strict privacy-first, data-minimization architecture."
      ),
    ],
  ],
  sections: [
    {
      id: "minimalist-commitment",
      number: "1",
      title: "Overview and Minimalist Cookie Commitment",
      blocks: [
        {
          type: "callout",
          tone: "accent",
          title: "Zero Advertising Cookies and Opt-In Analytics Only",
          runs: [
            t(
              "Collate never deploys advertising pixels, behavioral retargeting tags, or social tracking widgets. Optional Google Analytics 4 measurement stays completely off unless you explicitly click Accept analytics in the cookie preferences popup."
            ),
          ],
        },
        {
          type: "paragraph",
          runs: [
            t(
              "Every script, stylesheet, font, and frame permitted to run inside the Collate web application is strictly constrained by our "
            ),
            c("Content-Security-Policy"),
            t(" and "),
            c("Referrer-Policy: strict-origin-when-cross-origin"),
            t(
              " HTTP headers, ensuring that unauthorized third-party trackers cannot execute inside your workspace."
            ),
          ],
        },
      ],
    },
    {
      id: "what-cookies-are",
      number: "2",
      title: "What Cookies and Browser Storage Technologies Are",
      blocks: [
        {
          type: "list",
          items: [
            [
              b("First-Party Cookies: "),
              t(
                "Small text files placed directly by the Collate domain and readable only by Collate. Cookies prefixed with "
              ),
              c("__Host-"),
              t(
                " enforce strict browser guarantees: they are transmitted exclusively over HTTPS ("
              ),
              c("Secure"),
              t("), scoped strictly to "),
              c("Path=/"),
              t(", and cannot specify a broader "),
              c("Domain"),
              t(" attribute."),
            ],
            [
              b("Essential Partner Cookies: "),
              t(
                "Cookies or tokens set by essential infrastructure partners, specifically Cloudflare for bot and DDoS mitigation, or Polar.sh and Paystack exclusively on their separate hosted checkout domains when you initiate a purchase."
              ),
            ],
            [
              b("Browser Storage Technologies: "),
              t("Client-side storage mechanisms such as "),
              c("localStorage"),
              t(", "),
              c("sessionStorage"),
              t(", "),
              c("IndexedDB"),
              t(", and standard HTTP browser caching."),
            ],
          ],
        },
      ],
    },
    {
      id: "cookie-inventory",
      number: "3",
      title: "Complete Inventory of Cookies Used by Collate",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "The table below documents every cookie and token mechanism associated with using Collate."
            ),
          ],
        },
        {
          type: "table",
          caption: "Complete inventory of first-party and essential partner cookies.",
          headers: [
            "Cookie / Token",
            "Provider",
            "Category",
            "Purpose",
            "Security Flags & Duration",
          ],
          rows: [
            [
              "__Host-collate_session (Production) / collate_session (Local dev)",
              "Collate (First-party)",
              "Strictly Necessary (Authentication)",
              "Maintains your signed-in session across pages and authorizes authenticated API requests",
              "HttpOnly, SameSite=Lax, Secure (production), Path=/; expires after 7 days or immediately on sign-out, password reset, or account deletion",
            ],
            [
              "__cf_bm and Cloudflare Turnstile security tokens",
              "Cloudflare (Essential Security Partner)",
              "Strictly Necessary (Security & Bot Protection)",
              "Protects sign-up, sign-in, password reset, and edge endpoints from automated bot abuse and DDoS attacks",
              "Typically 30 minutes (__cf_bm) or short-lived single-use verification token (Turnstile)",
            ],
            [
              "Hosted Checkout Session Cookies",
              "Polar.sh (USD) and Paystack (NGN)",
              "Strictly Necessary (Payment Processing, third-party checkout domain only)",
              "Set ONLY after you navigate to Polar.sh or Paystack's external hosted checkout page to process payment securely, prevent fraud, and calculate applicable sales tax/VAT",
              "Governed by Polar.sh and Paystack's cookie policies during checkout",
            ],
            [
              "collate_analytics_consent (Visitors) & account consent record (Signed-in users)",
              "Collate (First-party)",
              "Preference Storage",
              "Remembers whether you accepted optional analytics cookies. For signed-in users who accept, your choice is saved permanently on your account until you change it; for signed-in users who decline, the record is automatically discarded after 7 days so you are asked again. For visitors who accept, remembered persistently until cleared; for visitors who decline, held only for the current tab visit",
              "SameSite=Lax, Path=/ (1 year if accepted by a visitor); permanent on account when accepted by signed-in users, 7-day automatic expiry when declined",
            ],
            [
              "_ga and _ga_* (Google Analytics 4)",
              "Google Analytics (Optional Analytics Partner)",
              "Optional Analytics (Opt-In Only)",
              "Measures aggregate page views and site traffic trends strictly after you click Accept analytics. Never loaded or set if you decline or have not opted in",
              "Loaded only after explicit opt-in consent; cleared immediately if you switch to Decline",
            ],
          ],
        },
        {
          type: "subheading",
          title: "How Collate Protects Session Cookies",
        },
        {
          type: "list",
          items: [
            [
              b("Server-Side Token Hashing: "),
              t("Your browser holds an opaque random token inside "),
              c("__Host-collate_session"),
              t(
                ", while Collate's database stores only a SHA-256 hash of that token. A fresh token is generated on every sign-in to prevent session fixation."
              ),
            ],
            [
              b("Script Isolation (HttpOnly): "),
              t("Client-side JavaScript cannot read or modify "),
              c("__Host-collate_session"),
              t(", reducing token-theft risk."),
            ],
            [
              b("Cross-Site Request Protection: "),
              t("Collate pairs "),
              c("SameSite=Lax"),
              t(" cookies with server-side "),
              c("Origin"),
              t(" validation on mutations and "),
              c("Cache-Control: private, no-store"),
              t(" headers on authenticated API responses."),
            ],
            [
              b("Immediate Revocation: "),
              t(
                "Signing out, resetting your password, or deleting your account immediately deletes the server-side session record and instructs your browser to clear the cookie."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "browser-storage",
      number: "4",
      title: "Browser Storage, Caching, and Client-Side State",
      blocks: [
        {
          type: "list",
          items: [
            [
              b("Minimal Browser Storage: "),
              t(
                "Collate does not write private manuscript drafts or advertising profiles into browser storage. Only your cookie preference state ("
              ),
              c("localStorage"),
              t(" when a visitor accepts analytics, or tab-scoped "),
              c("sessionStorage"),
              t(" when a visitor declines for the current visit) is stored locally."),
            ],
            [
              b("Ephemeral In-Memory UI State: "),
              t(
                "While a tab is open, your browser holds temporary UI state in JavaScript memory (RAM) only for that page view, including active form inputs, unsaved editor edits prior to saving, toast notifications, navigation progress indicators, and short-lived Cloudflare Turnstile tokens awaiting submission. Closing or refreshing the tab clears this in-memory state."
              ),
            ],
            [
              b("Typography Stylesheets: "),
              t("Collate loads its editorial fonts ("),
              c("Newsreader"),
              t(" and "),
              c("Plus Jakarta Sans"),
              t(") from Google Fonts ("),
              c("fonts.googleapis.com"),
              t(" and "),
              c("fonts.gstatic.com"),
              t(
                ") solely for typography rendering without setting advertising or tracking cookies."
              ),
            ],
            [
              b("Standard HTTP Asset Caching: "),
              t(
                "Your browser's standard HTTP cache may temporarily store public static assets (compiled scripts, CSS, fonts, and public illustrations) to load pages quickly. Authenticated API responses explicitly disable caching via "
              ),
              c("Cache-Control: private, no-store"),
              t("."),
            ],
          ],
        },
      ],
    },
    {
      id: "legal-basis-exemption",
      number: "5",
      title: "Legal Basis and Strictly Necessary Exemption (ePrivacy, GDPR, UK GDPR, and NDPA)",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Electronic privacy and data protection laws, including the EU ePrivacy Directive (Article 5(3)), the UK Privacy and Electronic Communications Regulations (PECR), the EU/UK GDPR, and the Nigeria Data Protection Act 2023 (NDPA 2023), distinguish between optional tracking cookies and strictly necessary cookies. Prior opt-in consent is not required for mechanisms strictly necessary to:"
            ),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Deliver a Service Explicitly Requested by You: "),
              t("Maintaining your authenticated session via "),
              c("__Host-collate_session"),
              t(" after you sign in to access your projects, chapters, and exports."),
            ],
            [
              b("Ensure Transmission Security and Prevent Fraud: "),
              t("Operating Cloudflare Turnstile and "),
              c("__cf_bm"),
              t(
                " security tokens to protect sign-up, sign-in, password reset, and service uptime against automated abuse, or completing a credit-pack checkout you initiate on Polar.sh or Paystack."
              ),
            ],
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Opt-In Analytics Consent & Periodic Renewal: "),
            t(
              "Optional Google Analytics 4 scripts and cookies never load until you actively choose Accept analytics in our bottom cookie preferences popup. For signed-in users, accepting is saved permanently on your account across sessions until you change it, while declining is kept for 7 days and then automatically discarded so we ask you again. For visitors who are not signed in, accepting is remembered unless your browser clears site data, while declining applies only to the current visit so you are asked again on subsequent visits. You can also reopen Cookie preferences at any time from the site footer."
            ),
          ],
        },
      ],
    },
    {
      id: "managing-cookies",
      number: "6",
      title: "Managing, Blocking, and Clearing Cookies",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t("You can inspect, block, or clear cookies at any time using your browser settings:"),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Google Chrome: "),
              t(
                "Open Settings > Privacy and security > Third-party cookies (or Site settings > Cookies and site data) to view, block, or clear site data."
              ),
            ],
            [
              b("Mozilla Firefox: "),
              t(
                "Open Settings > Privacy & Security > Cookies and Site Data > Manage Data to remove individual site cookies or adjust Enhanced Tracking Protection."
              ),
            ],
            [
              b("Apple Safari (macOS and iOS): "),
              t(
                "On macOS, open Safari > Settings > Privacy > Manage Website Data. On iOS, open Settings > Apps > Safari > Advanced > Website Data."
              ),
            ],
            [
              b("Microsoft Edge: "),
              t(
                "Open Settings > Cookies and site permissions > Manage and delete cookies and site data."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "Impact of Blocking Strictly Necessary Cookies",
        },
        {
          type: "list",
          items: [
            [
              b("Blocking the Session Cookie: "),
              t("Blocking or deleting "),
              c("__Host-collate_session"),
              t(
                " prevents you from staying signed in, opening dashboard pages, saving projects, editing chapters, or downloading exports."
              ),
            ],
            [
              b("Blocking Cloudflare Security Tokens: "),
              t(
                "Blocking Cloudflare Turnstile scripts or security tokens may cause sign-up, sign-in, or protected form requests to fail bot verification until allowed."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "third-party-domains",
      number: "7",
      title: "Third-Party Checkout Pages and External Source Links",
      blocks: [
        {
          type: "list",
          items: [
            [
              b("Hosted Payment Checkouts (Polar.sh and Paystack): "),
              t(
                "When you buy a credit pack, Collate redirects your browser to Polar.sh (USD) or Paystack (NGN). Those independent checkout domains set their own strictly necessary session, fraud-prevention, and regional tax/VAT cookies governed by Polar.sh and Paystack's respective policies."
              ),
            ],
            [
              b("External Source and Media Links: "),
              t(
                "Clicking a verified DOI link, publisher page, or open-license figure attribution opens a third-party website outside Collate's control, governed by that publisher's or repository's own cookie and privacy policies."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "updates-contact",
      number: "8",
      title: "Updates to This Policy and Contact Information",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "We may revise this Cookie & Local Storage Policy periodically to reflect changes in our technical architecture, security partners, payment providers, or applicable law. Material updates will update the Last Updated date at the top of this page and, where required by law, collect prior consent before any non-essential cookie is activated."
            ),
          ],
        },
        {
          type: "paragraph",
          runs: [
            t("Questions about cookies, session security, or your privacy rights can be sent to "),
            privacyMail,
            t(". See also our "),
            a("Privacy Policy", "/privacy"),
            t(" and "),
            a("Terms of Service", "/terms"),
            t("."),
          ],
        },
      ],
    },
  ],
};
