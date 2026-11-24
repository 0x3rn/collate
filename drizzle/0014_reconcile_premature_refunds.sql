-- Reconcile any credit reservations prematurely refunded during a Cloudflare Durable Object
-- code-update reset where the exact workflow run subsequently resumed and completed
-- (evidenced by a succeeded memory_summary_ch* step in jobs_log for the exact runId).
-- Strictly idempotent via credit_ledger.idempotency_key = 'recapture:' || reservation.id.

WITH completed_refunded AS (
  SELECT
    cr.id,
    cr.user_id,
    cr.project_id,
    cr.chapter_id,
    cr.credits_reserved,
    u.credits_balance AS starting_balance,
    SUM(cr.credits_reserved) OVER (
      PARTITION BY cr.user_id
      ORDER BY cr.created_at ASC, cr.id ASC
    ) AS cumulative_debit
  FROM credit_reservations cr
  INNER JOIN users u ON u.id = cr.user_id
  WHERE cr.status = 'refunded'
    AND instr(cr.idempotency_key, ':') > 0
    AND EXISTS (
      SELECT 1
      FROM jobs_log jl
      WHERE jl.workflow_id = substr(cr.idempotency_key, instr(cr.idempotency_key, ':') + 1)
        AND jl.status = 'succeeded'
        AND jl.step LIKE 'memory_summary_ch%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM credit_ledger cl
      WHERE cl.idempotency_key = 'recapture:' || cr.id
    )
)
INSERT INTO credit_ledger (
  id,
  user_id,
  project_id,
  chapter_id,
  payment_id,
  idempotency_key,
  entry_type,
  credits_delta,
  balance_after,
  note,
  created_at
)
SELECT
  'led_recap_' || id,
  user_id,
  project_id,
  chapter_id,
  NULL,
  'recapture:' || id,
  'capture',
  -MIN(credits_reserved, MAX(0, starting_balance - (cumulative_debit - credits_reserved))),
  MAX(0, starting_balance - cumulative_debit),
  'Captured credits for completed chapter after premature workflow-reset refund',
  CAST(unixepoch('now') * 1000 AS INTEGER)
FROM completed_refunded;
--> statement-breakpoint
UPDATE users
SET
  credits_balance = MAX(
    0,
    credits_balance - COALESCE(
      (
        SELECT SUM(cr.credits_reserved)
        FROM credit_reservations cr
        WHERE cr.user_id = users.id
          AND cr.status = 'refunded'
          AND EXISTS (
            SELECT 1
            FROM credit_ledger cl
            WHERE cl.idempotency_key = 'recapture:' || cr.id
          )
      ),
      0
    )
  ),
  updated_at = CAST(unixepoch('now') * 1000 AS INTEGER)
WHERE EXISTS (
  SELECT 1
  FROM credit_reservations cr
  WHERE cr.user_id = users.id
    AND cr.status = 'refunded'
    AND EXISTS (
      SELECT 1
      FROM credit_ledger cl
      WHERE cl.idempotency_key = 'recapture:' || cr.id
    )
);
--> statement-breakpoint
UPDATE credit_reservations
SET
  status = 'captured',
  settled_at = CAST(unixepoch('now') * 1000 AS INTEGER)
WHERE status = 'refunded'
  AND EXISTS (
    SELECT 1
    FROM credit_ledger cl
    WHERE cl.idempotency_key = 'recapture:' || credit_reservations.id
  );
