import React, { useState } from 'react';
import { Signal } from '../types/signals';
import { InteractiveChart } from './InteractiveChart';
import {
  X,
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  Zap,
  Check,
  Copy,
  ExternalLink,
  Info,
  Layers,
  Activity,
  ArrowRight,
  Clock,
} from 'lucide-react';

interface SignalDetailModalProps {
  signal: Signal | null;
  onClose: () => void;
}

export const SignalDetailModal: React.FC<SignalDetailModalProps> = ({
  signal,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!signal) return null;

  const isLong = signal.direction === 'LONG';
  const formatPrice = (val: number) => val.toFixed(signal.pipValueDecimals);

  const formatTimestamp = (ts?: string): string => {
    if (!ts) return '—';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (activatedAt?: string, closedAt?: string): string => {
    if (!activatedAt || !closedAt) return '—';
    const start = new Date(activatedAt).getTime();
    const end = new Date(closedAt).getTime();
    if (isNaN(start) || isNaN(end) || end < start) return '—';
    const diffMinutes = Math.round((end - start) / 60000);
    if (diffMinutes < 60) return `${diffMinutes} دقيقة`;
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return mins > 0 ? `${hours}س ${mins}د` : `${hours} ساعة`;
  };

  const getOutcomeBadge = () => {
    const outcome = signal.outcome;
    const status = (signal.status || 'pending').toLowerCase();

    if (outcome === 'win' || status === 'won' || status === 'tp1_hit' || status === 'tp2_hit' || status === 'closed_in_profit') {
      return {
        label: 'WIN (رابحة)',
        className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
        dot: 'bg-emerald-400',
      };
    }
    if (outcome === 'loss' || status === 'lost' || status === 'sl_hit') {
      return {
        label: 'LOSS (خاسرة)',
        className: 'bg-rose-500/20 text-rose-400 border border-rose-500/40',
        dot: 'bg-rose-400',
      };
    }
    if (outcome === 'not_triggered' || status === 'not_triggered') {
      return {
        label: 'NOT TRIGGERED (لم تتفعل)',
        className: 'bg-slate-800 text-slate-400 border border-slate-700',
        dot: 'bg-slate-400',
      };
    }
    if (status === 'active' || (signal.activated_at && !signal.closed_at)) {
      return {
        label: 'ACTIVE (نشطة قيد التداول)',
        className: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
        dot: 'bg-amber-400 animate-pulse',
      };
    }
    return {
      label: 'PENDING (معلقة)',
      className: 'bg-sky-500/20 text-sky-400 border border-sky-500/40',
      dot: 'bg-sky-400 animate-pulse',
    };
  };

  const outcomeInfo = getOutcomeBadge();
  const durationText = formatDuration(signal.activated_at, signal.closed_at);

  const handleCopy = () => {
    const text = `
🎯 توصية فنية من AlphaFX Signals Engine
الرمز: ${signal.symbol} (${signal.nameAr})
الاتجاه: ${isLong ? '🟢 شراء (LONG)' : '🔴 بيع (SHORT)'}
الدخول: ${formatPrice(signal.entry)}
الهدف الأول (TP1): ${formatPrice(signal.takeProfit1)}
الهدف الثاني (TP2): ${formatPrice(signal.takeProfit2)}
وقف الخسارة (SL): ${formatPrice(signal.stopLoss)}
نسبة العائد للمخاطرة R:R: ${signal.riskRewardRatio}
نسبة الثقة: ${signal.confidence}%
التحليل الفني: ${signal.reasoningAr}
    `.trim();

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl ${
                isLong
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isLong ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white font-mono tracking-wide">
                  {signal.symbol}
                </h2>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                    isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  }`}
                >
                  {isLong ? 'شراء' : 'بيع'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  إطار {signal.timeframe}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1.5 ${outcomeInfo.className}`}>
                  <span className={`w-2 h-2 rounded-full ${outcomeInfo.dot}`} />
                  {outcomeInfo.label}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {signal.nameAr} · نُشرت {formatTimestamp(signal.timestamp || (signal as any).created_at)} ({signal.sessionTarget})
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors border border-slate-700"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'تم النسخ' : 'نسخ النص'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Visual Signal Lifecycle Timeline */}
          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 shadow-inner">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
                <Clock className="w-4 h-4" />
                <span>المسار الزمني لتنفيذ الصفقة (Execution Timeline)</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400">مدة الصفقة:</span>
                <span className="font-mono font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                  {durationText}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Step 1: Created */}
              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    1. تاريخ الإنشاء (Created)
                  </span>
                  <span className="text-[10px] text-blue-400 font-mono">مولّدة آلياً</span>
                </div>
                <div className="font-mono text-xs text-white mb-1">
                  {formatTimestamp(signal.timestamp || (signal as any).created_at)}
                </div>
                <div className="text-[11px] text-slate-400">
                  تم رصد الفرصة واحتساب المؤشرات
                </div>
              </div>

              {/* Step 2: Activated */}
              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${signal.activated_at ? 'bg-amber-400' : 'bg-slate-600'}`} />
                    2. لحظة التفعيل (Activated)
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono">
                    سعر الدخول: {formatPrice(signal.entry)}
                  </span>
                </div>
                <div className="font-mono text-xs text-white mb-1">
                  {formatTimestamp(signal.activated_at)}
                </div>
                <div className="text-[11px] text-slate-400">
                  {signal.activated_at ? `لامس السعر الدخول (${formatPrice(signal.entry)})` : 'في انتظار ملامسة نقطة الدخول'}
                </div>
              </div>

              {/* Step 3: Closed */}
              <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${signal.closed_at ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    3. الإغلاق والتسوية (Closed)
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    {signal.closed_price != null ? `سعر الإغلاق: ${formatPrice(signal.closed_price)}` : 'سعر الإغلاق: —'}
                  </span>
                </div>
                <div className="font-mono text-xs text-white mb-1">
                  {formatTimestamp(signal.closed_at)}
                </div>
                <div className="text-[11px] text-slate-400 flex items-center justify-between">
                  <span>
                    {signal.closed_at ? (signal.pips_gained != null ? `الربح/الخسارة: ${signal.pips_gained > 0 ? '+' : ''}${signal.pips_gained} نقطة` : 'تمت التسوية') : 'الصفقة لا تزال جارية'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Key Parameters Row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-center">
              <span className="text-xs text-slate-400 block mb-1">نقطة الدخول (Entry)</span>
              <span className="font-mono text-base sm:text-lg font-bold text-white">
                {formatPrice(signal.entry)}
              </span>
            </div>

            <div className="p-3 bg-rose-950/20 rounded-xl border border-rose-900/30 text-center">
              <span className="text-xs text-rose-300 block mb-1">وقف الخسارة (SL)</span>
              <span className="font-mono text-base sm:text-lg font-bold text-rose-400">
                {formatPrice(signal.stopLoss)}
              </span>
            </div>

            <div className="p-3 bg-sky-950/20 rounded-xl border border-sky-900/30 text-center">
              <span className="text-xs text-sky-300 block mb-1">الهدف الأول (TP1)</span>
              <span className="font-mono text-base sm:text-lg font-bold text-sky-400">
                {formatPrice(signal.takeProfit1)}
              </span>
            </div>

            <div className="p-3 bg-blue-950/20 rounded-xl border border-blue-900/30 text-center">
              <span className="text-xs text-blue-300 block mb-1">الهدف الثاني (TP2)</span>
              <span className="font-mono text-base sm:text-lg font-bold text-blue-400">
                {formatPrice(signal.takeProfit2)}
              </span>
            </div>

            <div className="col-span-2 sm:col-span-1 p-3 bg-amber-950/20 rounded-xl border border-amber-900/30 text-center">
              <span className="text-xs text-amber-300 block mb-1">مستوى الثقة ومعدل R:R</span>
              <div className="flex items-center justify-center gap-2 font-mono">
                <span className="text-base sm:text-lg font-bold text-amber-400">{signal.confidence}%</span>
                <span className="text-xs text-slate-400">({signal.riskRewardRatio})</span>
              </div>
            </div>
          </div>


          {/* Interactive Chart */}
          <div>
            <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-400" />
              <span>الشارت التفاعلي ومستويات التداول والمؤشرات</span>
            </h3>
            <InteractiveChart signal={signal} height={440} showIndicators={true} />
          </div>

          {/* Analytical Thesis & Reasoning */}
          <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
            <h4 className="text-xs font-bold text-amber-400 tracking-wider flex items-center gap-2">
              <Info className="w-4 h-4" />
              <span>منطق التحليل الفني وتوافق الإشارات (Confluence Reasoning)</span>
            </h4>
            <p className="text-sm text-slate-200 leading-relaxed font-sans">
              {signal.reasoningAr}
            </p>
          </div>

          {/* Multi-indicator Detailed Matrix */}
          <div>
            <h4 className="text-xs font-bold text-slate-400 tracking-wider mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <span>قيم المؤشرات الفنية المحسوبة لحظة صدور التوصية</span>
            </h4>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">مؤشر القوة النسبية RSI(14)</div>
                <div className="text-purple-400 font-bold text-sm">
                  {signal.indicators.rsi} ({signal.indicators.rsi > 50 ? 'زخم شرائي إيجابي' : 'زخم بيعي سلبي'})
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">مؤشر الماكد MACD (12, 26, 9)</div>
                <div className={`font-bold text-sm ${signal.indicators.macd.histogram >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  Histo: {signal.indicators.macd.histogram}
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">متوسط المدى الحقيقي ATR(14)</div>
                <div className="text-amber-400 font-bold text-sm">
                  {signal.indicators.atr} (حساب وقف الخسارة)
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">قوة الاتجاه ADX(14)</div>
                <div className="text-sky-400 font-bold text-sm">
                  {signal.indicators.adx} ({signal.indicators.adx > 25 ? 'اتجاه قوي وصريح' : 'اتجاه ضعيف'})
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">متوسط EMA 20 / EMA 50</div>
                <div className="text-slate-200 font-bold text-sm">
                  {formatPrice(signal.indicators.ema20)} / {formatPrice(signal.indicators.ema50)}
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">متوسط EMA 200 الأساسي</div>
                <div className="text-slate-200 font-bold text-sm">
                  {formatPrice(signal.indicators.ema200)}
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">نطاق بولنجر باند BB (20,2)</div>
                <div className="text-slate-200 font-bold text-sm">
                  {formatPrice(signal.indicators.bollinger.lower)} - {formatPrice(signal.indicators.bollinger.upper)}
                </div>
              </div>

              <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800">
                <div className="text-slate-400 text-[11px] mb-1">نقطة الارتكاز Pivot Point (PP)</div>
                <div className="text-amber-300 font-bold text-sm">
                  {formatPrice(signal.indicators.pivotPoints.pp)}
                </div>
              </div>
            </div>
          </div>

          {/* Engine Methodology Accordion Note */}
          <div className="p-3.5 bg-slate-950/90 rounded-xl border border-slate-800/80 text-xs text-slate-400 space-y-1">
            <strong className="text-slate-300 font-semibold block">
              💡 معادلة محرك التحليل لإدارة المخاطر (ATR Risk-Engine):
            </strong>
            <p>
              يتم احتساب وقف الخسارة تلقائياً بقيمة <strong>1.5 × ATR</strong> من نقطة الدخول لحماية الصفقة من التذبذب العشوائي، بينما يُحدد الهدف الأول بنسبة عائد إلى مخاطرة <strong>1:2</strong> والهدف الثاني بنسبة <strong>1:3</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
