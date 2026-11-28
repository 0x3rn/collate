import { LEGAL_CONFIG } from "./config";
import { a, b, c, t, type LegalDocumentData } from "./types";

const privacyMail = a(LEGAL_CONFIG.privacyEmail, `mailto:${LEGAL_CONFIG.privacyEmail}`);

export const PRIVACY_POLICY: LegalDocumentData = {
  slug: "/privacy",
  title: "Privacy Policy",
  subtitle:
    "How Collate collects, processes, protects, and deletes your personal and research data in alignment with NDPA 2023, EU GDPR, UK GDPR, and US state privacy laws.",
  effectiveDate: LEGAL_CONFIG.effectiveDate,
  lastUpdated: LEGAL_CONFIG.lastUpdated,
  intro: [
    [
      t("This Privacy Policy explains how "),
      b(LEGAL_CONFIG.operatorName),
      t(
        ' ("Collate", "we", "us", or "our") collects, uses, stores, shares, and protects personal data when you access or use the Collate web application at '
      ),
      a(LEGAL_CONFIG.siteUrl, LEGAL_CONFIG.siteUrl),
      t(
        ', our application programming interfaces ("APIs"), background research and drafting workflows, document export services, and transactional email communications (collectively, the "Service").'
      ),
    ],
  ],
  sections: [
    {
      id: "scope-controller",
      number: "1",
      title: "Scope, Legal Frameworks, and Data Controller",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate is an academic research, citation verification, outline planning, and manuscript drafting Software-as-a-Service (SaaS) platform. We process personal data in compliance with the "
            ),
            b("Nigeria Data Protection Act 2023 (NDPA 2023)"),
            t(", the "),
            b("European Union General Data Protection Regulation (EU GDPR)"),
            t(", the "),
            b("United Kingdom General Data Protection Regulation (UK GDPR)"),
            t(
              " and Data Protection Act 2018, and applicable US state privacy laws, including the "
            ),
            b(
              "California Consumer Privacy Act as amended by the California Privacy Rights Act (CCPA/CPRA)"
            ),
            t("."),
          ],
        },
        {
          type: "paragraph",
          runs: [
            t("For purposes of applicable data protection laws, "),
            b(LEGAL_CONFIG.operatorName),
            t(
              " is the Data Controller responsible for your personal data processed through the Service. Our privacy team can be reached at "
            ),
            privacyMail,
            t("."),
          ],
        },
      ],
    },
    {
      id: "data-collected",
      number: "2",
      title: "Categories of Personal Data We Collect",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "We practice strict data minimization and collect only the information reasonably necessary to operate, secure, and support the Service."
            ),
          ],
        },
        {
          type: "subheading",
          title: "2.1 Account and Identity Data",
        },
        {
          type: "list",
          items: [
            [
              b("Profile Details: "),
              t("Your full name, email address, and email verification status."),
            ],
            [
              b("Authentication Credentials: "),
              t("A salted "),
              b("PBKDF2-SHA256"),
              t(
                " cryptographic password hash (derived using 100,000 iterations and a unique 16-byte random salt per account). Your plaintext password is never stored or logged."
              ),
            ],
            [
              b("Optional Academic Context: "),
              t(
                "Academic level, field of study, institution name, and supervisor instructions that you voluntarily enter when creating or configuring a research project."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "2.2 Research and Project Data",
        },
        {
          type: "list",
          items: [
            [
              b("Project Inputs and Planning: "),
              t(
                "Project titles, document type (project, research paper, thesis, or assignment), target length, formatting preferences, research questions, feasibility reports, structured outlines, chapter briefs, and pre-start or revision instructions."
              ),
            ],
            [
              b("User-Provided Files and Notes: "),
              t(
                "Uploaded CSV datasets (including parsed column metadata and statistical summaries) and Markdown or plain-text notes attached to chapters."
              ),
            ],
            [
              b("Source Metadata and Verification Records: "),
              t(
                "Retrieved bibliographic metadata (titles, authors, DOIs, venues, publication years, abstracts, and open-access URLs), extracted source passages, claim-to-source verification verdicts, and openly licensed academic figures selected for your project."
              ),
            ],
            [
              b("Drafts, Reports, and Exports: "),
              t(
                "Generated and manually edited chapter versions, internal similarity and originality reports, and exported PDF and Microsoft Word (.docx) documents stored in encrypted object storage."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "2.3 Billing and Transaction Metadata",
        },
        {
          type: "list",
          items: [
            [
              b("Credit and Ledger Records: "),
              t(
                "Selected credit packs, credit balances, per-operation credit reservations, captures, and automatic or manual refunds recorded in our immutable credit ledger."
              ),
            ],
            [
              b("Payment Provider References: "),
              t(
                "Payment provider name, transaction reference identifier, currency (USD or NGN), transaction amount in minor units, payment status, and webhook confirmation records."
              ),
            ],
            [
              b("No Card or Bank Credentials: "),
              t("Payment card numbers, CVVs, and bank account credentials "),
              b("never touch Collate servers"),
              t(". All checkouts are handled directly by our payment providers."),
            ],
          ],
        },
        {
          type: "subheading",
          title: "2.4 Security, Technical, and Operational Data",
        },
        {
          type: "list",
          items: [
            [
              b("Network and Session Metadata: "),
              t(
                "Your IP address (read from our hosting provider's network headers for rate limiting, bot mitigation, and abuse prevention), truncated user-agent string, session expiry timestamps, and SHA-256 hashes of session, email verification, and password reset tokens (raw tokens are never stored in our database)."
              ),
            ],
            [
              b("Notification Preferences: "),
              t(
                "Your transactional email preferences for chapter-ready alerts, needs-attention alerts, project-completion alerts, and payment receipts."
              ),
            ],
            [
              b("Operational and Audit Logs: "),
              t(
                "Structured operational logs, workflow job cost and latency records, scrubbed error diagnostics (when enabled), and security audit events (sign-ins, failed authentication attempts, password resets, and account deletions). Passwords, API keys, authorization headers, cookies, and session tokens are automatically redacted before logs or diagnostics are recorded."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "legal-bases",
      number: "3",
      title: "How and Why We Process Personal Data (Legal Bases)",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t("Under the NDPA 2023, EU GDPR, and UK GDPR, we rely on the following legal bases:"),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Performance of a Contract (Article 6(1)(b) GDPR / Section 25(1)(b)(i) NDPA): "),
              t(
                "Processing account, project, research, and billing metadata to authenticate your session, verify your email, execute topic feasibility screening, plan outlines, draft and revise chapters, verify citations, run originality checks, export PDF and Word documents, manage your credit balance, and send requested transactional emails."
              ),
            ],
            [
              b("Legitimate Interests (Article 6(1)(f) GDPR / Section 25(1)(b)(v) NDPA): "),
              t(
                "Processing IP addresses, rate-limit counters, bot-protection signals, security audit logs, and scrubbed error telemetry to protect Collate against credential stuffing, automated abuse, fraud, CSRF attacks, unauthorized access, and service disruptions."
              ),
            ],
            [
              b(
                "Payment Disputes (Legitimate Interests / Establishing or Defending Legal Claims): "
              ),
              t(
                "Recording when you sign up, sign in, accept our Terms at checkout, and download files (with the IP address, device type, and approximate location of each), and, only if a payment is refunded or disputed, sharing those records with the payment provider that processed the payment, and through them with the card network or bank handling the dispute, to show that the purchase was authorized and the service was delivered."
              ),
            ],
            [
              b(
                "Compliance with Legal Obligations (Article 6(1)(c) GDPR / Section 25(1)(b)(ii) NDPA): "
              ),
              t(
                "Retaining payment references, credit transaction records, and invoicing metadata required by applicable tax, financial reporting, anti-fraud, and accounting laws, and responding to valid legal orders."
              ),
            ],
            [
              b("Consent (Article 6(1)(a) GDPR / Section 25(1)(a) NDPA): "),
              t(
                "Where required by law, we rely on your consent for optional notifications or features. You may toggle optional email notifications anytime on your "
              ),
              a("Account page", "/account"),
              t(" without affecting core platform access."),
            ],
          ],
        },
      ],
    },
    {
      id: "zero-training-originality",
      number: "4",
      title: "Zero Model Training and Originality Privacy Protections",
      blocks: [
        {
          type: "callout",
          tone: "accent",
          title: "Your Unpublished Research Never Trains AI Models",
          runs: [
            t(
              "Your research topics, unpublished CSV datasets, Markdown notes, supervisor instructions, and manuscript drafts are never sold and never used to train, fine-tune, or improve third-party AI foundation models."
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Serverless Enterprise Inference Only: "),
              t(
                "Drafting, extraction, classification, and claim-verification calls are routed strictly through serverless enterprise AI APIs (including ephemeral semantic embeddings) under API terms that prohibit training on customer prompts or outputs."
              ),
            ],
            [
              b("Irreversible 5-Gram Shingle Hashing for Cross-Project Originality: "),
              t(
                "To guard against unintended duplication across manuscripts on similar topics, Collate's cross-user originality gate compares drafts using Jaccard similarity over "
              ),
              b("irreversible one-way 32-bit FNV-1a hashes of normalized 5-word sequences"),
              t(
                ", capped per chapter version. These hashes never contain your raw prose, citations, titles, or personal identity, and cannot be reversed to read or reconstruct your writing."
              ),
            ],
            [
              b("Strict Per-User Isolation: "),
              t(
                "All project workspaces, retrieved passages, uploaded datasets, chapter versions, and exported files are isolated by user ID in our database and file storage. No other user can browse, search, or access your private work."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "subprocessors",
      number: "5",
      title: "Sub-processors and Third-Party Service Providers",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "We engage vetted infrastructure, payment, AI inference, email, and error-monitoring providers solely to operate Collate. Each sub-processor receives only the minimum data necessary for its role."
            ),
          ],
        },
        {
          type: "table",
          caption: "Sub-processors and external services integrated with Collate.",
          headers: ["Provider", "Purpose", "Data Shared"],
          rows: [
            [
              "Cloudflare, Inc. (Workers, D1, R2, Workflows, Browser Rendering, Images, Workers AI, Turnstile)",
              "Edge hosting, relational database, encrypted object storage, durable workflows, headless PDF rendering, ephemeral semantic embeddings, and bot protection",
              "Account profile, hashed credentials, project data, uploaded datasets, drafts, exports, IP address, and Turnstile verification tokens",
            ],
            [
              "Polar Software, Inc. (Polar.sh)",
              "Merchant of Record for USD checkouts, global sales tax and VAT compliance, invoicing, receipts, and refunds",
              "Account email, display name, user ID metadata, selected credit pack, currency, amount, and billing details entered at Polar checkout",
            ],
            [
              "Paystack",
              "Payment processing for Nigerian Naira (NGN) checkouts, transaction verification, and refunds",
              "Account email, user ID metadata, selected credit pack, currency, amount, and payment details entered at Paystack checkout",
            ],
            [
              "Google Cloud (Vertex AI / Gemini)",
              "Serverless AI inference for academic drafting, outline planning, classification, and claim verification",
              "System prompts, retrieved source excerpts, chapter context, and drafting instructions (no model training on API data)",
            ],
            [
              "DeepSeek",
              "Serverless AI inference for structured extraction and verification tasks",
              "System prompts, relevant source excerpts, and structured task inputs (no model training on API data)",
            ],
            [
              "Cloudflare, Inc. (Email Service)",
              "Sending account email (verification and reset codes, notifications, receipts, replies, and announcements) and receiving email sent to our addresses",
              "Recipient email address, display name, email content, and any attachments you send us",
            ],
            [
              "Google LLC (Sign in with Google, optional)",
              "Signing in with a Google account when you choose to",
              "Your Google account email address, name, and whether Google has verified that email",
            ],
            [
              "Telegram (internal alerts)",
              "Instant alerts to the Collate operator about payments, failures, and new support email",
              "Account email, payment amount, and the first lines of emails you send us",
            ],
            [
              "Research index and open-media providers (academic metadata and DOI registries, open-access repositories, and openly licensed image libraries)",
              "Literature discovery, DOI and citation verification, open-access lookup, and openly licensed academic figure search",
              "Topic and keyword search queries or DOIs only; zero personal account data, user names, emails, or private drafts are transmitted",
            ],
            [
              "Sentry (when configured)",
              "Application error monitoring and crash diagnostics",
              "Stack traces, environment tags, and scrubbed diagnostic context (passwords, cookies, tokens, and API keys are redacted)",
            ],
          ],
        },
        {
          type: "paragraph",
          runs: [
            t(
              "Where supplementary web search providers are used for institutional reports or public statistics, only derived search query strings are transmitted, never your personal account identifiers or uploaded files."
            ),
          ],
        },
      ],
    },
    {
      id: "cookies-summary",
      number: "6",
      title: "Cookies and Similar Technologies",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate uses strictly necessary cookies only. In production, we set a single first-party session cookie named "
            ),
            c("__Host-collate_session"),
            t(" with "),
            c("HttpOnly"),
            t(", "),
            c("Secure"),
            t(", "),
            c("SameSite=Lax"),
            t(", and "),
            c("Path=/"),
            t(
              " flags to keep you signed in, alongside bot-protection security tokens on protected forms. We do not deploy third-party advertising networks, behavioral tracking cookies, or cross-site analytics scripts. See our full "
            ),
            a("Cookie Policy", "/cookies"),
            t(" for a complete cookie inventory and browser controls."),
          ],
        },
      ],
    },
    {
      id: "international-transfers",
      number: "7",
      title: "International Data Transfers",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate runs on a global edge network and integrates with cloud, payment, and AI providers operating across jurisdictions including the United States, the European Economic Area (EEA), the United Kingdom, and Nigeria. Whenever personal data is transferred outside Nigeria, the EEA, or the UK to jurisdictions without an adequacy decision:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              t("We rely on legally recognized transfer safeguards, including the "),
              b("European Commission Standard Contractual Clauses (SCCs)"),
              t(", the "),
              b("UK International Data Transfer Addendum (IDTA)"),
              t(", and "),
              b("NDPA 2023 cross-border data transfer protections"),
              t("."),
            ],
            [
              t("All data in transit is encrypted via "),
              b("HTTPS / TLS 1.3"),
              t(" with Strict Transport Security, and stored data is encrypted at rest."),
            ],
          ],
        },
      ],
    },
    {
      id: "retention-deletion",
      number: "8",
      title: "Data Retention and Self-Service Account Deletion",
      blocks: [
        {
          type: "list",
          items: [
            [
              b("Active Accounts: "),
              t(
                "Your profile, projects, research sources, uploaded CSV datasets, chapter versions, originality reports, and exported files are retained while your account remains active or until you delete individual projects or your entire account."
              ),
            ],
            [
              b("Ephemeral Auth Tokens: "),
              t(
                "Email verification tokens expire after 24 hours; password reset tokens expire after 1 hour (and are immediately invalidated upon use); active session records expire after 7 days and are purged immediately upon sign-out or password change."
              ),
            ],
            [
              b("Immediate Self-Service Account Deletion: "),
              t("You may permanently delete your account at any time directly from your "),
              a("Account settings page", "/account"),
              t(
                ' by re-entering your current password and confirming with "DELETE MY ACCOUNT". Upon confirmation, Collate immediately deletes your stored files (source snapshots, chapter drafts, uploaded datasets, and PDF/Word exports), executes a cascading deletion across our database removing your profile, credentials, sessions, projects, outlines, citations, originality reports, and shingle hashes, clears your session cookie, and retains only an anonymized account-erasure audit counter containing zero personal identifiers.'
              ),
            ],
            [
              b("Statutory Billing and Anti-Fraud Records: "),
              t(
                "Completed financial transaction references, tax/VAT invoices, and anti-fraud records are retained only for periods required by applicable tax, financial, and accounting laws (and by our payment providers under their independent compliance obligations)."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "security",
      number: "9",
      title: "Security Measures",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate implements defense-in-depth engineering controls across every layer of the platform:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Credential Hardening: "),
              t(
                "Minimum 12-character passwords screened against common breached passwords, hashed with PBKDF2-SHA256 (100,000 iterations, random 16-byte salts) using constant-time verification. Session and verification tokens are stored solely as SHA-256 digests."
              ),
            ],
            [
              b("Session, CSRF, and IDOR Defenses: "),
              t("Production "),
              c("__Host-"),
              t(
                " cookies with HttpOnly, Secure, and SameSite=Lax attributes, server-side Origin checks on state-changing requests, relative redirect validation, and strict server-side resource ownership checks on every project, chapter, dataset, and export route."
              ),
            ],
            [
              b("Cryptographic Webhooks and Signed Downloads: "),
              t(
                "Payment webhooks are verified with constant-time HMAC signatures and replay protection. Document exports are delivered via time-limited HMAC-SHA256 signed URLs."
              ),
            ],
            [
              b("Browser and Network Protections: "),
              t(
                "Strict Transport Security (HSTS preload), Content Security Policy, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, rate limiting, and SSRF filtering blocking private and loopback IP addresses during source fetches."
              ),
            ],
          ],
        },
        {
          type: "paragraph",
          runs: [
            t(
              "No internet-connected system can guarantee absolute security. If you discover a security vulnerability or suspect unauthorized account access, contact "
            ),
            privacyMail,
            t(" immediately."),
          ],
        },
      ],
    },
    {
      id: "privacy-rights",
      number: "10",
      title: "Your Privacy Rights (NDPA, GDPR, UK GDPR, and US State Laws)",
      blocks: [
        {
          type: "subheading",
          title: "10.1 Rights Under NDPA 2023, EU GDPR, and UK GDPR",
        },
        {
          type: "list",
          items: [
            [
              b("Right of Access: "),
              t("Request confirmation of processing and obtain a copy of your personal data."),
            ],
            [
              b("Right to Rectification: "),
              t("Correct inaccurate or incomplete profile, project, or preference data."),
            ],
            [
              b("Right to Erasure: "),
              t("Permanently erase your account and research files immediately on "),
              a("/account", "/account"),
              t(" or via email request."),
            ],
            [
              b("Right to Data Portability: "),
              t(
                "Export your manuscripts in standard PDF and Word (.docx) formats directly from your workspace, or request a machine-readable export of your account record."
              ),
            ],
            [
              b("Right to Restriction and Objection: "),
              t(
                "Request restriction of processing or object to processing based on legitimate interests."
              ),
            ],
            [
              b("Right to Withdraw Consent: "),
              t(
                "Withdraw consent for optional email notifications at any time without affecting prior lawful processing."
              ),
            ],
            [
              b("Right to Lodge a Complaint: "),
              t("File a complaint with a supervisory authority, including the "),
              b("Nigeria Data Protection Commission (NDPC)"),
              t(", your EU Member State Data Protection Authority, or the "),
              b("UK Information Commissioner's Office (ICO)"),
              t("."),
            ],
          ],
        },
        {
          type: "subheading",
          title: "10.2 Disclosures for California and US State Residents (CCPA/CPRA)",
        },
        {
          type: "list",
          items: [
            [
              b("Know, Access, Correct, and Delete: "),
              t(
                "Request disclosure of the categories and specific pieces of personal information collected, request correction, or delete your account directly on /account."
              ),
            ],
            [
              b("No Sale or Cross-Context Behavioral Sharing: "),
              t("Collate does "),
              b("not"),
              t(" sell personal information and does "),
              b("not"),
              t(" share personal information for cross-context behavioral advertising."),
            ],
            [
              b("Non-Discrimination: "),
              t("We never discriminate against users for exercising statutory privacy rights."),
            ],
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Exercising Your Rights: "),
            t("Email "),
            privacyMail,
            t(
              " to submit any privacy request. We verify request identity via your registered email or active session and respond within "
            ),
            b("30 days"),
            t(" (or sooner where required by applicable law)."),
          ],
        },
      ],
    },
    {
      id: "automated-processing",
      number: "11",
      title: "Automated Processing and AI Transparency",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate uses automated workflows and AI language models to assist with research query planning, topic feasibility scoring, outline generation, section drafting, claim-to-source verification, and originality checks. Collate does "
            ),
            b("not"),
            t(
              " make solely automated decisions that produce legal or similarly significant effects concerning you within the meaning of Article 22 GDPR or Section 37 NDPA 2023. You remain in complete control of reviewing, editing, approving, or discarding every output."
            ),
          ],
        },
      ],
    },
    {
      id: "children-updates-contact",
      number: "12",
      title: "Children's Privacy, Policy Updates, and Contact",
      blocks: [
        {
          type: "paragraph",
          runs: [
            b("Children's Privacy: "),
            t(
              "Collate is built for university students, researchers, and adult academic authors. We do not knowingly collect personal data from individuals under "
            ),
            b("16 years of age"),
            t(
              " (or under 18 without verifiable parental or guardian consent where required by applicable law, including the NDPA 2023). If you believe an unauthorized minor has registered an account, email "
            ),
            privacyMail,
            t(" so we can promptly investigate and delete the account."),
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Policy Updates: "),
            t(
              "We may update this Privacy Policy periodically to reflect changes in our architecture, sub-processors, or legal obligations. Material changes will be reflected in the Last Updated date and communicated by email or in-app notice where appropriate."
            ),
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Privacy Contact: "),
            t("Direct all privacy questions, data-subject requests, or security reports to "),
            privacyMail,
            t("."),
          ],
        },
      ],
    },
  ],
};
