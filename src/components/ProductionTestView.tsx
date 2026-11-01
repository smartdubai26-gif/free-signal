import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ShieldCheck,
  Calendar,
  Save,
  RotateCcw,
  Copy,
  Check,
  AlertCircle,
  FileText,
  TrendingUp,
} from 'lucide-react';

export type TestStatus = 'in_progress' | 'passed' | 'failed';

export interface DayTestItem {
  dayNumber: number;
  title: string;
  description: string;
  expectedResult: string;
  status: TestStatus;
  notes: string;
  testedDate: string;
  updatedAt?: string;
}

const DEFAULT_DAYS: DayTestItem[] = [
  {
    dayNumber: 1,
    title: 'اليوم الأول: توليد التوصيات آلياً عند الافتتاح',
    description: 'التحقق من عمل محرك التحليل الفني عند إغلاق شمعة 4 ساعات (وأولوية خاصة لشمعة افتتاح لندن 08:00 UTC) بدون أخطاء.',
    expectedResult: 'توليد توصيات متوازنة للأصول الـ 10 بحالة pending وأسعار دخول ووقف وخسارة منطقية.',
    status: 'in_progress',
    notes: 'تمت مراجعة اتصال AllTick وجلب الشمعات السعرية وجاهزية محرك RSI وMACD.',
    testedDate: new Date().toISOString().slice(0, 10),
  },
  {
    dayNumber: 2,
    title: 'اليوم الثاني: تفعيل الصفقات مع حركة السوق اللحظية',
    description: 'انتقال التوصيات المعلقة من حالة pending إلى active عند ملامسة السعر الحقيقي لنقطة الدخول.',
    expectedResult: 'تسجيل وقت التفعيل activated_at وسعر التفعيل تلقائياً عند تجاوز شرط الدخول.',
    status: 'in_progress',
    notes: '',
    testedDate: new Date().toISOString().slice(0, 10),
  },
  {
    dayNumber: 3,
    title: 'اليوم الثالث: حسم الصفقات بدقة (TP1 أو SL) واحتساب النقاط',
    description: 'تسجيل نتيجة صفقة واحدة على الأقل كـ won أو lost فور لمس الهدف الأول أو وقف الخسارة.',
    expectedResult: 'تسجيل closed_at وclosed_price واحتساب النقاط المحققة pips بدقة وفق مواصفات العقد.',
    status: 'in_progress',
    notes: '',
    testedDate: new Date().toISOString().slice(0, 10),
  },
  {
    dayNumber: 4,
    title: 'اليوم الرابع: إنشاء وتحديث الملخص اليومي daily_summary',
    description: 'التحقق من إنشاء صف الملخص اليومي لكل يوم تداول مع حساب إجمالي الأرباح ونسبة الفوز win_rate.',
    expectedResult: 'تطابق نسبة الفوز win_rate مع نسبة الصفقات الرابحة من إجمالي الصفقات المفعلة لليوم.',
    status: 'in_progress',
    notes: '',
    testedDate: new Date().toISOString().slice(0, 10),
  },
  {
    dayNumber: 5,
    title: 'اليوم الخامس: مطابقة نسبة الفوز التراكمية مع الحساب اليدوي',
    description: 'مقارنة نسبة الفوز وإجمالي النقاط في لوحة الأداء مع السجل الفعلي التاريخي للتوصيات المغلقة.',
    expectedResult: 'تطابق 100% بين الإحصائيات الرياضية للمحرك مع الحساب اليدوي لسجل الصفقات.',
    status: 'in_progress',
    notes: '',
    testedDate: new Date().toISOString().slice(0, 10),
  },
];

const STORAGE_KEY = 'alphafx_production_test_checklist';

