-- ============================================================================
-- AlphaFX (free-signal) — تنظيف الإشارات القديمة/الفاسدة في Supabase
-- ============================================================================
-- الملف: supabase/cleanup-old-signals.sql
-- الإصدار: v8
--
-- ⚠️ اقرأ هذا القسم قبل أي شيء.
--
-- ── إزاي تشغّله ─────────────────────────────────────────────────────────────
--
--   الطريقة 1 — Supabase SQL Editor (الأسهل، ومُستحسن):
--     1. افتح مشروعك على supabase.com → SQL Editor → New query
--     2. الصق محتوى هذا الملف كاملًا
--     3. شغّله مرة واحدة. المراحل منفصلة بأقسام واضحة، وكل مرحلة آمنة التكرار.
--     4. ابدأ بالمرحلة 1 (تشخيص) واقرأ الأرقام قبل ما تنفّذ أي حذف.
--
--   الطريقة 2 — psql:
--     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/cleanup-old-signals.sql
--     (SUPABASE_DB_URL = Connection string من Settings → Database → Connection pooling)
--
-- ── الصلاحيات ───────────────────────────────────────────────────────────────
--   الجدول signals عليه RLS مع FORCE ROW LEVEL SECURITY (شوف rls_policies.sql).
--   الـ anon key لا يملك DELETE إطلاقًا. نفّذ هذا السكربت بـ:
--     • Supabase SQL Editor (يعمل بدور postgres = superuser)، أو
--     • service_role key / اتصال مباشر بقاعدة البيانات.
--   لا تحاول تشغيله من المتصفح — سيفشل بصمت أو يرجّع 0 صفوف.
--
-- ── الأمان ──────────────────────────────────────────────────────────────────
--   • المرحلة 1 قراءة فقط (SELECT) — لا تعدّل شيئًا.
--   • المرحلة 2 تنسخ الصفوف المرشّحة لجدول نسخة احتياطية قبل أي حذف.
--   • المرحلة 3 الحذف داخل BEGIN … COMMIT، وفيها خيار ROLLBACK جاهز.
--   • كل مرحلة idempotent: تشغيلها مرتين لا يضر.
--   • لا يوجد DROP TABLE لأي جدول إنتاجي.
--
-- ── الـ schema المرجعي (مأخوذ من schema.sql في نفس المشروع) ─────────────────
--   signals(
--     id uuid PK, symbol text, timeframe text, direction text,
--     confidence int, entry/stop_loss/tp1/tp2/tp3/risk_reward numeric,
--     reasons jsonb, status text DEFAULT 'pending', created_at timestamptz,
--     activated_at timestamptz, closed_at timestamptz, closed_price numeric,
--     pips_gained numeric, outcome text
--   )
--   القيم الفعلية لـ status في الكود: pending | active | won | lost | not_triggered
--   القيم الفعلية لـ outcome: win | loss | not_triggered | cancelled
-- ============================================================================


-- ============================================================================
-- المرحلة 0 — الإعدادات (عدّل من هنا فقط)
-- ============================================================================
-- جدول إعدادات من صف واحد. كل المراحل بتقرأ منه، فتغيير رقم واحد يكفي.
-- لو الجدول موجود بالفعل، الـ INSERT لا يلمس قيمك (ON CONFLICT DO NOTHING).

CREATE TABLE IF NOT EXISTS public.alpha_cleanup_config (
  id                      int PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- مدة الاحتفاظ بالإشارات المغلقة/المنتهية. الافتراضي 30 يومًا.
  retention_days          int  NOT NULL DEFAULT 30,

  -- تاريخ تغيير قاعدة الإجازة (من "جمعة+سبت" إلى "السبت فقط").
  -- يُستخدم كحدّ فاصل: الإشارات الأقدم من هذا التاريخ فقط هي التي تُعتبر
  -- "تفعيلًا وهميًا" في نوافذ الإجازة القديمة.
  rule_change_date        date NOT NULL DEFAULT DATE '2026-11-01',

  -- مفاتيح تشغيل/إيقاف لكل فئة. الافتراضي: كل شيء عدا الإجازة القديمة.
  include_future          boolean NOT NULL DEFAULT true,
  include_saturday        boolean NOT NULL DEFAULT true,
  include_legacy_holiday  boolean NOT NULL DEFAULT false,  -- ⚠️ اقرأ التحذير أدناه
  include_duplicates      boolean NOT NULL DEFAULT true,
  include_retention       boolean NOT NULL DEFAULT true,
  include_phantom_active  boolean NOT NULL DEFAULT true,

  updated_at              timestamptz DEFAULT now()
);

