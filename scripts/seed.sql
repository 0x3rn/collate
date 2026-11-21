-- Idempotent local development seed for Collate (safe to run multiple times).
-- Note: Do not wrap in BEGIN TRANSACTION; Cloudflare D1 manages statement atomicity.

INSERT OR IGNORE INTO users (
  id, email, email_verified, name, image, credits_balance, created_at, updated_at
) VALUES (
  'usr_seed_dev_001',
  'dev@collate.local',
  1,
  'Collate Dev Researcher',
  NULL,
  100,
  1763726400000,
  1763726400000
);

INSERT OR IGNORE INTO projects (
  id, user_id, type, title, level, field, institution, status, target_pages, ideal_pages, created_at, updated_at
) VALUES (
  'prj_seed_dev_001',
  'usr_seed_dev_001',
  'thesis',
  'Solar Microgrid Reliability in Sub-Saharan Peri-Urban Communities',
  'Masters',
  'Renewable Energy Systems',
  'Sample University',
  'draft',
  80,
  NULL,
  1763726400000,
  1763726400000
);

INSERT OR IGNORE INTO jobs_log (
  id, workflow_id, project_id, step, provider, model, status, tokens_in, tokens_out, cost_estimate_usd, latency_ms, error, created_at
) VALUES (
  'job_seed_dev_001',
  'wf_seed_bootstrap',
  'prj_seed_dev_001',
  'seed_smoke_check',
  'anthropic',
  'configured-at-runtime',
  'succeeded',
  0,
  0,
  0,
  1,
  NULL,
  1763726400000
);
