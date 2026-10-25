import React, { useState, useEffect } from 'react';
import { runDiagnostics } from '../services/diagnostics';
import { DiagnosticReport } from '../types/signals';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Server,
  Database,
  Radio,
  Clock,
  ShieldCheck,
  AlertOctagon,
  Copy,
  Check,
  Zap,
} from 'lucide-react';

export const DiagnosticsView: React.FC = () => {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const executeDiagnostics = async () => {
    setRunning(true);
    try {
      const res = await runDiagnostics();
      setReport(res);
    } catch (err) {
      console.error('Diagnostics execution error:', err);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    executeDiagnostics();
  }, []);

  const handleCopyReport = () => {
    if (!report) return;
    const summary = `
🔍 تقرير الفحص والتشخيص الشامل (AlphaFX System Diagnostics)
تاريخ الفحص: ${new Date(report.timestamp).toLocaleString('ar-EG')}
الحالة الإجمالية: ${report.overallStatus.toUpperCase()}

1. مزود AllTick REST: ${report.alltickLatencyMs}ms (${report.alltickStatus.toUpperCase()})
2. قاعدة Supabase DB: ${report.supabaseLatencyMs}ms (${report.supabaseStatus.toUpperCase()})
3. بث AllTick WebSocket: ${report.websocketState} (${report.websocketStatus.toUpperCase()})
4. حالة الخادم السحابي (24/7): ${report.serverStatusCheck?.isRecent ? '🟢 Server Active' : '🔴 Server Offline'}
5. الأصول الراكدة (>5د): ${report.assetFreshness.filter(a => a.status === 'stale').length}/10
6. صحة خط الإنتاج:
   - معلقات متأخرة (>24س): ${report.pipelineHealth.pendingOlderThan24h}
   - نشطة عالقة (>48س): ${report.pipelineHealth.activeOlderThan48h}
   - تكرارات مرصودة: ${report.pipelineHealth.duplicatesCount}
    `.trim();

    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getStatusColor = (status: 'green' | 'yellow' | 'red') => {
    if (status === 'green') return {
      badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      dot: 'bg-emerald-400',
      border: 'border-emerald-500/30',
      text: 'text-emerald-400',
      icon: CheckCircle2,
    };
    if (status === 'yellow') return {
      badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
      dot: 'bg-amber-400',
      border: 'border-amber-500/30',
      text: 'text-amber-400',
      icon: AlertTriangle,
    };
    return {
      badge: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
      dot: 'bg-rose-400',
      border: 'border-rose-500/30',
      text: 'text-rose-400',
      icon: XCircle,
    };
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-4 sm:p-5 rounded-2xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500/20 to-blue-400/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>الفحص والتشخيص الذاتي (System Diagnostics & Self-Test)</span>
              {report && (
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${getStatusColor(report.overallStatus).badge}`}>
                  {report.overallStatus === 'green' ? 'جميع الأنظمة تعمل بكفاءة' : report.overallStatus === 'yellow' ? 'تحذيرات طفيفة' : 'تنبيه بحاجة لتدخل'}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              فحص لحظي مباشر للـ APIs وقاعدة البيانات وتدفق WebSocket وسلامة جدول التوصيات
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleCopyReport}
            disabled={!report}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'تم النسخ' : 'نسخ التقرير'}</span>
          </button>

          <button
            onClick={executeDiagnostics}
            disabled={running}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
            <span>{running ? 'جارٍ الفحص...' : 'إعادة الفحص الآن'}</span>
          </button>
        </div>
      </div>

      {running && !report && (
        <div className="p-12 text-center text-slate-400 space-y-3 bg-slate-900/40 rounded-2xl border border-slate-800">
          <RefreshCw className="w-8 h-8 mx-auto animate-spin text-amber-400" />
          <p className="text-sm">جارٍ قياس زمن الاستجابة واختبار قنوات الاتصال وقاعدة البيانات...</p>
        </div>
      )}

      {report && (
        <>
          {/* Server Scheduler Status Banner (GitHub Actions 24/7) */}
          <div
            className={`p-4 sm:p-5 rounded-2xl border shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
              report.serverStatusCheck?.isRecent
                ? 'bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-900 border-emerald-500/40 shadow-emerald-950/20'
                : 'bg-gradient-to-r from-rose-950/70 via-slate-900 to-slate-900 border-rose-500/40 shadow-rose-950/20'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 border ${
                  report.serverStatusCheck?.isRecent
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                    : 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                }`}
              >
                <Server className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm sm:text-base font-bold font-mono px-3 py-0.5 rounded-full border ${
                      report.serverStatusCheck?.isRecent
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    {report.serverStatusCheck?.isRecent ? '🟢 Server Active' : '🔴 Server Offline'}
                  </span>
                  <span className="text-xs text-slate-400">
                    جدولة الخادم السحابي المستقلة 24/7 (GitHub Actions Scheduled Workflows)
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  {report.serverStatusCheck?.message || 'فحص نشاط الخادم عبر آخر توصية تم توليدها وحفظها.'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono self-stretch md:self-auto shrink-0">
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-right">
                <span className="text-[10px] text-slate-400 block">آخر توصية مسجلة:</span>
                <span className="text-white font-semibold block mt-0.5">
                  {report.serverStatusCheck?.lastSignalCreatedAt
                    ? new Date(report.serverStatusCheck.lastSignalCreatedAt).toLocaleTimeString('ar-EG', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'لا توجد'}
                </span>
              </div>
              <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800 text-right">
                <span className="text-[10px] text-slate-400 block">المدة المنقضية:</span>
                <span
                  className={`font-semibold block mt-0.5 ${
                    report.serverStatusCheck?.isRecent ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {report.serverStatusCheck?.ageHours != null ? `${report.serverStatusCheck.ageHours} ساعة` : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Main 3 Diagnostic Cards: AllTick, Supabase, WebSocket */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. AllTick REST API */}
            {(() => {
              const cfg = getStatusColor(report.alltickStatus);
              const Icon = cfg.icon;
              return (
                <div className={`p-4 bg-slate-900/80 rounded-2xl border ${cfg.border} shadow-lg space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-slate-800 text-slate-200">
                        <Server className="w-4 h-4" />
                      </div>
                      <span className="font-bold text-sm text-white">AllTick REST API</span>
                    </div>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1 ${cfg.badge}`}>
                      <Icon className="w-3 h-3" />
                      <span>{report.alltickLatencyMs} ms</span>
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 leading-relaxed font-sans">
                    {report.alltickStatus === 'green'
                      ? 'زمن الاستجابة ممتاز (< 500ms). خوادم AllTick تجيب بأقصى سرعة.'
                      : report.alltickStatus === 'yellow'
                      ? 'زمن استجابة متوسط (500ms - 2000ms).'
                      : 'تجاوز زمن الاستجابة 2000ms أو حدث خطأ بالاتصال.'}
                  </div>

                  <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] font-mono flex items-center justify-between text-slate-400">
                    <span>الحد المقبول (SLA):</span>
                    <span className="text-white">&lt; 500ms ممتاز · &lt; 2000ms تحذير</span>
                  </div>
                </div>
              );
            })()}

            {/* 2. Supabase DB Ping */}
            {(() => {
              const cfg = getStatusColor(report.supabaseStatus);
              const Icon = cfg.icon;
              return (
                <div className={`p-4 bg-slate-900/80 rounded-2xl border ${cfg.border} shadow-lg space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-slate-800 text-slate-200">
                        <Database className="w-4 h-4" />
                      </div>
                      <span className="font-bold text-sm text-white">قاعدة بيانات Supabase</span>
                    </div>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1 ${cfg.badge}`}>
                      <Icon className="w-3 h-3" />
                      <span>{report.supabaseLatencyMs} ms</span>
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 leading-relaxed font-sans">
                    {report.supabaseStatus === 'green'
                      ? 'زمن الاستجابة فائق (< 300ms). عمليات القراءة والتسوية تتم فورياً.'
                      : report.supabaseStatus === 'yellow'
                      ? 'زمن استجابة معتدل (300ms - 1000ms).'
                      : 'تأخير مرتفع فوق 1000ms أو تعذر الاتصال بالقاعدة.'}
                  </div>

                  <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] font-mono flex items-center justify-between text-slate-400">
                    <span>الحد المقبول (SLA):</span>
                    <span className="text-white">&lt; 300ms ممتاز · &lt; 1000ms تحذير</span>
                  </div>
                </div>
              );
            })()}

            {/* 3. WebSocket Connection */}
            {(() => {
              const cfg = getStatusColor(report.websocketStatus === 'green' ? 'green' : 'red');
              const Icon = cfg.icon;
              return (
                <div className={`p-4 bg-slate-900/80 rounded-2xl border ${cfg.border} shadow-lg space-y-3`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-xl bg-slate-800 text-slate-200">
                        <Radio className="w-4 h-4" />
                      </div>
                      <span className="font-bold text-sm text-white">بث WebSocket الحي</span>
                    </div>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border flex items-center gap-1 ${cfg.badge}`}>
                      <Icon className="w-3 h-3" />
                      <span>{report.websocketState}</span>
                    </span>
                  </div>

                  <div className="text-xs text-slate-300 leading-relaxed font-sans">
                    {report.websocketStatus === 'green'
                      ? 'قناة البث اللحظي مفتوحة وتستقبل دفق الشمعات بانتظام.'
                      : 'قناة البث اللحظي غير متصلة. التطبيق يعتمد على بروتوكول REST الاحتياطي.'}
                  </div>

                  <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] font-mono flex items-center justify-between text-slate-400">
                    <span>حالة البروتوكول:</span>
                    <span className="text-white">wss://quote.alltick.co/quote-b-ws-api</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Section 4: Data Freshness for 10 Tracked Assets */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">
                  فحص حداثة بيانات الأصول الـ 10 الأساسية (Data Freshness Check)
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                المعيار: يجب أن يكون السعر أحدث من 5 دقائق أثناء جلسات التداول
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-right font-sans">
                <thead className="bg-slate-950/80 text-slate-400 border-b border-slate-800 font-bold">
                  <tr>
                    <th className="py-3 px-4">الأصل المالي</th>
                    <th className="py-3 px-4 text-center">السعر الحالي</th>
                    <th className="py-3 px-4 text-center">عمر الشمعة / التحديث</th>
                    <th className="py-3 px-4 text-center">مصدر التغذية</th>
                    <th className="py-3 px-4 text-center">حالة الحداثة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {report.assetFreshness.map(asset => (
                    <tr key={asset.symbol} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                        <span>{asset.symbol}</span>
                      </td>
                      <td className="py-3 px-4 text-center text-slate-200">
                        {asset.price != null ? asset.price : '—'}
                      </td>
                      <td className="py-3 px-4 text-center text-slate-300">
                        {asset.ageMinutes} دقيقة
                      </td>
                      <td className="py-3 px-4 text-center text-slate-400">
                        {asset.source}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-0.5 rounded-full font-bold text-[11px] ${
                          asset.status === 'live'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                        }`}>
                          {asset.status === 'live' ? 'LIVE (نشط)' : 'STALE (قديم)'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Section 5: Signal Pipeline Health Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  فحص سلامة دورة حياة التوصيات (Signal Pipeline Health)
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                كشف المعلقات القديمة (&gt;24س)، والنشطة العالقة (&gt;48س)، والتكرارات
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono">
              <div className={`p-3.5 rounded-xl border ${
                report.pipelineHealth.pendingOlderThan24h === 0
                  ? 'bg-slate-950/80 border-slate-800'
                  : 'bg-amber-950/30 border-amber-500/40'
              }`}>
                <div className="text-[11px] text-slate-400 mb-1">معلقات أقدم من 24 ساعة (Pending &gt; 24h)</div>
                <div className={`text-xl font-bold ${report.pipelineHealth.pendingOlderThan24h === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {report.pipelineHealth.pendingOlderThan24h}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {report.pipelineHealth.pendingOlderThan24h === 0 ? 'لا توجد توصيات معلقة متأخرة' : 'يلزم الإلغاء أو التسوية'}
                </span>
              </div>

              <div className={`p-3.5 rounded-xl border ${
                report.pipelineHealth.activeOlderThan48h === 0
                  ? 'bg-slate-950/80 border-slate-800'
                  : 'bg-rose-950/30 border-rose-500/40'
              }`}>
                <div className="text-[11px] text-slate-400 mb-1">صفقات نشطة أقدم من 48 ساعة (Active &gt; 48h)</div>
                <div className={`text-xl font-bold ${report.pipelineHealth.activeOlderThan48h === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {report.pipelineHealth.activeOlderThan48h}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {report.pipelineHealth.activeOlderThan48h === 0 ? 'لا توجد صفقات عالقة قيد التداول' : 'تحتاج إغلاق بالسعر الحالي'}
                </span>
              </div>

              <div className={`p-3.5 rounded-xl border ${
                report.pipelineHealth.duplicatesCount === 0
                  ? 'bg-slate-950/80 border-slate-800'
                  : 'bg-amber-950/30 border-amber-500/40'
              }`}>
                <div className="text-[11px] text-slate-400 mb-1">التكرارات المرصودة (Duplicates)</div>
                <div className={`text-xl font-bold ${report.pipelineHealth.duplicatesCount === 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {report.pipelineHealth.duplicatesCount}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {report.pipelineHealth.duplicatesCount === 0 ? 'فحص التطابق سليم تماماً' : 'نفس الرمز والإطار واليوم'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 6 & 7: Fraud Detection (Mock Data) & Signal Physics */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Check 7: Mock Data Detection */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className={`w-4 h-4 ${report.mockDataCheck?.mockCount ? 'text-rose-400' : 'text-emerald-400'}`} />
                  <h3 className="text-sm font-bold text-white">
                    فحص واكتشاف البيانات الوهمية (Mock Data Detection)
                  </h3>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  report.mockDataCheck?.mockCount
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}>
                  {report.mockDataCheck?.mockCount ? '⚠️ MOCK DETECTED' : '✅ 100% REAL'}
                </span>
              </div>

              <p className="text-xs text-slate-300">
                {report.mockDataCheck?.mockCount
                  ? '⚠️ Mock data detected in database. Audit required.'
                  : 'No mock data detected. All signals pass integrity checks.'}
              </p>

              <div className="grid grid-cols-3 gap-2 font-mono text-center text-xs pt-1">
                <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">تواريخ مستقبلية</span>
                  <span className={`font-bold mt-0.5 block ${report.mockDataCheck?.futureDatesCount ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {report.mockDataCheck?.futureDatesCount ?? 0}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">حالات غير نظامية</span>
                  <span className={`font-bold mt-0.5 block ${report.mockDataCheck?.invalidStatusCount ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {report.mockDataCheck?.invalidStatusCount ?? 0}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">نسبة ثقة شاذة</span>
                  <span className={`font-bold mt-0.5 block ${report.mockDataCheck?.invalidConfidenceCount ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {report.mockDataCheck?.invalidConfidenceCount ?? 0}
                  </span>
                </div>
              </div>
            </div>

            {/* Check 8: Signal Physics Check */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className={`w-4 h-4 ${report.physicsCheck?.violationsCount ? 'text-rose-400' : 'text-emerald-400'}`} />
                  <h3 className="text-sm font-bold text-white">
                    مطابقة فيزياء حركة الأسعار (Signal Physics Check)
                  </h3>
                </div>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  report.physicsCheck?.violationsCount
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}>
                  {report.physicsCheck?.violationsCount ? '⚠️ VIOLATIONS' : '✅ 100% PHYSICS COMPLIANT'}
                </span>
              </div>

              <p className="text-xs text-slate-300">
                {report.physicsCheck?.violationsCount
                  ? `تم رصد ${report.physicsCheck.violationsCount} صفقة مغلقة تخالف حدود حركة الأسعار والوقف والأهداف.`
                  : 'All settled signals obey price action physics.'}
              </p>

              <div className="grid grid-cols-2 gap-2 font-mono text-center text-xs pt-1">
                <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">صفقات محسومة مفحوصة</span>
                  <span className="font-bold text-white mt-0.5 block">
                    {report.physicsCheck?.totalClosedChecked ?? 0}
                  </span>
                </div>
                <div className="bg-slate-950/70 p-2 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-400 block">مخالفات فيزيائية</span>
                  <span className={`font-bold mt-0.5 block ${report.physicsCheck?.violationsCount ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {report.physicsCheck?.violationsCount ?? 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Actionable Recommendations for Warnings or Errors */}
          {report.items.some(i => i.recommendation) && (
            <div className="p-4 bg-amber-950/20 border border-amber-500/30 rounded-2xl space-y-2">
              <h4 className="text-xs font-bold text-amber-400 flex items-center gap-2">
                <AlertOctagon className="w-4 h-4" />
                <span>إرشادات وحلول لمعالجة التنبيهات المرصودة:</span>
              </h4>
              <ul className="text-xs text-amber-200/90 space-y-1.5 list-disc list-inside">
                {report.items
                  .filter(i => Boolean(i.recommendation))
                  .map(i => (
                    <li key={i.id}>
                      <strong className="text-white">{i.name}:</strong> {i.recommendation}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
};