export const ProductionTestView: React.FC = () => {
  const [checklist, setChecklist] = useState<DayTestItem[]>(DEFAULT_DAYS);
  const [storageMode, setStorageMode] = useState<'supabase' | 'local'>('local');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string>('');
  const [copiedSql, setCopiedSql] = useState<boolean>(false);

  // Load from Supabase (or localStorage fallback)
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const { data, error } = await supabase
          .from('production_test_log')
          .select('*')
          .order('day_number', { ascending: true });

        if (!error && data && data.length > 0 && isMounted) {
          const mapped: DayTestItem[] = data.map((row: any) => ({
            dayNumber: row.day_number,
            title: row.title,
            description: row.description,
            expectedResult: row.expected_result || row.description,
            status: row.status as TestStatus,
            notes: row.notes || '',
            testedDate: row.tested_date || new Date().toISOString().slice(0, 10),
            updatedAt: row.updated_at,
          }));
          setChecklist(mapped);
          setStorageMode('supabase');
          return;
        }
      } catch (err) {
        // Fallback to local storage
      }

      try {
        const local = localStorage.getItem(STORAGE_KEY);
        if (local && isMounted) {
          const parsed = JSON.parse(local);
          if (Array.isArray(parsed) && parsed.length === 5) {
            setChecklist(parsed);
          }
        }
      } catch (e) {
        // use default
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleStatusChange = (dayNumber: number, newStatus: TestStatus) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.dayNumber === dayNumber
          ? {
              ...item,
              status: newStatus,
              testedDate: new Date().toISOString().slice(0, 10),
            }
          : item
      )
    );
  };

  const handleNotesChange = (dayNumber: number, notes: string) => {
    setChecklist((prev) =>
      prev.map((item) => (item.dayNumber === dayNumber ? { ...item, notes } : item))
    );
  };

  const handleDateChange = (dayNumber: number, dateStr: string) => {
    setChecklist((prev) =>
      prev.map((item) => (item.dayNumber === dayNumber ? { ...item, testedDate: dateStr } : item))
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');

    // 1. Always update localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checklist));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }

    // 2. Try Supabase upsert
    let supaSuccess = false;
    try {
      const records = checklist.map((item) => ({
        day_number: item.dayNumber,
        title: item.title,
        description: item.description,
        status: item.status,
        notes: item.notes,
        tested_date: item.testedDate,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase.from('production_test_log').upsert(records, {
        onConflict: 'day_number',
      });

      if (!error) {
        supaSuccess = true;
        setStorageMode('supabase');
      }
    } catch {
      supaSuccess = false;
    }

    setIsSaving(false);
    if (supaSuccess) {
      setSaveMessage('تم حفظ سجل الاختبارات بنجاح في قاعدة بيانات Supabase.');
    } else {
      setSaveMessage('تم حفظ السجل محلياً في المتصفح (مزامنة مع السحابة جاهزة عند توفر الجدول).');
    }

    setTimeout(() => setSaveMessage(''), 4500);
  };

  const handleReset = () => {
    if (window.confirm('هل تريد إعادة تعيين قائمة الاختبارات الميدانية إلى حالتها الابتدائية؟')) {
      setChecklist(DEFAULT_DAYS);
      localStorage.removeItem(STORAGE_KEY);
      setSaveMessage('تمت استعادة القيم الافتراضية.');
      setTimeout(() => setSaveMessage(''), 3000);
    }
  };

  const sqlCreateTable = `-- Create table for Production Test Log in Supabase SQL Editor
CREATE TABLE IF NOT EXISTS production_test_log (
  day_number INT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'passed', 'failed')),
  notes TEXT DEFAULT '',
  tested_date TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);`;

  const copySql = () => {
    navigator.clipboard.writeText(sqlCreateTable);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  // Metrics summary
  const passedCount = checklist.filter((i) => i.status === 'passed').length;
  const failedCount = checklist.filter((i) => i.status === 'failed').length;
  const inProgressCount = checklist.filter((i) => i.status === 'in_progress').length;
  const progressPercent = Math.round((passedCount / 5) * 100);

  return (
    <div className="space-y-6 text-right" dir="rtl">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 p-5 rounded-2xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>خطة التحقق الميداني لـ 5 أيام تداول (5-Day Real-Test Checklist)</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                {storageMode === 'supabase' ? 'متزامن مع Supabase' : 'تخزين محلي آمن'}
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              بروتوكول التحقق الصارم للتأكد من إنتاج وتسوية توصيات حقيقية 100% مستمدة من بيانات AllTick اللحظية.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch md:self-auto justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'جاري الحفظ...' : 'حفظ التحديثات'}</span>
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold border border-slate-700 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>إعادة تعيين</span>
          </button>
        </div>
      </div>

      {/* Save Notification */}
      {saveMessage && (
        <div className="bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 px-4 py-2.5 rounded-xl text-xs flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {/* Progress & Milestone Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 block">نسبة الإنجاز الميداني</span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-white">{progressPercent}%</span>
            <span className="text-xs text-slate-500">({passedCount} من 5 أيام)</span>
          </div>
          <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden mt-3">
            <div
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 block">الاختبارات الناجحة (Passed)</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-emerald-400">{passedCount}</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-400/80" />
          </div>
          <span className="text-[11px] text-slate-500 mt-2 block">تم التحقق منها بنجاح</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 block">قيد الاختبار (In Progress)</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-amber-400">{inProgressCount}</span>
            <Clock className="w-5 h-5 text-amber-400/80" />
          </div>
          <span className="text-[11px] text-slate-500 mt-2 block">بانتظار حركة الأسواق والمطابقة</span>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 block">فشل الاختبار (Failed)</span>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-rose-400">{failedCount}</span>
            <XCircle className="w-5 h-5 text-rose-400/80" />
          </div>
          <span className="text-[11px] text-slate-500 mt-2 block">يتطلب فحص لوجستي للمحرك</span>
        </div>
      </div>

      {/* 5-Day Checklist Cards */}
      <div className="space-y-4">
        {checklist.map((item) => {
          const isPassed = item.status === 'passed';
          const isFailed = item.status === 'failed';
          const isInProgress = item.status === 'in_progress';

          return (
            <div
              key={item.dayNumber}
              className={`p-5 rounded-2xl border transition-all ${
                isPassed
                  ? 'bg-slate-900/80 border-emerald-500/40 shadow-emerald-950/20 shadow-md'
                  : isFailed
                  ? 'bg-slate-900/80 border-rose-500/40'
                  : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 border ${
                      isPassed
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                        : isFailed
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                        : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    }`}
                  >
                    D{item.dayNumber}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <span>{item.title}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">{item.description}</p>
                  </div>
                </div>

                {/* Status Badges & Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 self-stretch lg:self-auto justify-end">
                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      onClick={() => handleStatusChange(item.dayNumber, 'passed')}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        isPassed
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-emerald-400'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>ناجح (Passed)</span>
                    </button>

                    <button
                      onClick={() => handleStatusChange(item.dayNumber, 'in_progress')}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isInProgress
                          ? 'bg-amber-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-amber-400'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>قيد الاختبار</span>
                    </button>

                    <button
                      onClick={() => handleStatusChange(item.dayNumber, 'failed')}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        isFailed
                          ? 'bg-rose-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-rose-400'
                      }`}
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>فشل (Failed)</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Details & Notes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                <div className="md:col-span-2 space-y-2">
                  <label className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>ملاحظات الفاحص الميداني (Notes & Observations):</span>
                  </label>
                  <textarea
                    value={item.notes}
                    onChange={(e) => handleNotesChange(item.dayNumber, e.target.value)}
                    placeholder="سجل ملاحظاتك حول حركة الأسعار أو وقت التفعيل أو نتائج التسوية لهذا اليوم..."
                    className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 transition-colors h-18 resize-none"
                  />
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-slate-400 flex items-center gap-1.5 font-medium mb-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>تاريخ تنفيذ الاختبار:</span>
                    </label>
                    <input
                      type="date"
                      value={item.testedDate}
                      onChange={(e) => handleDateChange(item.dayNumber, e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>

                  <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] text-slate-400">
                    <span className="text-indigo-400 font-bold block mb-0.5">النتيجة المتوقعة:</span>
                    <span>{item.expectedResult}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* SQL Setup Drawer for Supabase */}
      <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-2xl">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <h4 className="text-xs font-bold text-white">
              مزامنة السجل سحابياً عبر جدول production_test_log في Supabase
            </h4>
          </div>
          <button
            onClick={copySql}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-lg text-xs font-mono border border-slate-700 transition-colors cursor-pointer"
          >
            {copiedSql ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSql ? 'تم النسخ!' : 'نسخ كود SQL'}</span>
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-2">
          لتمكين الحفظ والمزامنة السحابية المتعددة، قم بتشغيل هذا الاستعلام لمرة واحدة في محرر Supabase SQL Editor:
        </p>
        <pre className="bg-slate-950 border border-slate-800 p-3 rounded-xl text-[11px] text-slate-300 font-mono overflow-x-auto text-left" dir="ltr">
          {sqlCreateTable}
        </pre>
      </div>
    </div>
  );
};
