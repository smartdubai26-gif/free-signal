-- ============================================================
-- AlphaFX — Row Level Security (RLS) hardening
-- ============================================================
-- Run this in Supabase → SQL Editor.
--
-- WHY: the anon key ships to every browser. Without RLS, anyone holding it
-- can read and write every row in these tables. RLS is the only thing that
-- makes a public anon key safe.
-- ============================================================

-- 1) Enable RLS on every table exposed through the anon key
ALTER TABLE public.signals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summary      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_test_log ENABLE ROW LEVEL SECURITY;

-- 2) Force RLS even for the table owner (defence in depth)
ALTER TABLE public.signals            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summary      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_test_log FORCE ROW LEVEL SECURITY;

-- 3) Drop any permissive policies left over from earlier experiments
DROP POLICY IF EXISTS "public_all_signals"        ON public.signals;
DROP POLICY IF EXISTS "public_all_daily_summary"  ON public.daily_summary;
DROP POLICY IF EXISTS "public_all_production"     ON public.production_test_log;

-- 4) signals — read-only for anonymous visitors.
--    Writes happen only through the service role (GitHub Actions / server).
CREATE POLICY "signals_public_read"
  ON public.signals
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No INSERT / UPDATE / DELETE policy for anon or authenticated:
-- those operations are therefore denied by default.

-- 5) daily_summary — read-only for anonymous visitors.
CREATE POLICY "daily_summary_public_read"
  ON public.daily_summary
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 6) production_test_log — internal diagnostics, NOT public.
--    Only the service role may touch it.
--    (No policy for anon/authenticated = no access at all.)

-- 7) Verify the result
--    Every row below must show rowsecurity = true.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('signals', 'daily_summary', 'production_test_log');

-- 8) List the active policies (sanity check)
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
