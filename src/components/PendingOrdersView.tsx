import React from 'react';
import { Signal } from '../types/signals';
import { Clock, ArrowUpRight, ArrowDownRight, Layers, Zap } from 'lucide-react';

interface PendingOrdersViewProps {
  signals: Signal[];
  onOpenDetails: (signal: Signal) => void;
  onRunSettlement: () => void;
  isSettling: boolean;
}

export const PendingOrdersView: React.FC<PendingOrdersViewProps> = ({
  signals,
  onOpenDetails,
  onRunSettlement,
  isSettling,
}) => {
  // Filter signals that are pending (entry price not yet reached / awaiting breakout trigger)
  // and are verified as live data.
  const pendingSignals = signals.filter(
    (s) =>
      (s.status === 'pending' ||
      s.status === 'OPEN' ||
      s.status === 'not_triggered') &&
      s.dataQuality === 'live'
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
            <Clock className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>قسم الفرص المعلقة واختراق المستويات (Pending & Limit Orders)</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                {pendingSignals.length} فرص معلقة
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              هذه الصفقات في انتظار وصول السعر لمستويات الاختراق أو إعادة الاختبار (Buy Stop / Sell Stop / Limit) لتفعيلها تلقائياً عبر محرك التسوية.
            </p>
          </div>
        </div>

        <button
          onClick={onRunSettlement}
          disabled={isSettling}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 whitespace-nowrap cursor-pointer disabled:opacity-50"
        >
          <Zap className={`w-3.5 h-3.5 ${isSettling ? 'animate-spin' : ''}`} />
          <span>{isSettling ? 'جاري الفحص والتفعيل...' : '⚡ فحص وتفعيل الأوامر المعلقة الآن'}</span>
        </button>
      </div>

      {/* Rules explanation banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-3 text-xs">
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
          <Layers className="w-4 h-4" />
        </div>
        <div className="text-slate-300 leading-relaxed">
          <strong className="text-white">آلية عمل الأوامر المعلقة:</strong> يتم رصد مستويات الدعم والمقاومة الحساسة عبر مؤشرات Price Action. بمجرد ملامسة أو اختراق السعر لنقطة الدخول المحددة في الجدول، يتحول الطلب تلقائياً إلى صفقة نشطة (Active).
        </div>
      </div>

      {/* Grid of Pending Orders */}
      {pendingSignals.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Clock className="w-8 h-8" />
          </div>
          <div className="max-w-md">
            <h3 className="text-base font-bold text-white mb-1">لا توجد أوامر معلقة في الانتظار حالياً</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              جميع الفرص الحالية نشطة أو تم حسم أهدافها. يمكنك تشغيل فحص السوق لاستخراج فرص واختراقات معلقة جديدة.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pendingSignals.map((sig) => {
            const isLong = sig.direction === 'LONG';
            return (
              <div
                key={sig.id}
                className="bg-slate-900 border border-slate-800 hover:border-amber-500/40 rounded-2xl p-5 shadow-xl transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white text-base">{sig.symbol}</span>
                      <span className="text-xs text-slate-400">({sig.nameAr})</span>
                    </div>
                    <span
                      className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${
                        isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      {isLong ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      <span>{isLong ? 'شراء معلق (Buy Stop/Limit)' : 'بيع معلق (Sell Stop/Limit)'}</span>
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-xs font-mono bg-slate-950 p-3 rounded-xl border border-slate-800/80 mb-3 text-center">
                    <div>
                      <span className="text-slate-400 text-[10px] block mb-0.5">سعر الدخول المعلق</span>
                      <span className="text-white font-bold">{sig.entry.toFixed(sig.pipValueDecimals)}</span>
                    </div>
                    <div>
                      <span className="text-amber-400 text-[10px] block mb-0.5">السعر الحالي بالسوق</span>
                      <span className="text-amber-300 font-bold">{(sig.currentPrice || sig.entry).toFixed(sig.pipValueDecimals)}</span>
                    </div>
                    <div>
                      <span className="text-sky-400 text-[10px] block mb-0.5">نسبة الثقة</span>
                      <span className="text-sky-300 font-bold">{sig.confidence}%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300 mb-4 px-1">
                    <div>
                      <span className="text-slate-500">وقف الخسارة (SL): </span>
                      <span className="font-mono text-rose-400 font-semibold">{sig.stopLoss.toFixed(sig.pipValueDecimals)}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">الهدف الأول (TP1): </span>
                      <span className="font-mono text-emerald-400 font-semibold">{sig.takeProfit1.toFixed(sig.pipValueDecimals)}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">الإطار: {sig.timeframe} · R:R {sig.riskRewardRatio}</span>
                  <button
                    onClick={() => onOpenDetails(sig)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                  >
                    عرض تفاصيل الشارت والتحليل
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
