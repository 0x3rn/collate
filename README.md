# Collate

Evidence-bound research and long-form academic drafting built on **Cloudflare Workers** (`vinext`, D1, R2, Workflows, Workers AI, Vectorize, AI Gateway, and Browser Run).

Collate verifies whether enough credible scholarly and web sources exist before writing (**Rule NN-1**), formats references deterministically from verified metadata (**Rule NN-2**), traces every factual claim to a stored passage (**Rule NN-3**), refuses to fabricate empirical results data (**Rule NN-4**), runs layered originality gates (**Rule NN-6**), drafts durably one chapter at a time (**Rules NN-7 & NN-8**), and exports server-rendered PDF and Word (`.docx`) documents (**Rule NN-9**).

## Local Development

```bash
pnpm install
pnpm run db:migrate:local
pnpm run db:seed:local
pnpm run dev
```

## Verification Gate

Run all static, formatting, unit, integration, evaluation, and production bundle checks:

```bash
pnpm run verify
```

## Database Migrations

- Local D1: `pnpm run db:migrate:local`
- Remote Cloudflare D1: `pnpm run db:migrate:prod`

## Required Production Secrets (`wrangler secret put <NAME>`)

Configure secrets in Cloudflare Workers (never commit `.dev.vars`):

- **AI & Search:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_AI_GATEWAY_TOKEN`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `SCHOLARLY_CONTACT_EMAIL` (plus optional `SEMANTIC_SCHOLAR_API_KEY`, `CORE_API_KEY`)
- **Security & Auth:** `APP_URL`, `EXPORT_SIGNING_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `INTERNAL_SMOKE_TOKEN`, `ADMIN_EMAILS`
- **Email:** `EMAIL_PROVIDER`, `EMAIL_FROM`, `RESEND_API_KEY`
- **Payments:** `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Observability:** `SENTRY_DSN`

## Backup, Restore Drill & Rollback

1. **Automated Backups:** `.github/workflows/backup-d1.yml` exports `DB` daily via `wrangler d1 export DB --remote` (requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in GitHub Secrets).
2. **Restore Drill (test on a fresh local or scratch D1 database first):**
   ```bash
   pnpm exec wrangler d1 execute DB --local --file=backups/collate-d1-<run-id>.sql
   ```
3. **Worker Rollback:** Instant zero-downtime rollback via Cloudflare Dashboard → Workers & Pages → `collate` → Deployments → **Rollback**, or `pnpm exec wrangler rollback`.

## Pre-Launch Checklist

- [ ] Set all production `wrangler secret` values and configure Cloudflare AI Gateway & Turnstile keys.
- [ ] Apply remote D1 migrations (`pnpm run db:migrate:prod`) and verify a live 60-page project end to end.
- [ ] Complete lawyer review of `/terms` and `/privacy` (NDPA & GDPR) and replace all `[CONFIRM]` placeholders.
- [ ] Run beta test with 10–20 real students and calibrate credit pack pricing from measured `jobs_log` costs.