INSERT INTO public.alpha_cleanup_config (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- اطبع الإعدادات الحالية
SELECT
  retention_days          AS "مدة الاحتفاظ (يوم)",
  rule_change_date        AS "تاريخ تغيير قاعدة الإجازة",
  include_future          AS "مستقبلية",
  include_saturday        AS "تفعيل يوم سبت",
  include_legacy_holiday  AS "إجازة قديمة (جمعة/أحد)",
  include_duplicates      AS "مكرّرة",
  include_retention       AS "أقدم من مدة الاحتفاظ",
  include_phantom_active  AS "معلّقة وهمية"
FROM public.alpha_cleanup_config WHERE id = 1;


-- ============================================================================
-- المرحلة 0.5 — دالة الترشيح (مصدر الحقيقة الوحيد)
-- ============================================================================
-- كل المراحل (تشخيص / نسخ احتياطي / حذف) بتستدعي نفس الدالة، فمستحيل
-- يحصل اختلاف بين "اللي شفته في التشخيص" و"اللي اتحذف فعلًا".
--
-- ترجّع صفًا لكل (إشارة، سبب). الإشارة الواحدة قد تظهر بأكثر من سبب؛
-- الحذف بيستخدم DISTINCT على الـ id.

CREATE OR REPLACE FUNCTION public.alpha_cleanup_candidates()
RETURNS TABLE (
  id           uuid,
  reason       text,
  symbol       text,
  timeframe    text,
  status       text,
  created_at   timestamptz,
  activated_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
WITH cfg AS (
  SELECT * FROM public.alpha_cleanup_config WHERE id = 1
),

-- ── 1) طوابع في المستقبل ────────────────────────────────────────────────────
-- أي إشارة تاريخ إنشائها أو تفعيلها أو إغلاقها بعد "الآن" بهامش دقيقة واحدة.
-- الهامش يمنع مطاردة فروق ساعة الخادم.
future AS (
  SELECT s.id, 'future_timestamp'::text AS reason
  FROM public.signals s, cfg c
  WHERE c.include_future
    AND (
      s.created_at   > now() + interval '1 minute'
      OR s.activated_at > now() + interval '1 minute'
      OR s.closed_at    > now() + interval '1 minute'
    )
),

-- ── 2) تفعيل يوم سبت (القاعدة الجديدة: السبت فقط هو الإجازة) ────────────────
-- السبت على تقويم القاهرة، مطابقًا لـ CLOSED_WEEKDAY_CAIRO = 6 في marketClock.ts.
-- ISODOW: الاثنين=1 … السبت=6، الأحد=7.
saturday AS (
  SELECT s.id, 'saturday_activation'::text AS reason
  FROM public.signals s, cfg c
  WHERE c.include_saturday
    AND s.activated_at IS NOT NULL
    AND EXTRACT(ISODOW FROM (s.activated_at AT TIME ZONE 'Africa/Cairo')) = 6
),

