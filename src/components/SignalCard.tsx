import React, { useState } from 'react';
import { Signal } from '../types/signals';
import { calculatePips } from '../services/technicalEngine';
import {
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  BarChart2,
  Copy,
  Check,
  Share2,
  Zap,
  Calculator,
  ChevronDown,
  ChevronUp,
  Flame,
  Lock,
} from 'lucide-react';

interface SignalCardProps {
  signal: Signal;
  onOpenDetails: (signal: Signal) => void;
  onSimulateTick?: (signalId: string, delta: number) => void;
}

export const SignalCard: React.FC<SignalCardProps> = ({
  signal,
  onOpenDetails,
}) => {
  const [copied, setCopied] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [lotSize, setLotSize] = useState<number>(0.1);

  const isLong = signal.direction === 'LONG';
  const isProfit = signal.resultPips > 0;
  const isLoss = signal.resultPips < 0;

  // Format currency/pip decimals
  const formatPrice = (val: number) => val.toFixed(signal.pipValueDecimals);

  // Copy recommendation to clipboard
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `
🎯 توصية تحليلية من AlphaFX Engine
الزوج/السلعة: ${signal.symbol} (${signal.nameAr})
الاتجاه: ${isLong ? '🟢 شراء (LONG)' : '🔴 بيع (SHORT)'}
نقطة الدخول: ${formatPrice(signal.entry)}
الهدف الأول (TP1): ${formatPrice(signal.takeProfit1)}
الهدف الثاني (TP2): ${formatPrice(signal.takeProfit2)}
وقف الخسارة (SL): ${formatPrice(signal.stopLoss)}
نسبة العائد للمخاطرة: ${signal.riskRewardRatio}
نسبة الثقة: ${signal.confidence}%
الفريم: ${signal.timeframe}
الأسباب الفنية: ${signal.reasoningAr}

⚠️ تنبيه: هذه التوصية للتحليل الفني فقط ولا تعد نصيحة مالية.
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Calculate monetary expectation based on lot size
  const pipDollarValue = signal.assetClass === 'metals' && signal.symbol.includes('XAU')
    ? lotSize * 10 // Gold: 0.1 lot = $1 per 10 points
    : signal.assetClass === 'energy'
    ? lotSize * 10
    : lotSize * 10; // Approx standard forex

  const tp1Pips = Math.abs(Math.round((signal.takeProfit1 - signal.entry) * Math.pow(10, signal.pipValueDecimals)));
  const tp2Pips = Math.abs(Math.round((signal.takeProfit2 - signal.entry) * Math.pow(10, signal.pipValueDecimals)));
  const slPips = Math.abs(Math.round((signal.stopLoss - signal.entry) * Math.pow(10, signal.pipValueDecimals)));

  const expectedProfitTP1 = (tp1Pips * pipDollarValue * 0.1).toFixed(2);
  const expectedProfitTP2 = (tp2Pips * pipDollarValue * 0.1).toFixed(2);
  const expectedLossSL = (slPips * pipDollarValue * 0.1).toFixed(2);

  return (
    <div
      className={`group relative bg-slate-900/90 border transition-all duration-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between shadow-lg hover:shadow-xl ${
        signal.isTopOpportunity
          ? 'border-amber-500/50 hover:border-amber-400 bg-gradient-to-b from-amber-950/20 via-slate-900 to-slate-900 ring-1 ring-amber-500/20'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Top Opportunity Ribbon */}
      {signal.isTopOpportunity && (
        <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-amber-500/20 text-[11px] font-bold text-amber-300">
          <div className="flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span>🔥 فرصة استثمارية قوية عالية الثقة ({signal.confidence}%)</span>
          </div>
          {signal.isLiveFeed && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
              بث حي LIVE
            </span>
          )}
        </div>
      )}

      {/* Top Header Row */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            {/* Symbol Identity */}
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-lg tracking-wide font-mono">
                  {signal.symbol}
                </h3>
                {/* Direction Badge */}
                <div
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold tracking-wider ${
                    isLong
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {isLong ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : (
                    <TrendingDown className="w-3.5 h-3.5" />
                  )}
                  <span>{isLong ? 'شراء' : 'بيع'}</span>
                </div>
              </div>
              <span className="text-xs text-slate-400 font-medium">
                {signal.nameAr} · إطار {signal.timeframe}
              </span>
            </div>
          </div>

          {/* Status Indicator */}
          <div className="flex flex-col items-end">
            {(signal.status === 'won' || signal.status === 'TP1_HIT' || signal.status === 'TP2_HIT') && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 flex items-center gap-1">
                <Check className="w-3 h-3 text-emerald-400" />
                <span>رابحة (حقق الهدف)</span>
              </span>
            )}
            {(signal.status === 'lost' || signal.status === 'SL_HIT') && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold border border-rose-500/30">
                ❌ خاسرة (ضرب الوقف)
              </span>
            )}
            {(signal.status === 'active' || signal.status === 'OPEN') && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 font-medium border border-cyan-500/30 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                نشطة (قيد التداول)
              </span>
            )}
            {(signal.status === 'pending') && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-medium border border-amber-500/30 flex items-center gap-1">
                <span>⏳ قيد الانتظار</span>
              </span>
            )}
            {(signal.status === 'not_triggered' || signal.status === 'EXPIRED') && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-700/50 text-slate-400 font-medium border border-slate-600/40">
                ⏹️ لم تتفعل (ملغاة)
              </span>
            )}
            {signal.status === 'cancelled' && (
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium border border-slate-700">
                🚫 ملغاة
              </span>
            )}

            {/* Pips gained/floating */}
            <div className="flex items-center gap-1 mt-1 font-mono text-xs font-bold">
              <span className="text-slate-400">النقاط:</span>
              <span
                className={
                  isProfit
                    ? 'text-emerald-400'
                    : isLoss
                    ? 'text-rose-400'
                    : 'text-slate-200'
                }
              >
                {isProfit ? `+${signal.pips_gained != null ? signal.pips_gained : signal.resultPips}` : (signal.pips_gained != null ? signal.pips_gained : signal.resultPips)} نقطة
              </span>
            </div>

            {/* Closed Price (if settled) */}
            {signal.closed_price != null && (
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                سعر الإغلاق: {formatPrice(signal.closed_price)}
              </span>
            )}
          </div>
        </div>

        {/* Confidence Meter & Risk/Reward */}
        <div className="flex items-center justify-between gap-3 py-2 px-3 bg-slate-950/60 rounded-lg border border-slate-800/80 mb-3 text-xs">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400">مستوى الثقة:</span>
            <div className="flex items-center gap-1.5 font-mono">
              <span className="font-bold text-amber-400">{signal.confidence}%</span>
              <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 rounded-full"
                  style={{ width: `${signal.confidence}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 font-mono">
            <span className="text-slate-400">R:R:</span>
            <span className="font-bold text-slate-200">{signal.riskRewardRatio}</span>
          </div>
        </div>

        {/* Pricing Matrix (Locked Entry, SL, TP1, TP2) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-xs font-mono">
          {/* Entry (Permanently Locked) */}
          <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
            <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 text-emerald-400">
                <Lock className="w-3 h-3" />
                <span>دخول ثابت</span>
              </span>
              <span className="text-emerald-400 font-bold">Entry</span>
            </div>
            <div className="font-bold text-white text-sm">
              {formatPrice(signal.entry)}
            </div>
          </div>

          {/* Stop Loss (Strict Protection) */}
          <div className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-900/30">
            <div className="text-[11px] text-rose-300 mb-1 flex items-center justify-between">
              <span>وقف الخسارة</span>
              <span className="text-rose-400 font-bold">SL</span>
            </div>
            <div className="font-bold text-rose-200 text-sm">
              {formatPrice(signal.stopLoss)}
            </div>
          </div>

          {/* Take Profit 1 */}
          <div className="p-2.5 rounded-lg bg-sky-950/20 border border-sky-900/30">
            <div className="text-[11px] text-sky-300 mb-1 flex items-center justify-between">
              <span>الهدف الأول</span>
              <span className="text-sky-400 font-bold">TP1</span>
            </div>
            <div className="font-bold text-sky-200 text-sm">
              {formatPrice(signal.takeProfit1)}
            </div>
          </div>

          {/* Take Profit 2 */}
          <div className="p-2.5 rounded-lg bg-blue-950/20 border border-blue-900/30">
            <div className="text-[11px] text-blue-300 mb-1 flex items-center justify-between">
              <span>الهدف الثاني</span>
              <span className="text-blue-400 font-bold">TP2</span>
            </div>
            <div className="font-bold text-blue-200 text-sm">
              {formatPrice(signal.takeProfit2)}
            </div>
          </div>
        </div>

        {/* Live Market Price & Targets Distance Progress */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-950/60 rounded-lg border border-slate-800/60 text-[11px] font-mono text-slate-300 mb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-slate-400">السعر اللحظي الآن:</span>
            <strong className="text-white font-bold">{formatPrice(signal.currentPrice)}</strong>
          </div>

          <div className="flex items-center gap-2 text-[10px]">
            {signal.status === 'OPEN' && (
              <span className="text-slate-400">
                متبقي على الهدف الأول:{' '}
                <strong className="text-sky-400">
                  {Math.abs(Math.round(calculatePips(signal.symbol, signal.takeProfit1, signal.currentPrice)))} نقطة
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Reasoning / Technical Breakdown */}
        <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed mb-3">
          <strong className="text-amber-400/90 font-medium">التحليل: </strong>
          {signal.reasoningAr}
        </p>

        {/* Lot Calculator Toggle Preview */}
        {showCalculator && (
          <div className="p-3 bg-slate-950/90 border border-slate-800 rounded-lg mb-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-300 font-medium flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5 text-amber-400" />
                حاسبة العائد المتوقع وحجم اللوت (Lot Sizing)
              </span>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">اللوت:</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="10"
                  value={lotSize}
                  onChange={(e) => setLotSize(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                  className="w-16 px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-center text-white font-mono text-xs"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center font-mono">
              <div className="p-1.5 bg-rose-950/40 rounded border border-rose-900/30">
                <div className="text-[10px] text-rose-300">المخاطرة عند SL</div>
                <div className="text-rose-400 font-bold">-${expectedLossSL}</div>
              </div>
              <div className="p-1.5 bg-sky-950/40 rounded border border-sky-900/30">
                <div className="text-[10px] text-sky-300">الربح عند TP1</div>
                <div className="text-sky-400 font-bold">+${expectedProfitTP1}</div>
              </div>
              <div className="p-1.5 bg-blue-950/40 rounded border border-blue-900/30">
                <div className="text-[10px] text-blue-300">الربح عند TP2</div>
                <div className="text-blue-400 font-bold">+${expectedProfitTP2}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Card Actions Footer */}
      <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
        <button
          onClick={() => onOpenDetails(signal)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700/80 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          <BarChart2 className="w-3.5 h-3.5 text-amber-400" />
          <span>الشارت والتحليل الفني</span>
        </button>

        <button
          onClick={() => setShowCalculator(!showCalculator)}
          title="حاسبة اللوت"
          className="p-2 bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition-colors border border-slate-700/60"
        >
          <Calculator className="w-4 h-4 text-slate-300" />
        </button>

        <button
          onClick={handleCopy}
          title="نسخ التوصية"
          className="p-2 bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg text-xs transition-colors border border-slate-700/60"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
};
