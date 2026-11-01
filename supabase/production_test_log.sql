-- ============================================================
-- AlphaFX — production_test_log table
-- ============================================================
-- The client used to embed this DDL inside the JS bundle. It now lives here,
-- where it belongs, and is applied once by an operator.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.production_test_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id    TEXT NOT NULL,
  label       TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'pending')),
  notes       TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_test_log_checked_at
  ON public.production_test_log (checked_at DESC);

-- RLS is enabled in supabase/rls_policies.sql — run that file too.