-- ── 3) تفعيل في نافذة الإجازة القديمة (جمعة مساءً / أحد صباحًا) ─────────────
-- ⚠️ تحذير مهم: تحت القاعدة الجديدة (السبت فقط) هذه الأوقات صحيحة تمامًا
--    والسوق مفتوح فيها. الصفوف هنا "وهمية" فقط لأنها أُنشئت تحت القاعدة
--    القديمة التي كانت تعتبر السوق مغلقًا، فمحرّك التسوية كان يقارن أسعارًا
--    ميتة ويعلّم صفقات "مفعّلة" بلا تنفيذ حقيقي.
--    لذلك: مطفية افتراضيًا (include_legacy_holiday = false)، ومقيّدة
--    بـ created_at < rule_change_date حتى لا تلمس أي إشارة شرعية جديدة.
legacy_holiday AS (
  SELECT s.id, 'legacy_holiday_activation'::text AS reason
  FROM public.signals s, cfg c
  WHERE c.include_legacy_holiday
    AND s.activated_at IS NOT NULL
    AND s.created_at < (c.rule_change_date::timestamptz)
    AND (
      -- الجمعة بعد 21:00 UTC
      ( EXTRACT(ISODOW FROM (s.activated_at AT TIME ZONE 'UTC')) = 5
        AND (s.activated_at AT TIME ZONE 'UTC')::time >= TIME '21:00' )
      OR
      -- الأحد قبل 21:00 UTC
      ( EXTRACT(ISODOW FROM (s.activated_at AT TIME ZONE 'UTC')) = 7
        AND (s.activated_at AT TIME ZONE 'UTC')::time <  TIME '21:00' )
    )
),

-- ── 4) مكرّرة: نفس الزوج + نفس الفريم + نفس الشمعة ──────────────────────────
-- الشمعة تُحسب حسب الفريم الفعلي (M15/H1/H4/D1) عبر date_bin.
-- نحتفظ بصف واحد فقط لكل مجموعة: الأعلى ثقة، ثم الأقدم، ثم الأصغر id
-- (ترتيب حتمي حتى لا يختلف الاختيار بين تشغيلين).
bucketed AS (
  SELECT
    s.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        s.symbol,
        s.timeframe,
        date_bin(
          CASE s.timeframe
            WHEN 'M15' THEN interval '15 minutes'
            WHEN 'H1'  THEN interval '1 hour'
            WHEN 'H4'  THEN interval '4 hours'
            WHEN 'D1'  THEN interval '1 day'
            ELSE interval '4 hours'
          END,
          s.created_at,
          timestamptz '2000-01-01 00:00:00+00'
        )
      ORDER BY s.confidence DESC NULLS LAST, s.created_at ASC, s.id ASC
    ) AS rn
  FROM public.signals s, cfg c
  WHERE c.include_duplicates
),
duplicates AS (
  SELECT b.id, 'duplicate'::text AS reason
  FROM bucketed b
  WHERE b.rn > 1
),

-- ── 5) أقدم من مدة الاحتفاظ ─────────────────────────────────────────────────
-- الصفوف المفتوحة (pending/active) لا تُحذف بالمدة وحدها — قد تكون صفقة
-- حيّة. تُترك لمرحلة "المعلّقة الوهمية" أو للمراجعة اليدوية.
retention AS (
  SELECT s.id, 'older_than_retention'::text AS reason
  FROM public.signals s, cfg c
  WHERE c.include_retention
    AND s.created_at < now() - make_interval(days => c.retention_days)
    AND COALESCE(lower(s.status), 'pending') NOT IN ('pending', 'active')
),

-- ── 6) معلّقة/مفعّلة وهميًا ─────────────────────────────────────────────────
-- (أ) status = 'active' لكن activated_at فاضي → لا يوجد وقت تنفيذ حقيقي.
-- (ب) status = 'active' و activated_at في يوم سبت → تنفيذ مستحيل.
-- (ج) status = 'active' و activated_at في المستقبل → لم يحدث بعد.
phantom_active AS (
  SELECT s.id, 'phantom_active'::text AS reason
  FROM public.signals s, cfg c
  WHERE c.include_phantom_active
    AND lower(COALESCE(s.status, '')) = 'active'
    AND (
      s.activated_at IS NULL
      OR s.activated_at > now() + interval '1 minute'
      OR EXTRACT(ISODOW FROM (s.activated_at AT TIME ZONE 'Africa/Cairo')) = 6
    )
),

