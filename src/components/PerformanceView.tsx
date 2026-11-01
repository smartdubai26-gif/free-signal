import React, { useState, useEffect } from 'react';
import { useResponsiveTable } from '../hooks/useResponsiveTable';
import { PerformanceStats, DailySummary } from '../types/signals';
import { getDailySummary, get7DaySummaries, updateDailySummary, formatDateYmd } from '../services/dailySummary';
import {
  TrendingUp,
  Award,
  BarChart3,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  Scale,
  Percent,
  Coins,
  Flame,
  Globe2,
  RefreshCw,
  Play,
  Calendar,
  Activity,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface PerformanceViewProps {
  stats: PerformanceStats;
  onTriggerSettlement?: () => Promise<void>;
  isSettling?: boolean;
}

export const PerformanceView: React.FC<PerformanceViewProps> = ({
  stats,
  onTriggerSettlement,
  isSettling = false,
}) => {
  const t1Ref = useResponsiveTable<HTMLTableElement>();
  const [todaySummary, setTodaySummary] = useState<DailySummary | null>(null);
  const [sevenDaySummaries, setSevenDaySummaries] = useState<DailySummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchPerformanceData = async () => {
    setIsLoading(true);
    try {
      const today = await getDailySummary(formatDateYmd());
      const week = await get7DaySummaries();
      setTodaySummary(today);
      setSevenDaySummaries(week);
    } catch (err) {
      console.warn('Failed to load performance data from Supabase:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPerformanceData();
  }, []);

  const handleManualRefresh = async () => {
    await updateDailySummary();
    await fetchPerformanceData();
  };

  // 7-day chart calculations
  const maxWinRate = 100;
  const chartHeight = 160;

  return (
    <div className="space-y-6">
      {/* Header with Quick Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/90 to-slate-950 border border-slate-800 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white">لوحة أداء التحليل والتسوية</h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              قاعدة بيانات Supabase المباشرة
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            سجل التدقيق المستمر لنتائج التوصيات المغلقة ونسب الربحية واحتساب النقاط تلقائياً
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-amber-400' : ''}`} />
            <span>تحديث البيانات</span>
          </button>

          {onTriggerSettlement && (
            <button
              onClick={onTriggerSettlement}
              disabled={isSettling}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 border border-emerald-500/40 transition disabled:opacity-50"
            >
              <Play className={`w-3.5 h-3.5 ${isSettling ? 'animate-spin' : 'fill-white'}`} />
              <span>{isSettling ? 'جارٍ فحص التسوية...' : 'تشغيل التسوية الآن'}</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: TODAY'S REAL-TIME SUMMARY */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-amber-400" />
            <h3 className="text-base font-bold text-white">
              ملخص أداء اليوم ({formatDateYmd()})
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            تحديث تلقائي وفق محرك التسوية
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Total Signals */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <span className="text-xs text-slate-400">إجمالي التوصيات</span>
            <div className="font-mono text-2xl font-bold text-white mt-2">
              {todaySummary ? todaySummary.total_signals : 0}
            </div>
            <span className="text-[10px] text-slate-400 mt-1">توصيات اليوم</span>
          </div>

          {/* Active Signals */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-cyan-500/30 flex flex-col justify-between">
            <span className="text-xs text-cyan-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
              نشطة قيد التداول
            </span>
            <div className="font-mono text-2xl font-bold text-cyan-300 mt-2">
              {todaySummary ? todaySummary.active_signals : 0}
            </div>
            <span className="text-[10px] text-slate-400 mt-1">تجاوزت نقطة الدخول</span>
          </div>

          {/* Won Signals */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-emerald-500/30 flex flex-col justify-between">
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              رابحة (حقق الهدف)
            </span>
            <div className="font-mono text-2xl font-bold text-emerald-400 mt-2">
              {todaySummary ? todaySummary.won_signals : 0}
            </div>
            <span className="text-[10px] text-slate-400 mt-1">أصابت TP1 بنجاح</span>
          </div>

          {/* Lost Signals */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-rose-500/30 flex flex-col justify-between">
            <span className="text-xs text-rose-400 flex items-center gap-1">
              <XCircle className="w-3.5 h-3.5" />
              خاسرة (ضرب الوقف)
            </span>
            <div className="font-mono text-2xl font-bold text-rose-400 mt-2">
              {todaySummary ? todaySummary.lost_signals : 0}
            </div>
            <span className="text-[10px] text-slate-400 mt-1">أصابت Stop Loss</span>
          </div>

          {/* Win Rate */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 flex flex-col justify-between">
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <Award className="w-3.5 h-3.5" />
              نسبة النجاح
            </span>
            <div className="font-mono text-2xl font-bold text-amber-400 mt-2">
              {todaySummary ? `${todaySummary.win_rate}%` : '0%'}
            </div>
            <span className="text-[10px] text-slate-400 mt-1">للتوصيات المحسومة</span>
          </div>

          {/* Total Net Pips */}
          <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              صافي النقاط اليومية
            </span>
            <div className={`font-mono text-2xl font-bold mt-2 ${
              (todaySummary?.total_pips || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}>
              {(todaySummary?.total_pips || 0) > 0 ? `+${todaySummary?.total_pips}` : (todaySummary?.total_pips || 0)}
            </div>
            <span className="text-[10px] text-slate-400 mt-1">نقطة ربح/خسارة</span>
          </div>
        </div>
      </div>

      {/* SECTION 2: 7-DAY WIN RATE & PIP ACCUMULATION CHART */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-base font-bold text-white">
              مخطط معدل النجاح والنقاط لآخر 7 أيام
            </h3>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-400"></span>
              <span className="text-slate-300">نسبة النجاح (%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-500"></span>
              <span className="text-slate-300">نقاط موجبة</span>
            </div>
          </div>
        </div>

        {/* Bar Chart Visualization */}
        <div className="space-y-4">
          <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end h-44 pt-6 pb-2 border-b border-slate-800">
            {sevenDaySummaries.map((day, idx) => {
              const heightPercent = Math.max(day.win_rate, 8);
              const isToday = day.date === formatDateYmd();
              return (
                <div key={idx} className="flex flex-col items-center h-full justify-end group relative">
                  {/* Tooltip on hover */}
                  <div className="absolute -top-10 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950 border border-slate-700 text-[11px] text-slate-200 px-2 py-1 rounded shadow-lg pointer-events-none whitespace-nowrap z-20">
                    <div>{day.date}</div>
                    <div className="font-bold text-amber-400">نجاح: {day.win_rate}%</div>
                    <div className="text-emerald-400">نقاط: {day.total_pips > 0 ? `+${day.total_pips}` : day.total_pips}</div>
                  </div>

                  {/* Value label */}
                  <span className="text-[11px] font-mono font-bold text-slate-300 mb-1">
                    {day.win_rate > 0 ? `${day.win_rate}%` : '—'}
                  </span>

                  {/* Bar */}
                  <div className="w-full max-w-[42px] bg-slate-800/80 rounded-t-lg relative flex flex-col justify-end overflow-hidden" style={{ height: `${(heightPercent / maxWinRate) * 100}%` }}>
                    <div
                      className={`w-full h-full transition-all duration-300 ${
                        day.win_rate >= 70
                          ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                          : day.win_rate >= 50
                          ? 'bg-gradient-to-t from-amber-600 to-amber-400'
                          : day.win_rate > 0
                          ? 'bg-gradient-to-t from-rose-600 to-rose-400'
                          : 'bg-slate-700/50'
                      }`}
                    ></div>
                  </div>

                  {/* Date label */}
                  <span className={`text-[10px] mt-2 font-mono ${isToday ? 'text-amber-400 font-bold' : 'text-slate-400'}`}>
                    {day.date.slice(5)} {isToday && '(اليوم)'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* SECTION 3: 7-DAY PERFORMANCE LOG TABLE */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-xl overflow-hidden">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4 text-sky-400" />
          <h3 className="text-base font-bold text-white">
            جدول أداء آخر 7 أيام (سجل التسوية الموثق)
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table ref={t1Ref} className="rtable w-full text-right text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                <th className="py-3 px-4 font-semibold">التاريخ</th>
                <th className="py-3 px-4 font-semibold">إجمالي التوصيات</th>
                <th className="py-3 px-4 font-semibold">رابحة</th>
                <th className="py-3 px-4 font-semibold">خاسرة</th>
                <th className="py-3 px-4 font-semibold">لم تتفعل</th>
                <th className="py-3 px-4 font-semibold">نسبة النجاح</th>
                <th className="py-3 px-4 font-semibold">صافي النقاط</th>
                <th className="py-3 px-4 font-semibold">أفضل صفقة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {sevenDaySummaries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-500 font-sans">
                    لا توجد بيانات تسوية محفوظة للأيام السابقة
                  </td>
                </tr>
              ) : (
                sevenDaySummaries.map((day, idx) => {
                  const isPositive = day.total_pips > 0;
                  const isNegative = day.total_pips < 0;
                  return (
                    <tr key={idx} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 font-bold text-slate-200">
                        {day.date}
                      </td>
                      <td className="py-3 px-4 text-slate-300">{day.total_signals}</td>
                      <td className="py-3 px-4 text-emerald-400 font-semibold">{day.won_signals}</td>
                      <td className="py-3 px-4 text-rose-400 font-semibold">{day.lost_signals}</td>
                      <td className="py-3 px-4 text-slate-400">{day.not_triggered_signals}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded font-bold ${
                          day.win_rate >= 70
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : day.win_rate >= 50
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {day.win_rate}%
                        </span>
                      </td>
                      <td className={`py-3 px-4 font-bold ${
                        isPositive ? 'text-emerald-400' : isNegative ? 'text-rose-400' : 'text-slate-300'
                      }`}>
                        {isPositive ? `+${day.total_pips}` : day.total_pips}
                      </td>
                      <td className="py-3 px-4 text-emerald-400">
                        {day.best_trade_pips > 0 ? `+${day.best_trade_pips}` : '0'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 4: HISTORICAL CUMULATIVE METRICS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Cumulative Win Rate */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">معدل النجاح التراكمي</span>
            <Award className="w-4 h-4 text-amber-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-amber-400">
            {stats.winRate}%
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            {stats.winningTrades} صفقة رابحة من أصل {stats.totalTrades}
          </span>
        </div>

        {/* Cumulative Total Pips */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">إجمالي النقاط التراكمية</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-emerald-400">
            +{stats.totalPips.toLocaleString()}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            صافي نقاط بعد احتساب كافة الصفقات
          </span>
        </div>

        {/* Profit Factor */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">عامل الربحية (Profit Factor)</span>
            <Scale className="w-4 h-4 text-sky-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-sky-400">
            {stats.profitFactor}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            نسبة إجمالي الأرباح إلى الخسائر
          </span>
        </div>

        {/* Risk to Reward */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold">متوسط العائد إلى المخاطرة</span>
            <ShieldCheck className="w-4 h-4 text-teal-400" />
          </div>
          <div className="font-mono text-3xl font-bold text-teal-400">
            {stats.averageRiskReward || '1:2.4'}
          </div>
          <span className="text-xs text-slate-400 mt-1 block">
            متوسط الانضباط الحسابي
          </span>
        </div>
      </div>
    </div>
  );
};
