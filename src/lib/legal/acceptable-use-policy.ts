import { LEGAL_CONFIG } from "./config";
import { a, b, c, t, type LegalDocumentData } from "./types";

const abuseMail = a(LEGAL_CONFIG.abuseEmail, `mailto:${LEGAL_CONFIG.abuseEmail}`);
const supportMail = a(LEGAL_CONFIG.supportEmail, `mailto:${LEGAL_CONFIG.supportEmail}`);

export const ACCEPTABLE_USE_POLICY: LegalDocumentData = {
  slug: "/acceptable-use",
  title: "Acceptable Use Policy",
  subtitle:
    "Academic integrity boundaries, prohibited content standards, file upload rules, platform security expectations, and Merchant of Record compliance requirements.",
  effectiveDate: LEGAL_CONFIG.effectiveDate,
  lastUpdated: LEGAL_CONFIG.lastUpdated,
  intro: [
    [
      t(
        'This Acceptable Use Policy ("AUP") governs all access to and use of Collate, including our web application, APIs, feasibility sweeps, drafting workflows, citation and originality utilities, file upload features, exported manuscripts, free-tier quotas, and prepaid credit-pack services at '
      ),
      a(LEGAL_CONFIG.siteUrl, LEGAL_CONFIG.siteUrl),
      t(". This AUP forms part of our "),
      a("Terms of Service", "/terms"),
      t(
        " and aligns with applicable laws, university academic integrity standards, and the Acceptable Use and Restricted Business policies of our Merchant of Record, Polar.sh, and its underlying payment partners."
      ),
    ],
  ],
  sections: [
    {
      id: "purpose-scope",
      number: "1",
      title: "Purpose, Scope, and Core Principle",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate is an academic research, source verification, citation formatting, and manuscript drafting workspace designed to support legitimate scholarship, literature synthesis, feasibility screening, structure planning, and responsible manuscript preparation. By creating an account, purchasing credits, uploading data, or generating or exporting content through Collate, you agree to use the Platform lawfully, ethically, and transparently. A violation of this AUP constitutes a material breach of Collate's Terms of Service."
            ),
          ],
        },
      ],
    },
    {
      id: "academic-integrity",
      number: "2",
      title: "Academic Integrity and Responsible Scholarship",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate is an assistive research and drafting workspace, not a substitute for genuine human scholarship, empirical inquiry, or institutional oversight."
            ),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Institutional and Publisher Compliance: "),
              t(
                "You must comply with all academic integrity codes, honor codes, course syllabi, thesis regulations, employer policies, funding-agency mandates, and journal or conference AI-disclosure rules applicable to your work. Where disclosure of AI-assisted literature screening, outlining, editing, or drafting is required, you must disclose your use of Collate accurately and in good faith."
              ),
            ],
            [
              b("Independent Verification and Authorship Responsibility: "),
              t(
                "You must independently read, verify, fact-check, edit, and take full intellectual and authorship responsibility for every claim, figure, quotation, citation, and document you export from Collate. Automated citation checks, internal originality reports, writing-process logs, and draft AI-use disclosure statements are decision-support tools only; they do not guarantee institutional compliance or third-party detector scores."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "Strictly Prohibited Academic Misconduct",
        },
        {
          type: "list",
          items: [
            [
              b("Contract Cheating and Essay Mills: "),
              t(
                'Operating, supporting, or supplying an "essay mill", homework-for-hire business, or commercial ghostwriting service that resells, distributes, or submits Collate-generated outputs as human-ghostwritten essays, assignments, theses, or research papers on behalf of students or other third parties.'
              ),
            ],
            [
              b("Prohibited Exam and Assessment Assistance: "),
              t(
                "Using Collate to complete live proctored examinations, graded timed quizzes, closed-book or AI-prohibited coursework assessments, or mandatory professional licensing, accreditation, or regulatory compliance tests in breach of exam rules or on another person's behalf."
              ),
            ],
            [
              b("Empirical Data Fabrication: "),
              t(
                "Fabricating, inventing, altering, cherry-picking, or falsifying empirical laboratory measurements, clinical trial outcomes, statistical outputs, survey counts, participant demographics, experimental observations, or interview transcripts. Empirical findings presented in drafts must derive from genuine user-supplied data, properly cited public datasets, or clearly labelled non-fabricated analytical frameworks."
              ),
            ],
            [
              b("Citation and Attribution Forgery: "),
              t(
                "Fabricating, falsifying, or misrepresenting bibliographic references, DOIs, ISBNs, URLs, publication venues, peer-review status, or author attributions, or knowingly presenting unverified or retracted claims as verified academic literature."
              ),
            ],
            [
              b("License and Attribution Stripping: "),
              t(
                "Removing, obscuring, falsifying, or omitting required Creative Commons (such as CC BY or CC BY-SA) or other open-license attributions, copyright notices, or data-source credits from included figures, tables, datasets, or text excerpts."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "prohibited-content",
      number: "3",
      title: "Strictly Prohibited Content and Unlawful Conduct",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "In accordance with applicable law and the Merchant of Record and payment-processing standards enforced by Polar.sh and its payment partners, you may never use Collate to generate, upload, store, analyze, translate, or distribute any of the following:"
            ),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Child Sexual Abuse Material and Exploitation of Minors: "),
              t(
                "Absolute zero tolerance for Child Sexual Abuse Material (CSAM), child sexual exploitation and abuse (CSAE), grooming, or any sexualized, abusive, or exploitative content involving minors (real, fictional, or synthetic). No academic or analytical framing permits any exception."
              ),
            ],
            [
              b("Weapons, Terrorism, Violent Extremism, and Illegal Narcotics: "),
              t(
                "Actionable instructions, synthesis pathways, engineering blueprints, optimization guidance, or operational facilitation for chemical, biological, radiological, or nuclear (CBRN) weapons; explosives or incendiary devices; illegal firearms manufacture (including restricted 3D-printed components); terrorism, violent extremism, or incitement to physical violence; suicide or self-harm encouragement or instruction; or unlawful manufacture or trafficking of controlled substances."
              ),
            ],
            [
              b("Cyberattacks and Malicious Technical Material: "),
              t(
                "Creating, refining, testing, or distributing malware, ransomware, spyware, exploit payloads, botnets, credential-stuffing tools, phishing templates, deceptive social-engineering pretexts, or actionable material enabling unauthorized intrusion or vulnerability exploitation."
              ),
            ],
            [
              b("Harassment, Hate Speech, Doxxing, and Non-Consensual Content: "),
              t(
                "Severe hate speech promoting violence, discrimination, or dehumanization against protected groups; targeted harassment, stalking, extortion, or intimidation; doxxing; non-consensual intimate content or depictions of sexual violence; or coordinated defamatory campaigns."
              ),
            ],
            [
              b("Fraud, Financial Crime, and Counterfeit Credentials: "),
              t(
                "Financial scams, investment fraud, money laundering, terrorist financing, sanctions evasion, identity theft, counterfeit academic diplomas or transcripts, forged legal, medical, financial, regulatory, or immigration records, or deceptive impersonation of individuals, peer reviewers, journal editors, institutions, or authorities."
              ),
            ],
            [
              b("Copyright Infringement and Paywall Bypassing: "),
              t(
                "Infringing third-party copyrights, trademarks, or trade secrets; uploading or reproducing copyrighted books, paywalled journal corpora, or proprietary datasets without authorization; attempting to bypass publisher paywalls, DRM, or institutional subscription controls; or submitting confidential peer-review manuscripts or grant proposals without written authorization."
              ),
            ],
            [
              b("Unauthorized Sensitive and Regulated Data: "),
              t(
                "Uploading, soliciting, or processing un-anonymized Protected Health Information (PHI) under HIPAA or equivalent health-privacy laws; raw payment card numbers, CVVs, or banking credentials (PCI-DSS); government-issued identification numbers (SSN, NIN, passport, or tax identifiers) or biometric identifiers; or classified government, defense, or export-controlled data (ITAR/EAR)."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "security-financial-integrity",
      number: "4",
      title: "Platform Security, Technical, and Financial Integrity",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "You must respect the technical boundaries, availability, and billing integrity of Collate and its infrastructure providers. You may not:"
            ),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Circumvent Quotas, Rate Limits, or Anti-Bot Controls: "),
              t(
                "Bypass or manipulate API rate limits, free topic feasibility sweep quotas, credit reservation and deduction accounting, spend circuit breakers, or Cloudflare Turnstile challenges. Creating multiple, disposable, or automated accounts to farm free feasibility checks or promotional credits is strictly prohibited."
              ),
            ],
            [
              b("Conduct Unauthorized Security Probing or Attacks: "),
              t(
                "Perform automated scraping, bulk harvesting, load or stress testing, or denial-of-service attacks; attempt prompt injection, system-prompt extraction, or jailbreaking designed to expose internal instructions, secrets, or keys; probe for SSRF, path traversal, SQL injection, or XSS vulnerabilities; or reverse-engineer or mirror Collate's workflows or scoring engines except where expressly permitted by mandatory law."
              ),
            ],
            [
              b("Share Credentials or Resell Access: "),
              t(
                "Share account logins, session cookies, or password reset links across multiple users; pool personal accounts to bypass per-user limits; or resell, sublicense, white-label, or commercially redistribute access to Collate without a written institutional agreement."
              ),
            ],
            [
              b("Engage in Payment Fraud or Abusive Chargebacks: "),
              t(
                "Use stolen or unauthorized payment methods, misrepresent billing location or tax status, or initiate bad-faith payment disputes or friendly-fraud chargebacks through Polar.sh, Paystack, or your card issuer after consuming credits or receiving generated chapters. Report legitimate billing issues directly to "
              ),
              supportMail,
              t(" before opening a dispute."),
            ],
          ],
        },
      ],
    },
    {
      id: "file-upload-rules",
      number: "5",
      title: "User-Supplied Data and File Upload Rules",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate enables you to upload primary research datasets, notes, and instructions to ground chapter drafts in genuine materials. Every uploaded file must comply with these rules:"
            ),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Permitted Formats and Limits: "),
              t("Upload only clean, well-formed plain-text files in supported formats ("),
              c(".csv"),
              t(", "),
              c(".md"),
              t(", "),
              c(".markdown"),
              t(", or "),
              c(".txt"),
              t(") within published size and row limits."),
            ],
            [
              b("No Malicious or Disguised Payloads: "),
              t(
                "Never upload executable binaries, compiled code, scripts disguised with text extensions, polyglot files, compressed archives, macro payloads, or malformed inputs crafted to exploit parsers, databases, or document exporters."
              ),
            ],
            [
              b("Ownership and Authorization: "),
              t(
                "You must own the uploaded files or hold verifiable permission, license, or institutional authorization to upload and analyze them in Collate."
              ),
            ],
            [
              b("Human-Subjects De-Identification: "),
              t(
                "Before uploading survey responses, interview transcripts, clinical measurements, or observational records involving human participants, strip direct and indirect personal identifiers in accordance with your IRB or ethics approval and applicable privacy laws (NDPA 2023, GDPR, UK GDPR). Never upload un-anonymized private personal data of research subjects."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "dual-use-inquiry",
      number: "6",
      title: "Permitted Dual-Use Academic Inquiry",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate recognizes that legitimate scholarship in disciplines such as cybersecurity defense, criminology, epidemiology, public health, media studies, and political science examines sensitive subjects. High-level literature synthesis, theoretical critique, historical analysis, and defensive or policy evaluation are permitted, provided that:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              t(
                "Prompts and outputs remain strictly non-actionable with respect to harm, exploitation, weapons, or unlawful acts."
              ),
            ],
            [t("The project complies fully with Sections 2 through 5 of this AUP.")],
            [
              t(
                "No exception is ever claimed for CSAM, credible threats of violence, cyberattack payloads, fraud, or unauthorized regulated personal data, which remain unconditionally prohibited regardless of academic context."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "automated-safeguards",
      number: "7",
      title: "Automated Safeguards and Operational Controls",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "To protect users, academic reliability, and platform integrity, Collate operates automated technical and billing controls across the Service:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Traffic, Bot, and Spend Controls: "),
              t(
                "Automated request rate limiting, Cloudflare Turnstile bot protection on authentication routes, and per-chapter, per-user, and global spend circuit breakers designed to halt runaway or abusive compute consumption."
              ),
            ],
            [
              b("Verification and Originality Safeguards: "),
              t(
                "Automated DOI and bibliographic checks against bibliographic registries, grounding rules prohibiting fabricated empirical data, and privacy-preserving internal originality checks comparing irreversible one-way shingle hashes without exposing raw prose to other users."
              ),
            ],
            [
              b("Abuse and Fraud Screening: "),
              t(
                "Automated detection of anomalous failure bursts, multi-account farming, upload anomalies, and payment-dispute risks, operated in accordance with our "
              ),
              a("Privacy Policy", "/privacy"),
              t("."),
            ],
          ],
        },
      ],
    },
    {
      id: "enforcement-remedies",
      number: "8",
      title: "Enforcement, Remedies, and Legal Reporting",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate reserves the right, in its reasonable discretion, to investigate suspected AUP violations and apply immediate or graduated enforcement proportionate to the severity, risk, and history of the conduct:"
            ),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Automated Refusal and Content Quarantine: "),
              t(
                "Blocking non-compliant prompts or file uploads, halting active drafting workflows, or restricting export access to offending materials."
              ),
            ],
            [
              b("Warnings and Temporary Restrictions: "),
              t(
                "Issuing compliance notices, throttling generation quotas, or temporarily suspending account access pending identity, authorization, or billing verification."
              ),
            ],
            [
              b("Immediate Termination Without Refund: "),
              t("Permanently terminating accounts and revoking access "),
              b("without refund"),
              t(
                " of remaining credits or prior fees where a user commits a material, repeated, fraudulent, or severe violation (including operating an essay mill, abusive chargeback activity, security exploitation, or prohibited content under Section 3)."
              ),
            ],
            [
              b("Chargeback and Merchant of Record Defense: "),
              t(
                "Submitting relevant account, credit-ledger, verification, and export delivery logs to Polar.sh, Paystack, or financial institutions to contest fraudulent disputes and satisfy compliance obligations."
              ),
            ],
            [
              b("Law Enforcement and Regulatory Reporting: "),
              t(
                "Preserving evidence and reporting severe illegal activity, including any detected CSAM or credible, imminent threats of serious bodily harm, terrorism, or critical infrastructure attacks, to appropriate law enforcement, child-protection authorities (such as NCMEC or equivalent agencies), and regulators, and complying with valid subpoenas or court orders."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "reporting-appeals",
      number: "9",
      title: "Reporting Violations, Copyright Notices, and Appeals",
      blocks: [
        {
          type: "list",
          ordered: true,
          items: [
            [
              b("Reporting Abuse and Security Incidents: "),
              t(
                "Users, universities, rights holders, payment partners, and members of the public may report suspected AUP violations, contract-cheating operations, unlawful content, or security vulnerabilities to "
              ),
              abuseMail,
              t(
                ". Include relevant timestamps, URLs, project or transaction references (if known), and a clear summary."
              ),
            ],
            [
              b("Copyright and Open-License Attribution Notices: "),
              t(
                "Rights holders alleging copyright infringement or stripped open-license attribution may email "
              ),
              abuseMail,
              t(
                " identifying the work, the disputed material or attribution omission, contact details, and a good-faith statement that the use is unauthorized."
              ),
            ],
            [
              b("Enforcement Appeals: "),
              t(
                "If your account has been warned, suspended, or terminated and you believe the action resulted from a factual mistake, you may submit a written appeal within "
              ),
              b("14 calendar days"),
              t(" of the notice to "),
              supportMail,
              t(
                ' with the subject line "AUP Enforcement Appeal". We review timely appeals in good faith and issue a final determination, except where disclosure is restricted by law or where termination resulted from CSAM, confirmed payment fraud, or mandatory Merchant of Record compliance directives.'
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "updates-precedence",
      number: "10",
      title: "Policy Updates and Precedence",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate may update this Acceptable Use Policy from time to time to reflect changes in applicable law, Polar.sh and Paystack compliance standards, academic integrity norms, or platform capabilities. Material revisions will be reflected in the Last Updated date and communicated via email or in-app notice where appropriate. Where any provision of this AUP conflicts with another Collate policy regarding prohibited content, security, or payment compliance, the more protective restriction governs."
            ),
          ],
        },
      ],
    },
  ],
};