all_reasons AS (
  SELECT * FROM future
  UNION ALL SELECT * FROM saturday
  UNION ALL SELECT * FROM legacy_holiday
  UNION ALL SELECT * FROM duplicates
  UNION ALL SELECT * FROM retention
  UNION ALL SELECT * FROM phantom_active
)

SELECT
  s.id,
  r.reason,
  s.symbol,
  s.timeframe,
  s.status,
  s.created_at,
  s.activated_at
FROM all_reasons r
JOIN public.signals s ON s.id = r.id;
$$;

COMMENT ON FUNCTION public.alpha_cleanup_candidates() IS
  'يرجّع الإشارات المرشّحة للتنظيف مع سبب لكل صف. يقرأ إعداداته من alpha_cleanup_config.';


-- ============================================================================
-- المرحلة 1 — تشخيص (قراءة فقط، لا تعديل)
-- ============================================================================
-- شغّل هذا القسم أولًا. اقرأ الأرقام. لا تكمل قبل أن تفهم ما ستحذفه.

-- 1.1 إجمالي الجدول
SELECT
  count(*)                                              AS "إجمالي الإشارات",
  count(*) FILTER (WHERE lower(status) = 'active')      AS "مفعّلة الآن",
  count(*) FILTER (WHERE lower(status) = 'pending')     AS "معلّقة",
  count(*) FILTER (WHERE lower(status) IN ('won','lost')) AS "مغلقة",
  min(created_at)                                       AS "أقدم إشارة",
  max(created_at)                                       AS "أحدث إشارة"
FROM public.signals;

-- 1.2 التوزيع حسب السبب — هذا هو الجدول المهم
SELECT
  reason                                  AS "السبب",
  count(*)                                AS "عدد الصفوف",
  count(DISTINCT id)                      AS "إشارات فريدة"
FROM public.alpha_cleanup_candidates()
GROUP BY reason
ORDER BY count(*) DESC;

-- 1.3 الإجمالي الصافي (بعد إزالة التكرار بين الأسباب)
SELECT count(DISTINCT id) AS "إجمالي الإشارات التي ستُحذف"
FROM public.alpha_cleanup_candidates();

-- 1.4 عيّنة من كل سبب (10 صفوف) — راجعها بعينك قبل الحذف
SELECT
  c.reason        AS "السبب",
  c.symbol        AS "الزوج",
  c.timeframe     AS "الفريم",
  c.status        AS "الحالة",
  c.created_at    AS "أُنشئت (UTC)",
  c.activated_at  AS "فُعّلت (UTC)",
  to_char(c.activated_at AT TIME ZONE 'Africa/Cairo',
          'YYYY-MM-DD HH24:MI (Dy)') AS "فُعّلت (القاهرة)"
FROM public.alpha_cleanup_candidates() c
ORDER BY c.reason, c.created_at DESC
LIMIT 10;

-- 1.5 توزيع التفعيل حسب يوم الأسبوع (القاهرة) — يكشف حجم مشكلة السبت
SELECT
  to_char(activated_at AT TIME ZONE 'Africa/Cairo', 'Day') AS "اليوم",
  EXTRACT(ISODOW FROM (activated_at AT TIME ZONE 'Africa/Cairo'))::int AS "ISODOW",
  count(*) AS "عدد التفعيلات"
FROM public.signals
WHERE activated_at IS NOT NULL
GROUP BY 1, 2
ORDER BY 2;


-- ============================================================================
-- المرحلة 2 — نسخة احتياطية قبل أي حذف
-- ============================================================================
-- ننسخ الصفوف المرشّحة فقط (وليس الجدول كله) — أسرع وأصغر.
-- اسم الجدول يحمل التاريخ، فتشغيله في يوم آخر ينشئ نسخة جديدة ولا يكتب فوق القديمة.

-- ⚠️ ملاحظة على تنفيذ سابق: كان الـ JOIN مع (id, reason) يُنتج صفًا لكل سبب،
-- فإشارة واحدة بثلاثة أسباب كانت تُنسخ ثلاث مرات (18 صفًا مقابل 11 إشارة).
-- الحل: DISTINCT ON (s.id) مع تجميع الأسباب في عمود واحد.

