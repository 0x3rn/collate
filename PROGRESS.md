# Collate — Build Progress

Track progress strictly one phase at a time. Do not begin the next phase until the previous phase's **Done when** checks pass.

## Phase 0 — Foundations and Cloudflare infrastructure
- [x] Step 0.1: Create repo (TypeScript, pnpm, ESLint, Prettier, Vitest, `PROGRESS.md`)
- [x] Step 0.1: Scaffold Next.js for Cloudflare Workers (`vinext` + `wrangler.jsonc`) with error boundaries and `/api/health`
- [ ] Step 0.2: Create environments (`dev`, `staging`, `prod`) with D1, R2, Queues, Vectorize, Workflows
- [x] Step 0.2: Drizzle + D1 migrations + seed script (verified locally with Wrangler D1 + Vitest)
- [x] Step 0.3: AI Gateway configured + `callLLM()` helper logging tokens and cost to `jobs_log` (verified with Vitest + D1 integration tests)
- [ ] Step 0.4: Domain on Cloudflare DNS + secrets via `wrangler secret`
- [x] Step 0.4: Observability (Workers Logs, Sentry, error boundary) + GitHub Actions CI (verified locally)
- [x] Step 0.4: Hello-world Workflow (1-min sleep & resume) + hello-world Browser Run `/pdf` → R2 (code & unit tests verified; awaiting live staging deploy)

### Phase 0 — Done when
- [ ] Staging URL serves a page from Workers.
- [ ] A test Workflow runs, sleeps for 1 minute, and resumes.
- [ ] A test HTML renders to PDF via Browser Run and lands in R2.
- [ ] Cost per LLM call is being logged.

---

## Upcoming Phases
- [ ] Phase 1 — Accounts and dashboard shell
- [ ] Phase 2 — Setup wizard (UI + persistence, no AI yet)
- [ ] Phase 3 — Research engine
- [ ] Phase 4 — Feasibility gate and page recommendation
- [ ] Phase 5 — Outline and chapter planning
- [ ] Phase 6 — Citation engine
- [ ] Phase 7 — Chapter writing pipeline
- [ ] Phase 8 — Originality and integrity
- [ ] Phase 9 — PDF and DOCX export
- [ ] Phase 10 — Dashboard project view and notifications
- [ ] Phase 11 — Payments, credits and cost control
- [ ] Phase 12 — Hardening, QA, launch
