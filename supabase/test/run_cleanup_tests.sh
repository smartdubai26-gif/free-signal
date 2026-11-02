#!/usr/bin/env bash
# ============================================================================
# اختبار آلي لسكربت cleanup-old-signals.sql على Postgres حقيقي
# ============================================================================
# يشغّل 4 سيناريوهات مستقلة، كل واحد على قاعدة نظيفة:
#   1. COMMIT  — الحذف الفعلي + التحقق من الصفوف الباقية
#   2. ROLLBACK — لا يُحذف شيء
#   3. idempotency — تشغيل مرتين لا يضر
#   4. legacy flag — خيار الإجازة القديمة
#
# الاستخدام:  bash supabase/test/run_cleanup_tests.sh
# ============================================================================
set -uo pipefail

PSQL="/usr/lib/postgresql/15/bin/psql"
HOST="-h /tmp/pgrun -p 5433"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$ROOT/supabase/cleanup-old-signals.sql"
SCHEMA="$ROOT/schema.sql"
SEED="$ROOT/supabase/test/seed_cleanup_test.sql"

PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — متوقع $3، وجد $2"; fi; }

q() { su postgres -c "$PSQL $HOST -d $1 -t -A -c \"$2\"" 2>/dev/null | tr -d '[:space:]'; }
run() { su postgres -c "$PSQL $HOST -d $1 -v ON_ERROR_STOP=1 -f $2" > /tmp/_t.log 2>&1; echo $?; }

fresh() {
  su postgres -c "$PSQL $HOST -c 'DROP DATABASE IF EXISTS $1;' -c 'CREATE DATABASE $1;'" >/dev/null 2>&1
  su postgres -c "$PSQL $HOST -d $1 -q -v ON_ERROR_STOP=1 -f $SCHEMA" >/dev/null 2>&1
  su postgres -c "$PSQL $HOST -d $1 -q -v ON_ERROR_STOP=1 -f $SEED" >/dev/null 2>&1
}

echo "════════════════════════════════════════════════════════════"
echo "  اختبار cleanup-old-signals.sql"
echo "════════════════════════════════════════════════════════════"

# ── السيناريو 1: COMMIT ─────────────────────────────────────────────────────
echo ""
echo "▶ السيناريو 1 — COMMIT (الحذف الفعلي)"
fresh t_commit
check "قبل: إجمالي الصفوف" "$(q t_commit 'SELECT count(*) FROM signals;')" "17"
check "قبل: المرشّحون" "$(q t_commit 'SELECT count(DISTINCT id) FROM alpha_cleanup_candidates();' 2>/dev/null || echo NA)" "NA"
RC=$(run t_commit "$SQL")
check "exit code" "$RC" "0"
check "بعد: الصفوف الباقية" "$(q t_commit 'SELECT count(*) FROM signals;')" "6"
check "بعد: مرشّحون متبقّون" "$(q t_commit 'SELECT count(DISTINCT id) FROM alpha_cleanup_candidates();')" "0"
check "بعد: تفعيلات سبت" "$(q t_commit "SELECT count(*) FROM signals WHERE activated_at IS NOT NULL AND EXTRACT(ISODOW FROM (activated_at AT TIME ZONE 'Africa/Cairo'))=6;")" "0"
check "بعد: طوابع مستقبلية" "$(q t_commit "SELECT count(*) FROM signals WHERE created_at > now()+interval '1 minute' OR activated_at > now()+interval '1 minute';")" "0"
check "بعد: سجل التدقيق (صف/إشارة)" "$(q t_commit 'SELECT count(*) FROM signals_cleanup_log;')" "11"
check "بعد: سجل التدقيق (ids فريدة)" "$(q t_commit 'SELECT count(DISTINCT id) FROM signals_cleanup_log;')" "11"
check "بعد: عدد جداول النسخ الاحتياطية" "$(q t_commit "SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'signals_backup_%';")" "1"
BK=$(q t_commit "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'signals_backup_%' LIMIT 1;")
check "بعد: صفوف النسخة الاحتياطية" "$(q t_commit "SELECT count(*) FROM public.$BK;")" "11"