DO $$
DECLARE
  -- ⚠️ اسم بدقة الثانية + لاحقة عشوائية. بدقة الدقيقة كان تشغيلان في نفس
  -- الدقيقة يتصادمان على نفس الاسم، و CREATE TABLE IF NOT EXISTS يجدول
  -- موجودًا فيتخطّاه — فتصبح النسخة الاحتياطية فارغة أو قديمة بصمت.
  v_table text := 'signals_backup_' || to_char(now(), 'YYYYMMDD_HH24MISS')
                  || '_' || substr(md5(random()::text), 1, 4);
  v_count bigint;
  v_expected bigint;
BEGIN
  EXECUTE format(
    'CREATE TABLE public.%I AS
       SELECT DISTINCT ON (s.id)
              s.*,
              agg.reasons AS _cleanup_reason,
              now()        AS _backed_up_at
       FROM public.signals s
       JOIN (
         SELECT id, string_agg(DISTINCT reason, '','' ORDER BY reason) AS reasons
         FROM public.alpha_cleanup_candidates()
         GROUP BY id
       ) agg ON agg.id = s.id
       ORDER BY s.id',
    v_table
  );

  EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_count;
  SELECT count(DISTINCT id) INTO v_expected FROM public.alpha_cleanup_candidates();

  RAISE NOTICE '✅ النسخة الاحتياطية: public.%  —  % صف', v_table, v_count;

  -- تحقّق: عدد صفوف النسخة يجب أن يساوي عدد الإشارات الفريدة المرشّحة
  IF v_count <> v_expected THEN
    RAISE EXCEPTION 'فشل التحقّق: النسخة الاحتياطية بها % صف لكن المرشّحين % إشارة. أُلغي كل شيء.',
      v_count, v_expected;
  END IF;

  RAISE NOTICE '   ✅ التحقّق نجح: % صف = % إشارة فريدة', v_count, v_expected;
  RAISE NOTICE '   للاسترجاع لاحقًا: INSERT INTO public.signals SELECT * FROM public.% ON CONFLICT (id) DO NOTHING;', v_table;
END $$;

-- تأكيد وجود النسخ (count حقيقي، لا إحصاءات تقريبية)
DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT relname FROM pg_stat_user_tables
    WHERE relname LIKE 'signals_backup_%' ORDER BY relname DESC
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    RAISE NOTICE '   📦 public.%  →  % صف', r.relname, n;
  END LOOP;
END $$;


-- ============================================================================
-- المرحلة 3 — الحذف (داخل transaction)
-- ============================================================================
-- ⚠️ اقرأ: هذا القسم يحذف فعلًا. المرحلة 2 يجب أن تكون اتعملت قبله.
--
--   للتنفيذ:        COMMIT   (السطر الأخير)
--   للتجربة بأمان:  ROLLBACK (بدّل السطر الأخير)
--
-- كل شيء بين BEGIN و COMMIT ذرّي: لو فشل أي استعلام في المنتصف،
-- لا يُحذف أي صف إطلاقًا.

BEGIN;

-- 3.1 سجّل ما ستحذفه في جدول تدقيق دائم (يبقى بعد الحذف)
CREATE TABLE IF NOT EXISTS public.signals_cleanup_log (
  id            uuid        NOT NULL,
  reason        text        NOT NULL,
  symbol        text,
  timeframe     text,
  status        text,
  created_at    timestamptz,
  activated_at  timestamptz,
  deleted_at    timestamptz NOT NULL DEFAULT now(),
  deleted_by    text        NOT NULL DEFAULT current_user
);

-- ⚠️ سجل التدقيق: صف واحد لكل إشارة محذوفة، والأسباب مجمّعة في عمود واحد.
-- (لو سجّلنا صفًا لكل سبب، الإشارة الواحدة تظهر ٣ مرات في السجل وتضلّل المراجعة.)
INSERT INTO public.signals_cleanup_log
  (id, reason, symbol, timeframe, status, created_at, activated_at)
