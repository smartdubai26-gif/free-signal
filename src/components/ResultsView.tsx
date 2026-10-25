import React, { useState } from 'react';
import { Signal, AssetClass } from '../types/signals';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  Calendar,
  Filter,
} from 'lucide-react';

interface ResultsViewProps {
  signals: Signal[];
  onOpenDetails: (signal: Signal) => void;
  onRunSettlement: () => void;
}

export const ResultsView: React.FC<ResultsViewProps> = ({
  signals,
  onOpenDetails,
  onRunSettlement,
}) => {
  const [selectedAsset, setSelectedAsset] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Filter signals
  const filteredSignals = signals.filter((sig) => {
    if (selectedAsset !== 'all' && sig.assetClass !== selectedAsset) return false;
    if (selectedStatus === 'tp' && !sig.status.startsWith('TP')) return false;
    if (selectedStatus === 'sl' && sig.status !== 'SL_HIT') return false;
    if (selectedStatus === 'open' && sig.status !== 'OPEN') return false;
    return true;
  });

  // Calculate summary metrics
  const totalSettled = signals.filter((s) => s.status !== 'OPEN').length;
  const tp1Count = signals.filter((s) => s.status === 'TP1_HIT').length;
  const tp2Count = signals.filter((s) => s.status === 'TP2_HIT').length;
  const slCount = signals.filter((s) => s.status === 'SL_HIT').length;
  const openCount = signals.filter((s) => s.status === 'OPEN').length;

  const totalPips = signals.reduce((acc, curr) => acc + curr.resultPips, 0);
  const winRate = totalSettled > 0 ? (((tp1Count + tp2Count) / totalSettled) * 100).toFixed(1) : '100.0';

  return (
    <div className="space-y-6">
      {/* Results Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-950 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-wide">
                تقرير نتائج التوصيات وتسوية الجلسات
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              يتم تدقيق كل توصية آلياً عند إغلاق السوق الأوروبي والأمريكي (21:00 GMT) للتحقق من بلوغ الأهداف أو ضرب الوقف
            </p>
          </div>

          <button
            onClick={onRunSettlement}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-sm active:scale-95"
          >
            <RefreshCw className="w-4 h-4 text-amber-400" />
            <span>تشغيل فحص وتسوية النتائج الآن (Run Settlement)</span>
          </button>
        </div>

        {/* Aggregate KPI Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-5">
          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-center">
            <span className="text-[11px] text-slate-400 block mb-1">صافي النقاط المحققة</span>
            <span className={`text-xl sm:text-2xl font-bold font-mono ${totalPips >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {totalPips >= 0 ? `+${totalPips}` : totalPips} نقطة
            </span>
          </div>

          <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-center">
            <span className="text-[11px] text-slate-400 block mb-1">نسبة نجاح الأهداف (Win Rate)</span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-amber-400">
              {winRate}%
            </span>
          </div>

          <div className="p-3 bg-sky-950/20 rounded-xl border border-sky-900/30 text-center">
            <span className="text-[11px] text-sky-300 block mb-1">تحقق الهدف الأول (TP1)</span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-sky-400">
              {tp1Count} صفقات
            </span>
          </div>

          <div className="p-3 bg-blue-950/20 rounded-xl border border-blue-900/30 text-center">
            <span className="text-[11px] text-blue-300 block mb-1">تحقق الهدف الثاني (TP2)</span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-blue-400">
              {tp2Count} صفقات
            </span>
          </div>

          <div className="p-3 bg-rose-950/20 rounded-xl border border-rose-900/30 text-center col-span-2 sm:col-span-1">
            <span className="text-[11px] text-rose-300 block mb-1">ضرب وقف الخسارة (SL)</span>
            <span className="text-xl sm:text-2xl font-bold font-mono text-rose-400">
              {slCount} صفقات
            </span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Asset Class Filter */}
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            onClick={() => setSelectedAsset('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedAsset === 'all'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            الكل
          </button>
          <button
            onClick={() => setSelectedAsset('metals')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedAsset === 'metals'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            الذهب والمعادن
          </button>
          <button
            onClick={() => setSelectedAsset('energy')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedAsset === 'energy'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            النفط والطاقة
          </button>
          <button
            onClick={() => setSelectedAsset('forex-major')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedAsset === 'forex-major'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            العملات الرئيسية
          </button>
        </div>

        {/* Outcome Filter */}
        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            onClick={() => setSelectedStatus('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedStatus === 'all'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            كل الحالات
          </button>
          <button
            onClick={() => setSelectedStatus('tp')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedStatus === 'tp'
                ? 'bg-emerald-900/40 text-emerald-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            الأهداف المحققة (TP)
          </button>
          <button
            onClick={() => setSelectedStatus('sl')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedStatus === 'sl'
                ? 'bg-rose-900/40 text-rose-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            وقف الخسارة (SL)
          </button>
          <button
            onClick={() => setSelectedStatus('open')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedStatus === 'open'
                ? 'bg-sky-900/40 text-sky-300'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            قيد التداول (Active)
          </button>
        </div>
      </div>

      {/* Results List */}
      <div className="space-y-3">
        {filteredSignals.map((sig) => {
          const isLong = sig.direction === 'LONG';
          const isTP = sig.status.startsWith('TP');
          const isSL = sig.status === 'SL_HIT';
          const isOpen = sig.status === 'OPEN';
          const isPositivePips = sig.resultPips > 0;

          return (
            <div
              key={sig.id}
              onClick={() => onOpenDetails(sig)}
              className="group bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 transition-all rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer shadow-md"
            >
              {/* Left Column: Symbol & Outcome */}
              <div className="flex items-center gap-4">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isTP
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : isSL
                      ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      : 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                  }`}
                >
                  {isTP && <CheckCircle2 className="w-5 h-5" />}
                  {isSL && <XCircle className="w-5 h-5" />}
                  {isOpen && <Clock className="w-5 h-5" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-mono font-bold text-base">
                      {sig.symbol}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-bold ${
                        isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      {isLong ? 'شراء' : 'بيع'}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({sig.nameAr})
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                    <span>تاريخ النشر: {new Date(sig.timestamp).toLocaleDateString('ar-EG')}</span>
                    <span>·</span>
                    <span className={isTP ? 'text-emerald-400' : isSL ? 'text-rose-400' : 'text-sky-400'}>
                      {sig.exitReasonAr || (isOpen ? 'الصفقة مستمرة وقيد التداول' : 'مكتملة')}
                    </span>
                  </p>
                </div>
              </div>

              {/* Middle Column: Entry / Target Levels */}
              <div className="hidden lg:grid grid-cols-3 gap-3 text-xs font-mono text-slate-300">
                <div className="p-2 bg-slate-950/60 rounded border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">سعر الدخول</span>
                  <span className="text-white font-semibold">{sig.entry.toFixed(sig.pipValueDecimals)}</span>
                </div>
                <div className="p-2 bg-slate-950/60 rounded border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">وقف الخسارة SL</span>
                  <span className="text-rose-400 font-semibold">{sig.stopLoss.toFixed(sig.pipValueDecimals)}</span>
                </div>
                <div className="p-2 bg-slate-950/60 rounded border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">الهدف TP1 / TP2</span>
                  <span className="text-sky-400 font-semibold">{sig.takeProfit1.toFixed(sig.pipValueDecimals)}</span>
                </div>
              </div>

              {/* Right Column: Pips and Action */}
              <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4">
                <div className="text-right">
                  <span className="text-[11px] text-slate-400 block">النتيجة النظرية</span>
                  <span
                    className={`font-mono text-lg font-bold ${
                      isPositivePips
                        ? 'text-emerald-400'
                        : sig.resultPips < 0
                        ? 'text-rose-400'
                        : 'text-slate-200'
                    }`}
                  >
                    {isPositivePips ? `+${sig.resultPips}` : sig.resultPips} نقطة
                  </span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenDetails(sig);
                  }}
                  className="px-3 py-1.5 bg-slate-800 group-hover:bg-amber-500/20 text-slate-300 group-hover:text-amber-400 rounded-lg text-xs font-semibold transition-colors border border-slate-700 flex items-center gap-1"
                >
                  <span>عرض الشارت</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {filteredSignals.length === 0 && (
          <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
            <Calendar className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400 font-medium text-sm">
              لا توجد توصيات مطابقة للفلاتر المحددة حالياً.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