# الصفوف الباقية يجب أن تكون هي الصحيحة تحديدًا
check "باقٍ: EUR/USD H4 active (اثنين)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='EUR/USD' AND status='active';")" "1"
check "باقٍ: GBP/USD (جمعة)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='GBP/USD';")" "1"
check "باقٍ: USD/CHF (أحد)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='USD/CHF';")" "1"
check "باقٍ: NZD/USD pending قديم" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='NZD/USD';")" "1"
check "محذوف: XAU/USD (سبت)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='XAU/USD';")" "0"
check "محذوف: EUR/JPY (مستقبل)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='EUR/JPY';")" "0"
check "محذوف: EUR/GBP (قديم)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='EUR/GBP';")" "0"
check "محذوف: GBP/JPY (وهمي)" "$(q t_commit "SELECT count(*) FROM signals WHERE symbol='GBP/JPY';")" "0"

# ── السيناريو 2: ROLLBACK ───────────────────────────────────────────────────
echo ""
echo "▶ السيناريو 2 — ROLLBACK (لا حذف)"
fresh t_rb
sed 's/^COMMIT;$/ROLLBACK;/' "$SQL" > /tmp/_rb.sql
RC=$(run t_rb /tmp/_rb.sql)
check "exit code" "$RC" "0"
check "بعد: الصفوف (بلا تغيير)" "$(q t_rb 'SELECT count(*) FROM signals;')" "17"
check "بعد: سجل التدقيق غير موجود" "$(q t_rb "SELECT CASE WHEN to_regclass('public.signals_cleanup_log') IS NULL THEN 'none' ELSE 'exists' END;")" "none"

# ── السيناريو 3: idempotency ────────────────────────────────────────────────
echo ""
echo "▶ السيناريو 3 — تشغيل مرتين"
fresh t_idem
run t_idem "$SQL" >/dev/null
RC=$(run t_idem "$SQL")
check "exit code (تشغيل ثانٍ)" "$RC" "0"
check "الصفوف بعد تشغيلين" "$(q t_idem 'SELECT count(*) FROM signals;')" "6"
check "سجل التدقيق لم يتضاعف" "$(q t_idem 'SELECT count(*) FROM signals_cleanup_log;')" "11"

# ── السيناريو 4: legacy flag ────────────────────────────────────────────────
echo ""
echo "▶ السيناريو 4 — خيار الإجازة القديمة (include_legacy_holiday)"
fresh t_legacy
su postgres -c "$PSQL $HOST -d t_legacy -q -c \"
  CREATE TABLE IF NOT EXISTS alpha_cleanup_config (
    id int PRIMARY KEY DEFAULT 1 CHECK (id=1),
    retention_days int NOT NULL DEFAULT 30,
    rule_change_date date NOT NULL DEFAULT DATE '2026-11-01',
    include_future boolean NOT NULL DEFAULT true,
    include_saturday boolean NOT NULL DEFAULT true,
    include_legacy_holiday boolean NOT NULL DEFAULT false,
    include_duplicates boolean NOT NULL DEFAULT true,
    include_retention boolean NOT NULL DEFAULT true,
    include_phantom_active boolean NOT NULL DEFAULT true,
    updated_at timestamptz DEFAULT now());
  INSERT INTO alpha_cleanup_config (id, include_legacy_holiday) VALUES (1, true)
  ON CONFLICT (id) DO UPDATE SET include_legacy_holiday = true;\"" >/dev/null 2>&1
RC=$(run t_legacy "$SQL")
check "exit code" "$RC" "0"
check "الصفوف الباقية (أقل بواحد)" "$(q t_legacy 'SELECT count(*) FROM signals;')" "5"
check "USD/CHF (أحد قديم) محذوف" "$(q t_legacy "SELECT count(*) FROM signals WHERE symbol='USD/CHF';")" "0"
check "USD/CAD (جمعة قديم) محذوف" "$(q t_legacy "SELECT count(*) FROM signals WHERE symbol='USD/CAD';")" "0"
check "GBP/USD (جمعة جديدة) باقٍ" "$(q t_legacy "SELECT count(*) FROM signals WHERE symbol='GBP/USD';")" "1"

# ── النتيجة ─────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅ نجحت كل الاختبارات: $PASS"
else
  echo "  ❌ فشل $FAIL من $((PASS+FAIL))"
fi
echo "════════════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ]