SELECT
  c.id,
  string_agg(DISTINCT c.reason, ', ' ORDER BY c.reason) AS reason,
  c.symbol, c.timeframe, c.status, c.created_at, c.activated_at
FROM public.alpha_cleanup_candidates() c
GROUP BY c.id, c.symbol, c.timeframe, c.status, c.created_at, c.activated_at;

-- 3.2 الحذف الفعلي — DISTINCT على الـ id لأن الإشارة قد تحمل أكثر من سبب
-- نلتقط العدد المتوقع أولًا ونقارنه بعدد الصفوف المحذوفة فعلًا.
DO $$
DECLARE
  v_expected bigint;
  v_deleted  bigint;
BEGIN
  SELECT count(DISTINCT id) INTO v_expected FROM public.alpha_cleanup_candidates();

  IF v_expected = 0 THEN
    RAISE NOTICE 'ℹ️ لا توجد إشارات مرشّحة — لا شيء يُحذف.';
    RETURN;
  END IF;

  WITH victims AS (
    SELECT DISTINCT id FROM public.alpha_cleanup_candidates()
  )
  DELETE FROM public.signals s USING victims v WHERE s.id = v.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted <> v_expected THEN
    RAISE EXCEPTION 'فشل التحقّق: حُذف % صف لكن المتوقع %. أُلغي كل شيء.',
      v_deleted, v_expected;
  END IF;

  RAISE NOTICE '✅ حُذف % صف (مطابق للمتوقع).', v_deleted;
END $$;

-- 3.3 تحقّق داخل نفس الـ transaction: يجب أن يكون صفرًا
SELECT count(DISTINCT id) AS "متبقٍّ من المرشّحين (يجب أن يكون 0)"
FROM public.alpha_cleanup_candidates();

-- 3.4 العدد المتبقي في الجدول
SELECT count(*) AS "الإشارات المتبقية" FROM public.signals;

COMMIT;
-- ROLLBACK;   -- ← بدّل السطر السابق بهذا للتراجع الكامل


-- ============================================================================
-- المرحلة 4 — الفهارس
-- ============================================================================
-- الفهارس الموجودة من schema.sql:
--   idx_signals_symbol_timeframe_created (symbol, timeframe, created_at)
--   idx_signals_status (status)
--   idx_signals_activated_at (activated_at)
--
-- الناقص: فهرس على created_at وحده (حذف المدة يمسح بالتاريخ)، وفهرس جزئي
-- على الصفوف المفتوحة (أصغر بكثير من الجدول كله وأسرع للاستعلامات الحيّة).

