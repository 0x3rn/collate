import { LEGAL_CONFIG } from "./config";
import { a, b, t, type LegalDocumentData } from "./types";

const supportMail = a(LEGAL_CONFIG.supportEmail, `mailto:${LEGAL_CONFIG.supportEmail}`);

export const TERMS_POLICY: LegalDocumentData = {
  slug: "/terms",
  title: "Terms of Service & Refund Policy",
  subtitle:
    "The contract governing your Collate account, prepaid credit packs, Merchant of Record billing via Polar.sh and Paystack, academic integrity responsibilities, and refund eligibility.",
  effectiveDate: LEGAL_CONFIG.effectiveDate,
  lastUpdated: LEGAL_CONFIG.lastUpdated,
  intro: [
    [
      t('These Terms of Service & Refund Policy ("Terms") govern your access to and use of '),
      b("Collate"),
      t(' (the "Platform" or "Service"), operated at '),
      a(LEGAL_CONFIG.siteUrl, LEGAL_CONFIG.siteUrl),
      t(
        ' ("Collate", "we", "us", or "our"). By creating an account, purchasing a prepaid credit pack, or using any feature of Collate, you agree to be bound by these Terms, our '
      ),
      a("Privacy Policy", "/privacy"),
      t(", our "),
      a("Acceptable Use Policy", "/acceptable-use"),
      t(", and our "),
      a("Cookie Policy", "/cookies"),
      t(". If you do not agree to these Terms, you must not access or use the Service."),
    ],
  ],
  sections: [
    {
      id: "platform-scope",
      number: "1",
      title: "Platform Positioning and Scope of Services",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate is a software-as-a-service (SaaS) research assistance and academic writing platform built to support students, researchers, and academic authors across structured project workflows. Specifically, Collate provides automated software tools that enable you to:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              t(
                "Verify topic feasibility and gather verifiable source passages against supported research indexes, such as academic metadata and DOI registries, open-access journal directories, and preprint and open-access repositories."
              ),
            ],
            [
              t(
                "Plan and organize structured chapter outlines, target page budgets, and research specifications for projects, research papers, theses, and assignments."
              ),
            ],
            [
              t(
                "Draft and revise academic chapters grounded in stored source metadata and user-supplied primary materials."
              ),
            ],
            [
              t(
                "Format in-text citations and reference lists deterministically in supported styles, including "
              ),
              b("APA 7"),
              t(", "),
              b("Harvard"),
              t(", "),
              b("MLA 9"),
              t(", "),
              b("IEEE"),
              t(", "),
              b("Chicago"),
              t(", and "),
              b("Vancouver"),
              t("."),
            ],
            [
              t(
                "Run internal similarity and originality checks against stored sources and anonymized internal project records."
              ),
            ],
            [
              t(
                "Attach your own primary research datasets, notes, and supervisor instructions in "
              ),
              b("CSV"),
              t(" and "),
              b("Markdown"),
              t(" formats."),
            ],
            [
              t("Export print-ready "),
              b("PDF"),
              t(" and Microsoft "),
              b("Word (.docx)"),
              t(
                " manuscripts, together with verified reference logs and supporting transparency documentation."
              ),
            ],
          ],
        },
        {
          type: "callout",
          tone: "accent",
          title: "Author Responsibility and Institutional Transparency",
          runs: [
            t(
              "Collate is an assistive research and drafting software tool, not an autonomous academic author, human ghostwriting agency, or institutional authority. You remain the sole author of your work and bear full responsibility for reviewing, verifying, editing, and approving every generated draft, citation, figure, and export. You are solely responsible for confirming compliance with your university, department, employer, or publisher's rules, supplying genuine primary empirical data where your research requires it, and submitting any required AI-use disclosure. To support institutional transparency, Collate provides an editable AI-use disclosure statement and a writing-process log that you may review, customize, and include with your submission."
            ),
          ],
        },
      ],
    },
    {
      id: "accounts-eligibility",
      number: "2",
      title: "Accounts, Eligibility, and Security",
      blocks: [
        {
          type: "list",
          items: [
            [
              b("Minimum Age: "),
              t("To register for and use Collate, you must be at least "),
              b("18 years old"),
              t(", or at least "),
              b("16 years old"),
              t(
                " with the verifiable consent and supervision of a parent or legal guardian who agrees to be bound by these Terms on your behalf. By creating an account, you represent and warrant that you meet these age requirements."
              ),
            ],
            [
              b("Accurate Registration: "),
              t(
                "You must provide accurate, current, and complete registration details (including a valid email address for account verification) and keep your account information up to date."
              ),
            ],
            [
              b("Account Security: "),
              t(
                "You are responsible for maintaining the confidentiality of your password and session credentials and for all activities occurring under your account. Notify us immediately at "
              ),
              supportMail,
              t(" if you suspect any unauthorized access or security breach."),
            ],
            [
              b("One Account Per Individual: "),
              t("You may maintain only "),
              b("one (1) active Collate account"),
              t(
                " per individual. Creating multiple or duplicate accounts to obtain additional free topic feasibility source checks, circumvent usage limits, or evade account restrictions is strictly prohibited."
              ),
            ],
            [
              b("Suspension and Termination: "),
              t(
                "We reserve the right to suspend, restrict, or terminate your account, with or without prior notice, if we reasonably determine that you have violated these Terms or our "
              ),
              a("Acceptable Use Policy", "/acceptable-use"),
              t(
                ", engaged in fraudulent payment activity, abused platform quotas or APIs, or posed a security or legal risk to Collate or other users."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "credits-billing",
      number: "3",
      title: "Prepaid Credit Packs, Pricing, and Billing",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t("Collate operates strictly on a "),
            b("one-time prepaid credit pack"),
            t(" model. We do "),
            b("not"),
            t(" charge recurring subscriptions or automatically renew your purchases."),
          ],
        },
        {
          type: "subheading",
          title: "3.1 Credit Pack Options",
        },
        {
          type: "table",
          caption: "Current one-time prepaid credit packs available on Collate.",
          headers: [
            "Credit Pack",
            "Included Credits",
            "USD Price (Polar.sh)",
            "NGN Price (Paystack)",
          ],
          rows: [
            ["Starter", "25 credits", "$10 USD", "NGN 10,000"],
            ["Project (Popular)", "100 credits", "$30 USD", "NGN 35,000"],
            ["Thesis", "200 credits", "$50 USD", "NGN 65,000"],
          ],
        },
        {
          type: "subheading",
          title: "3.2 Credit Terms and Usage Rules",
        },
        {
          type: "list",
          items: [
            [
              b("No Expiration: "),
              t(
                "Purchased credits do not expire as long as your Collate account remains active and in good standing."
              ),
            ],
            [
              b("Non-Transferable and No Cash Value Outside Refunds: "),
              t(
                "Credits are tied to your individual account, cannot be transferred, sold, or shared between accounts, and hold no cash or monetary value outside eligible cash refunds expressly granted under Section 5."
              ),
            ],
            [
              b("Free Topic Source Checks: "),
              t("Every newly registered account receives "),
              b("3 free topic feasibility source checks"),
              t(". Additional topic feasibility source checks beyond the 3 free checks consume "),
              b("2 credits"),
              t(" per check."),
            ],
            [
              b("Chapter Drafting, Revisions, and Free Light Edit: "),
              t("Chapter drafting consumes "),
              b("1 credit per target page"),
              t(", subject to a "),
              b("minimum of 2 credits per run"),
              t(
                ". Whole-chapter revisions consume the chapter's full credit estimate, while targeted section revisions consume a proportional credit share (always displayed clearly for confirmation before execution). Manual editing through "
              ),
              b("Light Edit"),
              t(" is unlimited and consumes zero credits."),
            ],
            [
              b("Automated Spend and Safety Controls: "),
              t(
                "To protect users from unintended credit depletion and maintain platform stability, Collate enforces automated rate limits and spend-cap circuit breakers, which may temporarily pause new generation jobs during abnormal volume or upstream service disruption."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "3.3 Payment Processors and Merchant of Record",
        },
        {
          type: "list",
          items: [
            [
              b("USD and International Payments (Polar.sh): "),
              t("All USD and international credit pack purchases are processed by "),
              b("Polar Software, Inc. (Polar.sh)"),
              t(" acting as our "),
              b("Merchant of Record"),
              t(
                ". Polar.sh handles hosted checkout processing, invoicing, receipt generation, applicable VAT, GST, or sales tax calculation and collection, and billing compliance on our behalf. By completing a USD or international purchase, you also agree to Polar.sh's applicable buyer terms."
              ),
            ],
            [
              b("Nigerian Naira (NGN) Payments (Paystack): "),
              t("All NGN credit pack purchases are processed by "),
              b("Paystack"),
              t(
                ". Credits are added automatically to your Collate balance upon verified webhook payment confirmation from Paystack."
              ),
            ],
            [
              b("Payment Security: "),
              t(
                "Collate does not collect, process, or store your full payment card numbers, CVVs, or banking credentials on Collate servers. All payment transactions are handled directly by Polar.sh or Paystack under their respective security and PCI-DSS standards."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "acceptable-use-summary",
      number: "4",
      title: "Acceptable Use and Academic Integrity",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t("Your use of Collate is subject to our full "),
            a("Acceptable Use Policy", "/acceptable-use"),
            t(
              ", which is incorporated into these Terms by reference. In particular, you agree to use Collate solely for lawful academic and research assistance purposes, and you must "
            ),
            b("not"),
            t(" use the Platform to:"),
          ],
        },
        {
          type: "list",
          items: [
            [
              t(
                "Operate or supply a commercial essay mill, contract-cheating service, or ghostwriting resale business, or complete live proctored exams or prohibited closed-book assessments."
              ),
            ],
            [
              t(
                "Fabricate, falsify, or invent empirical survey responses, clinical or laboratory measurements, statistical outcomes, or primary fieldwork data."
              ),
            ],
            [
              t(
                "Circumvent publisher paywalls, scrape restricted academic repositories, strip required open-license attributions, or infringe third-party copyrights."
              ),
            ],
            [
              t(
                "Generate or upload content that promotes violence, illegal acts, harassment, hate speech, CSAM, self-harm, weapons, cyberattacks, malware, financial fraud, or unauthorized regulated personal data."
              ),
            ],
            [
              t(
                "Exploit free-tier allowances through duplicate accounts, automate bulk requests without authorization, bypass rate limits or circuit breakers, probe for security vulnerabilities, or reverse engineer Collate's software or architecture."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "refund-policy",
      number: "5",
      title: "Refund Policy",
      blocks: [
        {
          type: "callout",
          tone: "info",
          title: "Summary of Cash and Credit Refund Eligibility",
          runs: [
            t(
              "Collate refunds payments fairly whenever the platform cannot support your topic or experiences a verified Collate technical error: (1) Full cash refund if we are unable to work on your topic; (2) Full cash refund for verified Collate technical errors if no chapters have been made; (3) Partial cash refund for verified Collate technical errors if one or more chapters have already been made (proportional to remaining unused credits or undelivered chapters); (4) Full cash refund for an accidental or duplicate purchase if no credits have been used since the accidental charge; and (5) Automatic 100% credit restoration to your balance if any individual chapter run fails due to a system or upstream error."
            ),
          ],
        },
        {
          type: "subheading",
          title: "5.1 Automatic Credit Refunds (Failed Runs)",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "Credits reserved for any chapter draft, assignment run, or chapter revision that fails to complete due to a Collate system error, processing timeout, or upstream provider failure are "
            ),
            b("automatically refunded in full to your Collate credit balance"),
            t(
              ". You do not need to open a support ticket for failed-run credit restorations; every refund entry appears directly in your Credits & Billing history."
            ),
          ],
        },
        {
          type: "subheading",
          title: "5.2 Inability to Work on Your Topic (Full Cash Refund)",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "If you purchase a credit pack and Collate is unable to work on or support your research topic (for example, where our feasibility screening determines that insufficient verifiable academic sources exist to draft the topic responsibly, or the Platform cannot produce a viable feasibility path for your topic), you qualify for a "
            ),
            b("full cash refund"),
            t(" of your unused credit pack purchase."),
          ],
        },
        {
          type: "subheading",
          title: "5.3 Verified Collate Technical Errors (Full or Partial Cash Refund)",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "If a verified technical error, software defect, or prolonged service outage originating from Collate prevents you from generating or completing your work:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Full Cash Refund (No Chapters Made): "),
              t("If a verified technical error from Collate prevents chapter generation and "),
              b("no chapters have been made or delivered"),
              t(" for your project, you qualify for a "),
              b("full cash refund"),
              t(" of the relevant credit pack purchase."),
            ],
            [
              b("Partial Cash Refund (Chapters Already Made): "),
              t("If a verified technical error from Collate interrupts service "),
              b("after one or more chapters have already been made and delivered"),
              t(" for your project, you qualify for a "),
              b("partial cash refund"),
              t(
                " calculated proportionally to your remaining unused credits or undelivered chapters from that purchase."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "5.4 Accidental or Duplicate Purchases (Full Cash Refund)",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "If you purchase a credit pack by mistake, or are charged more than once for the same purchase, you qualify for a "
            ),
            b("full cash refund"),
            t(" of the accidental charge, provided "),
            b("no credits have been used since the accidental charge"),
            t(
              ". Once credits are spent on chapter drafts, targeted revisions, or paid topic feasibility checks after the accidental charge, the purchase is treated as used and is not eligible for a cash refund under this section."
            ),
          ],
        },
        {
          type: "subheading",
          title: "5.5 Non-Refundable Circumstances",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "Because prepaid credit packs fund immediate research index lookups and server-side processing, cash refunds are "
            ),
            b("not"),
            t(" issued in the following circumstances:"),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Successfully Completed Chapters: "),
              t(
                "Chapters or manuscripts that were generated and delivered as described without a verified Collate technical error."
              ),
            ],
            [
              b("Consumed Credits: "),
              t(
                "Credits already spent on successfully completed chapter drafts, targeted revisions, or paid topic feasibility checks."
              ),
            ],
            [
              b("Subjective Stylistic Preferences: "),
              t(
                "Dissatisfaction based solely on subjective tone, phrasing, or stylistic preferences where sources and chapter structure were properly generated (unlimited manual editing via Light Edit and targeted section revisions are available)."
              ),
            ],
            [
              b("Change of Mind After Usage: "),
              t(
                "Buyer's remorse or changes to personal research plans after chapters have been generated or credits consumed."
              ),
            ],
            [
              b("Academic or Third-Party Outcomes: "),
              t(
                "University grades, supervisor comments, committee decisions, journal peer-review outcomes, or third-party plagiarism or automated AI-detector scores."
              ),
            ],
            [
              b("Policy Violations: "),
              t(
                "Accounts suspended or terminated due to violations of these Terms or our Acceptable Use Policy, including duplicate-account abuse or payment fraud."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "5.6 How to Request a Refund and Processing Timelines",
        },
        {
          type: "paragraph",
          runs: [
            t("To request an eligible cash refund under Sections 5.2, 5.3, or 5.4, email "),
            supportMail,
            t(" within "),
            b("14 days"),
            t(" of the credit purchase or qualifying technical error and include:"),
          ],
        },
        {
          type: "list",
          ordered: true,
          items: [
            [t("Your registered Collate account email address.")],
            [t("Your Project ID (if applicable).")],
            [
              t(
                "Your purchase receipt, invoice, or order reference number from Polar.sh or Paystack."
              ),
            ],
            [
              t(
                "A brief description of the topic inability or technical error encountered, along with any helpful timestamps or screenshots."
              ),
            ],
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Review Timeline: "),
              t(
                "Our support and engineering team verifies every request against server, workflow, and billing logs and responds within "
              ),
              b("3 to 5 business days"),
              t("."),
            ],
            [
              b("Payout Timeline: "),
              t("Approved refunds are issued back to your "),
              b("original payment method"),
              t(" via "),
              b("Polar.sh"),
              t(" (for USD and international orders) or "),
              b("Paystack"),
              t(
                " (for NGN orders). Depending on your card issuer or bank, settled funds typically arrive within "
              ),
              b("5 to 10 business days"),
              t(
                " after approval. When a full or partial cash refund is issued, the corresponding refunded credits are deducted from your Collate credit balance."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "5.7 Chargebacks and Payment Disputes",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "If you notice an unrecognized charge, duplicate transaction, or service problem, please email "
            ),
            supportMail,
            t(
              " first so we can investigate and process any eligible refund quickly. Filing a chargeback or bank reversal without contacting us may result in temporary suspension of your account while we submit transaction, credit-ledger, and chapter delivery logs to Polar.sh or Paystack to resolve the dispute."
            ),
          ],
        },
      ],
    },
    {
      id: "intellectual-property",
      number: "6",
      title: "Intellectual Property and User Content Ownership",
      blocks: [
        {
          type: "subheading",
          title: "6.1 Your Ownership of Your Content",
        },
        {
          type: "paragraph",
          runs: [
            t("As between you and Collate, "),
            b("you retain full ownership"),
            t(
              ' of all research topics, chapter outlines, uploaded primary datasets (CSV/Markdown), research notes, manual edits, and generated manuscript drafts and exports created in your projects ("User Content"), subject only to:'
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("Open-License Media Attributions: "),
              t(
                "Any figures or illustrations sourced from third-party open repositories (such as Creative Commons-licensed media), which remain subject to their respective open licenses and attribution requirements."
              ),
            ],
            [
              b("Underlying Source Copyrights: "),
              t(
                "Copyrights belonging to original authors and publishers of referenced academic works; Collate provides verified bibliographic metadata and grounded academic synthesis rather than transferring third-party copyrights."
              ),
            ],
          ],
        },
        {
          type: "subheading",
          title: "6.2 Limited License Granted to Collate",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "You grant Collate a limited, non-exclusive, revocable, worldwide license to host, store, process, check for internal similarity (using irreversible one-way shingle hashes), format, and export your User Content "
            ),
            b("solely as necessary to operate and deliver the Service to you"),
            t(". We do "),
            b("not"),
            t(
              " sell your User Content, publish your private drafts, or use your topics, uploaded datasets, or manuscripts to train third-party AI foundation models."
            ),
          ],
        },
        {
          type: "subheading",
          title: "6.3 Collate Intellectual Property",
        },
        {
          type: "paragraph",
          runs: [
            t(
              "Collate and its licensors retain all rights, title, and interest in and to the Platform, including all software code, user interface designs, workflows, verification engines, formatting templates, trademarks, logos, and documentation. Except for the limited right to use the Service in accordance with these Terms, no rights are granted to you in Collate's intellectual property."
            ),
          ],
        },
      ],
    },
    {
      id: "disclaimers",
      number: "7",
      title: "Honest Disclaimers and Academic Integrity Limits",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, COLLATE IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.'
            ),
          ],
        },
        {
          type: "list",
          items: [
            [
              b("No Detector or Score Guarantees: "),
              t(
                "While Collate provides an internal similarity report, verified citation records, a writing-process log, and an editable AI-use disclosure statement, Collate "
              ),
              b("cannot and does not guarantee"),
              t(
                " any specific score or outcome on external university plagiarism tools (such as Turnitin or iThenticate) or third-party automated AI-writing detectors."
              ),
            ],
            [
              b("No Academic or Publication Guarantees: "),
              t(
                "Collate does not guarantee academic grades, degree conferral, supervisor approval, grant awards, or peer-reviewed publication acceptance."
              ),
            ],
            [
              b("No Fabricated Empirical Data: "),
              t("In accordance with Collate's strict research integrity rules, Collate "),
              b("never fabricates empirical survey, experimental, or laboratory data"),
              t(
                ". Where a chapter requires original empirical data, you must supply genuine datasets or conduct your own data collection."
              ),
            ],
            [
              b("Service Availability: "),
              t(
                "Collate does not guarantee uninterrupted, error-free operation or continuous availability of third-party research APIs or cloud infrastructure providers."
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "third-party-services",
      number: "8",
      title: "Third-Party Services and External Research Indexes",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "Collate integrates with external research metadata registries, open-access repositories, open-license media repositories, payment providers (Polar.sh and Paystack), and cloud and AI infrastructure providers. Collate does not control and is not responsible for the uptime, accuracy, completeness, or policies of external research registries or third-party websites. You should verify critical bibliographic details against the primary publication prior to final academic submission. Some academic metadata is provided by Semantic Scholar."
            ),
          ],
        },
      ],
    },
    {
      id: "privacy-deletion",
      number: "9",
      title: "Privacy, Data Protection, and Account Deletion",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t("Your privacy and research confidentiality are governed by our "),
            a("Privacy Policy", "/privacy"),
            t(" and "),
            a("Cookie Policy", "/cookies"),
            t(
              ", which describe how we collect, process, safeguard, and erase personal data in compliance with applicable data protection laws, including the "
            ),
            b("Nigeria Data Protection Act 2023 (NDPA 2023)"),
            t(", the "),
            b("EU/UK GDPR"),
            t(
              ", and US state privacy laws. You may permanently delete your account, along with all projects, uploaded datasets, chapter versions, and stored exports, at any time directly from your "
            ),
            a("Account settings page", "/account"),
            t("."),
          ],
        },
      ],
    },
    {
      id: "liability",
      number: "10",
      title: "Limitation of Liability",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL COLLATE, ITS OPERATORS, OFFICERS, EMPLOYEES, CONTRACTORS, OR AFFILIATES BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, LOSS OF ACADEMIC STANDING, LOST PROFITS, OR LOST PUBLICATION OPPORTUNITIES ARISING OUT OF OR RELATING TO YOUR USE OF OR INABILITY TO USE COLLATE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES."
            ),
          ],
        },
        {
          type: "paragraph",
          runs: [
            t(
              "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE GREATER OF: (A) THE TOTAL AMOUNT ACTUALLY PAID BY YOU TO COLLATE IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) FIFTY U.S. DOLLARS ($50 USD) (OR ITS EQUIVALENT IN NGN). SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS OF LIABILITY, SO PORTIONS OF THIS SECTION MAY NOT APPLY TO YOU TO THE EXTENT PROHIBITED BY MANDATORY CONSUMER LAW."
            ),
          ],
        },
      ],
    },
    {
      id: "indemnification",
      number: "11",
      title: "Indemnification",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "You agree to defend, indemnify, and hold harmless Collate, its operators, affiliates, officers, employees, and service partners from and against any third-party claims, damages, liabilities, losses, and reasonable legal costs arising out of or relating to: (a) your User Content or uploaded datasets; (b) your breach of these Terms or the Acceptable Use Policy; (c) your violation of any applicable law, third-party intellectual property right, or privacy right; or (d) any academic misconduct or institutional policy dispute arising from your submission or use of exported manuscripts."
            ),
          ],
        },
      ],
    },
    {
      id: "modifications-termination",
      number: "12",
      title: "Service Modifications, Suspension, and Termination",
      blocks: [
        {
          type: "paragraph",
          runs: [
            b("Service Updates: "),
            t(
              "We may enhance, modify, or discontinue specific features, citation styles, export templates, or third-party index integrations from time to time. We will make reasonable efforts to provide advance notice of material changes that adversely affect core workflows."
            ),
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Termination: "),
            t(
              "You may stop using Collate and delete your account at any time. We may suspend or terminate your access immediately if you materially breach these Terms or our Acceptable Use Policy, engage in payment fraud or chargeback abuse, or if required by law. Sections that by their nature should survive termination (including Sections 5.5 through 5.7, 6, 7, 10, 11, 13, and 14) shall survive any termination."
            ),
          ],
        },
      ],
    },
    {
      id: "governing-law",
      number: "13",
      title: "Governing Law and Dispute Resolution",
      blocks: [
        {
          type: "paragraph",
          runs: [
            b("Governing Law: "),
            t(
              "These Terms and any dispute arising out of or relating to the Service shall be governed by and construed in accordance with the laws of "
            ),
            b(LEGAL_CONFIG.governingLaw),
            t(
              ", without regard to conflict-of-law principles, except to the extent mandatory consumer protection laws in your country of residence apply."
            ),
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Informal Resolution First: "),
            t("Before initiating formal legal proceedings, you agree to contact us first at "),
            supportMail,
            t(" and allow "),
            b("30 days"),
            t(" for both parties to attempt to resolve the matter informally in good faith."),
          ],
        },
        {
          type: "paragraph",
          runs: [
            b("Jurisdiction and Venue: "),
            t(
              "Subject to applicable mandatory consumer rights, any unresolved dispute shall be brought exclusively before the competent courts located in "
            ),
            b(LEGAL_CONFIG.venueLocation),
            t(", and both parties consent to personal jurisdiction and venue in those courts."),
          ],
        },
      ],
    },
    {
      id: "general-provisions",
      number: "14",
      title: "General Provisions",
      blocks: [
        {
          type: "list",
          items: [
            [
              b("Severability: "),
              t(
                "If any provision of these Terms is held invalid, illegal, or unenforceable, the remaining provisions shall remain in full force and effect."
              ),
            ],
            [
              b("Entire Agreement: "),
              t("These Terms, together with our "),
              a("Privacy Policy", "/privacy"),
              t(", "),
              a("Acceptable Use Policy", "/acceptable-use"),
              t(", "),
              a("Cookie Policy", "/cookies"),
              t(
                ", and any purchase receipt issued through Polar.sh or Paystack, constitute the entire agreement between you and Collate regarding the Service."
              ),
            ],
            [
              b("No Waiver: "),
              t(
                "Our failure to enforce any right or provision of these Terms does not constitute a waiver of that right or provision."
              ),
            ],
            [
              b("Assignment: "),
              t(
                "You may not assign or transfer these Terms or your account without our prior written consent. We may assign our rights and obligations in connection with a merger, acquisition, corporate reorganization, or sale of assets."
              ),
            ],
            [
              b("Force Majeure: "),
              t(
                "Collate shall not be liable for delays or failures resulting from events beyond our reasonable control, including internet backbone failures, cloud or AI provider outages, cyberattacks, natural disasters, government actions, or power disruptions."
              ),
            ],
            [
              b("Changes to These Terms: "),
              t(
                'We may update these Terms from time to time. For material changes, we will update the "Last Updated" date at the top of this page and notify registered users by email or an in-app notice prior to the effective date. Continued use of the Service after updated Terms take effect constitutes acceptance of the revised Terms.'
              ),
            ],
          ],
        },
      ],
    },
    {
      id: "contact",
      number: "15",
      title: "Contact Information",
      blocks: [
        {
          type: "paragraph",
          runs: [
            t(
              "For questions about these Terms, cash refund requests, or account support, contact us:"
            ),
          ],
        },
        {
          type: "list",
          items: [
            [b("Service: "), t(`${LEGAL_CONFIG.serviceName} (${LEGAL_CONFIG.siteUrl})`)],
            [b("Support, Refunds, and Legal Inquiries: "), supportMail],
            [b("USD and International Merchant of Record: "), t("Polar Software, Inc. (Polar.sh)")],
            [b("NGN Payment Processor: "), t("Paystack")],
          ],
        },
      ],
    },
  ],
};