CREATE INDEX IF NOT EXISTS idx_signals_created_at
  ON public.signals (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signals_open_only
  ON public.signals (created_at DESC)
  WHERE lower(status) IN ('pending', 'active');

-- ملاحظة للإنتاج: على جدول كبير، CREATE INDEX العادي يقفل الكتابة أثناء البناء.
-- استخدم CONCURRENTLY بدلًا منه — لكنه لا يعمل داخل transaction، فشغّله منفصلًا:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_signals_created_at
--     ON public.signals (created_at DESC);


-- ============================================================================
-- المرحلة 5 — VACUUM / ANALYZE
-- ============================================================================
-- VACUUM لا يعمل داخل transaction — شغّل هذا القسم منفصلًا بعد COMMIT.
-- VACUUM (بدون FULL) لا يقفل الجدول ويُعيد المساحة للاستخدام الداخلي.
-- لو عايز تُرجع المساحة للقرص فعليًا: VACUUM FULL signals; (يقفل الجدول — تجنّبه في وقت الذروة)

VACUUM (ANALYZE, VERBOSE) public.signals;
ANALYZE public.signals;


-- ============================================================================
-- المرحلة 6 — التحقق النهائي
-- ============================================================================

-- 6.1 لا مرشّحين متبقّين
SELECT count(DISTINCT id) AS "مرشّحون متبقّون (يجب 0)"
FROM public.alpha_cleanup_candidates();

-- 6.2 لا تفعيلات يوم سبت
SELECT count(*) AS "تفعيلات يوم سبت (يجب 0)"
FROM public.signals
WHERE activated_at IS NOT NULL
  AND EXTRACT(ISODOW FROM (activated_at AT TIME ZONE 'Africa/Cairo')) = 6;

-- 6.3 لا طوابع مستقبلية
SELECT count(*) AS "طوابع مستقبلية (يجب 0)"
FROM public.signals
WHERE created_at > now() + interval '1 minute'
   OR activated_at > now() + interval '1 minute'
   OR closed_at > now() + interval '1 minute';

-- 6.4 لا مكرّرات
SELECT count(*) AS "مجموعات مكرّرة (يجب 0)"
FROM (
  SELECT symbol, timeframe,
         date_bin(
           CASE timeframe
             WHEN 'M15' THEN interval '15 minutes'
             WHEN 'H1'  THEN interval '1 hour'
             WHEN 'H4'  THEN interval '4 hours'
             WHEN 'D1'  THEN interval '1 day'
             ELSE interval '4 hours'
           END,
           created_at, timestamptz '2000-01-01 00:00:00+00'
         ) AS bucket
  FROM public.signals
  GROUP BY 1, 2, 3
  HAVING count(*) > 1
) d;

-- 6.5 سجل التدقيق
-- ⚠️ الجدول قد لا يكون موجودًا لو شغّلت المرحلة 3 بـ ROLLBACK (الجدول يُنشأ داخل
-- نفس الـ transaction فيُرجع معه). نتحقّق من وجوده أولًا بدل ما نرمي خطأ.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.signals_cleanup_log') IS NULL THEN
    RAISE NOTICE 'ℹ️ جدول signals_cleanup_log غير موجود — يبدو أن المرحلة 3 نُفّذت بـ ROLLBACK. لا سجل تدقيق.';
    RETURN;
  END IF;

  RAISE NOTICE '── سجل التدقيق ──';
  FOR r IN
    SELECT reason, count(*) AS n, min(deleted_at) AS first_at, max(deleted_at) AS last_at
    FROM public.signals_cleanup_log
    GROUP BY reason ORDER BY count(*) DESC
  LOOP
    RAISE NOTICE '   % : % صف  (من % إلى %)', r.reason, r.n, r.first_at, r.last_at;
  END LOOP;
END $$;


-- ============================================================================
-- المرحلة 7 — الاسترجاع (لو احتجت)
-- ============================================================================
-- استبدل <BACKUP_TABLE> باسم النسخة من مخرجات المرحلة 2.
--
--   BEGIN;
--   INSERT INTO public.signals
--     SELECT id, symbol, timeframe, direction, confidence, entry, stop_loss,
--            tp1, tp2, tp3, risk_reward, reasons, status, created_at,
--            activated_at, closed_at, closed_price, pips_gained, outcome
--     FROM public.signals_backup_<BACKUP_TABLE>
--     ON CONFLICT (id) DO NOTHING;
--   COMMIT;
--
-- ثم احذف سجل التدقيق المقابل لو أردت:
--   DELETE FROM public.signals_cleanup_log WHERE deleted_at >= '<timestamp>';


-- ============================================================================
-- المرحلة 8 — تنظيف جداول المساعدة (اختياري، بعد التأكد)
-- ============================================================================
-- لا تنفّذ هذا إلا بعد أن تتأكد أن كل شيء سليم وتريد حذف النسخ الاحتياطية.
--
--   DROP TABLE IF EXISTS public.signals_backup_20261101_1200;
--   DROP TABLE IF EXISTS public.alpha_cleanup_config;
--   DROP FUNCTION IF EXISTS public.alpha_cleanup_candidates();
--
-- ⚠️ احتفظ بجدول signals_cleanup_log — هو سجل دائم لما حدث.
-- ============================================================================
