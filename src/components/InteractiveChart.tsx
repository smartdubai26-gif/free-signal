import React, { useState, useMemo } from 'react';
import { Candle, Signal, Timeframe } from '../types/signals';

interface InteractiveChartProps {
  signal: Signal;
  height?: number;
  showIndicators?: boolean;
}

export const InteractiveChart: React.FC<InteractiveChartProps> = ({
  signal,
  height = 420,
  showIndicators = true,
}) => {
  const [selectedTimeframe, setSelectedTimeframe] = useState<Timeframe>(signal.timeframe);
  const [hoveredCandle, setHoveredCandle] = useState<Candle | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [candleCount, setCandleCount] = useState<number>(50);

  const visibleCandles = useMemo(() => {
    return signal.candles.slice(-candleCount);
  }, [signal.candles, candleCount]);

  // Compute price bounds
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    let min = Math.min(
      ...visibleCandles.map((c) => c.low),
      signal.stopLoss,
      signal.entry,
      signal.takeProfit1
    );
    let max = Math.max(
      ...visibleCandles.map((c) => c.high),
      signal.takeProfit2,
      signal.entry
    );

    // Add 5% padding
    const padding = (max - min) * 0.08 || 1;
    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      priceRange: (max + padding) - (min - padding),
    };
  }, [visibleCandles, signal]);

  // Chart layout dimensions
  const chartWidth = 860;
  const mainChartHeight = showIndicators ? height * 0.72 : height;
  const rsiHeight = showIndicators ? height * 0.24 : 0;
  const paddingRight = 85;
  const paddingLeft = 15;
  const paddingTop = 20;
  const paddingBottom = 20;
  const usableWidth = chartWidth - paddingRight - paddingLeft;
  const usableHeight = mainChartHeight - paddingTop - paddingBottom;

  const candleSpacing = usableWidth / visibleCandles.length;
  const candleWidth = Math.max(candleSpacing * 0.65, 4);

  // Price to Y coordinate conversion
  const priceToY = (price: number): number => {
    return paddingTop + (1 - (price - minPrice) / priceRange) * usableHeight;
  };

  // RSI to Y coordinate
  const rsiToY = (val: number): number => {
    const rsiTop = mainChartHeight + 10;
    const rsiUsable = rsiHeight - 15;
    return rsiTop + (1 - val / 100) * rsiUsable;
  };

  // Generate EMA paths
  const ema20Path = useMemo(() => {
    return visibleCandles
      .map((c, i) => {
        if (!c.ema20) return '';
        const x = paddingLeft + i * candleSpacing + candleSpacing / 2;
        const y = priceToY(c.ema20);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [visibleCandles, minPrice, priceRange, usableHeight]);

  const ema50Path = useMemo(() => {
    return visibleCandles
      .map((c, i) => {
        if (!c.ema50) return '';
        const x = paddingLeft + i * candleSpacing + candleSpacing / 2;
        const y = priceToY(c.ema50);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [visibleCandles, minPrice, priceRange, usableHeight]);

  // Generate RSI path
  const rsiPath = useMemo(() => {
    return visibleCandles
      .map((c, i) => {
        const val = c.rsi ?? 50;
        const x = paddingLeft + i * candleSpacing + candleSpacing / 2;
        const y = rsiToY(val);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }, [visibleCandles, mainChartHeight, rsiHeight]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * chartWidth;
    const y = ((e.clientY - rect.top) / rect.height) * height;

    setMousePos({ x, y });

    const index = Math.floor((x - paddingLeft) / candleSpacing);
    if (index >= 0 && index < visibleCandles.length) {
      setHoveredCandle(visibleCandles[index]);
    } else {
      setHoveredCandle(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredCandle(null);
    setMousePos(null);
  };

  // Price grid horizontal steps (5 steps)
  const priceGridLevels = useMemo(() => {
    const count = 5;
    const levels = [];
    for (let i = 0; i <= count; i++) {
      const p = minPrice + (priceRange / count) * i;
      levels.push(p);
    }
    return levels;
  }, [minPrice, priceRange]);

  const latestCandle = visibleCandles[visibleCandles.length - 1] || hoveredCandle;
  const inspectCandle = hoveredCandle || latestCandle;

  return (
    <div className="w-full bg-slate-950/80 rounded-xl border border-slate-800 p-3 sm:p-4 text-slate-200 select-none backdrop-blur-sm">
      {/* Chart Top Bar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 text-xs">
        {/* Symbol & Timeframe */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white text-base tracking-wide font-mono">
              {signal.symbol}
            </span>
            <span className="text-slate-400 font-medium">({signal.nameAr})</span>
          </div>
          {/* Timeframe selector buttons */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            {(['M15', 'H1', 'H4', 'D1'] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                onClick={() => setSelectedTimeframe(tf)}
                className={`px-2 py-0.5 rounded text-xs font-semibold transition-colors ${
                  selectedTimeframe === tf
                    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        {/* Legend / Key levels */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <span className="w-2.5 h-0.5 bg-emerald-400 rounded-full inline-block"></span>
            <span>دخول: {signal.entry.toFixed(signal.pipValueDecimals)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sky-400">
            <span className="w-2.5 h-0.5 bg-sky-400 rounded-full inline-block"></span>
            <span>هدف 1: {signal.takeProfit1.toFixed(signal.pipValueDecimals)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-blue-400">
            <span className="w-2.5 h-0.5 bg-blue-400 rounded-full inline-block"></span>
            <span>هدف 2: {signal.takeProfit2.toFixed(signal.pipValueDecimals)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-rose-400">
            <span className="w-2.5 h-0.5 bg-rose-400 rounded-full inline-block"></span>
            <span>وقف خسارة: {signal.stopLoss.toFixed(signal.pipValueDecimals)}</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-amber-300">
            <span className="w-2 h-0.5 bg-amber-400 inline-block"></span>
            <span>EMA 20</span>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-indigo-300">
            <span className="w-2 h-0.5 bg-indigo-400 inline-block"></span>
            <span>EMA 50</span>
          </div>
        </div>

        {/* Zoom candles count */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[11px]">
          <span className="text-slate-400 px-1">الشموع:</span>
          {[30, 50, 80].map((cnt) => (
            <button
              key={cnt}
              onClick={() => setCandleCount(cnt)}
              className={`px-1.5 py-0.5 rounded ${
                candleCount === cnt ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {cnt}
            </button>
          ))}
        </div>
      </div>

      {/* OHLC Bar Inspector Tooltip */}
      {inspectCandle && (
        <div className="flex flex-wrap items-center justify-between gap-3 py-1.5 px-2 bg-slate-900/60 border-b border-slate-800/50 text-[11px] font-mono text-slate-300">
          <div className="flex items-center gap-3">
            <span className="text-slate-400">{inspectCandle.time}</span>
            <span>
              O: <strong className="text-white">{inspectCandle.open.toFixed(signal.pipValueDecimals)}</strong>
            </span>
            <span>
              H: <strong className="text-emerald-400">{inspectCandle.high.toFixed(signal.pipValueDecimals)}</strong>
            </span>
            <span>
              L: <strong className="text-rose-400">{inspectCandle.low.toFixed(signal.pipValueDecimals)}</strong>
            </span>
            <span>
              C: <strong className={inspectCandle.close >= inspectCandle.open ? 'text-emerald-400' : 'text-rose-400'}>
                {inspectCandle.close.toFixed(signal.pipValueDecimals)}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {inspectCandle.rsi && (
              <span className="text-purple-300">
                RSI (14): <strong>{inspectCandle.rsi}</strong>
              </span>
            )}
            <span className="text-slate-400">
              الحجم: <strong>{inspectCandle.volume.toLocaleString()}</strong>
            </span>
          </div>
        </div>
      )}

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden mt-1">
        <svg
          viewBox={`0 0 ${chartWidth} ${height}`}
          className="w-full h-auto cursor-crosshair block"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Background grid */}
          <rect x={0} y={0} width={chartWidth} height={height} fill="#060911" />

          {/* Horizontal Price Grid Lines */}
          {priceGridLevels.map((p, idx) => {
            const y = priceToY(p);
            return (
              <g key={idx}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="#1e293b"
                  strokeWidth={0.8}
                  strokeDasharray="3 3"
                />
                <text
                  x={chartWidth - paddingRight + 6}
                  y={y + 3.5}
                  fill="#64748b"
                  fontSize={10}
                  fontFamily="monospace"
                >
                  {p.toFixed(signal.pipValueDecimals)}
                </text>
              </g>
            );
          })}

          {/* Signal Level: STOP LOSS (Red) */}
          {signal.stopLoss >= minPrice && signal.stopLoss <= maxPrice && (
            <g>
              <line
                x1={paddingLeft}
                y1={priceToY(signal.stopLoss)}
                x2={chartWidth - paddingRight}
                y2={priceToY(signal.stopLoss)}
                stroke="#ef4444"
                strokeWidth={1.5}
                strokeDasharray="4 2"
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={priceToY(signal.stopLoss) - 8}
                width={78}
                height={16}
                rx={3}
                fill="#dc2626"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={priceToY(signal.stopLoss) + 3.5}
                fill="#ffffff"
                fontSize={9}
                fontWeight="bold"
                fontFamily="monospace"
              >
                SL: {signal.stopLoss.toFixed(signal.pipValueDecimals)}
              </text>
            </g>
          )}

          {/* Signal Level: ENTRY (Green) */}
          {signal.entry >= minPrice && signal.entry <= maxPrice && (
            <g>
              <line
                x1={paddingLeft}
                y1={priceToY(signal.entry)}
                x2={chartWidth - paddingRight}
                y2={priceToY(signal.entry)}
                stroke="#10b981"
                strokeWidth={1.5}
                strokeDasharray="6 3"
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={priceToY(signal.entry) - 8}
                width={78}
                height={16}
                rx={3}
                fill="#059669"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={priceToY(signal.entry) + 3.5}
                fill="#ffffff"
                fontSize={9}
                fontWeight="bold"
                fontFamily="monospace"
              >
                Entry: {signal.entry.toFixed(signal.pipValueDecimals)}
              </text>
            </g>
          )}

          {/* Signal Level: TAKE PROFIT 1 (Sky Blue) */}
          {signal.takeProfit1 >= minPrice && signal.takeProfit1 <= maxPrice && (
            <g>
              <line
                x1={paddingLeft}
                y1={priceToY(signal.takeProfit1)}
                x2={chartWidth - paddingRight}
                y2={priceToY(signal.takeProfit1)}
                stroke="#0ea5e9"
                strokeWidth={1.5}
                strokeDasharray="4 2"
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={priceToY(signal.takeProfit1) - 8}
                width={78}
                height={16}
                rx={3}
                fill="#0284c7"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={priceToY(signal.takeProfit1) + 3.5}
                fill="#ffffff"
                fontSize={9}
                fontWeight="bold"
                fontFamily="monospace"
              >
                TP1: {signal.takeProfit1.toFixed(signal.pipValueDecimals)}
              </text>
            </g>
          )}

          {/* Signal Level: TAKE PROFIT 2 (Royal Blue) */}
          {signal.takeProfit2 >= minPrice && signal.takeProfit2 <= maxPrice && (
            <g>
              <line
                x1={paddingLeft}
                y1={priceToY(signal.takeProfit2)}
                x2={chartWidth - paddingRight}
                y2={priceToY(signal.takeProfit2)}
                stroke="#3b82f6"
                strokeWidth={1.8}
              />
              <rect
                x={chartWidth - paddingRight + 2}
                y={priceToY(signal.takeProfit2) - 8}
                width={78}
                height={16}
                rx={3}
                fill="#2563eb"
              />
              <text
                x={chartWidth - paddingRight + 6}
                y={priceToY(signal.takeProfit2) + 3.5}
                fill="#ffffff"
                fontSize={9}
                fontWeight="bold"
                fontFamily="monospace"
              >
                TP2: {signal.takeProfit2.toFixed(signal.pipValueDecimals)}
              </text>
            </g>
          )}

          {/* EMA Curves */}
          <path d={ema50Path} fill="none" stroke="#6366f1" strokeWidth={1.2} opacity={0.7} />
          <path d={ema20Path} fill="none" stroke="#f59e0b" strokeWidth={1.4} opacity={0.9} />

          {/* Candlesticks */}
          {visibleCandles.map((c, i) => {
            const x = paddingLeft + i * candleSpacing + candleSpacing / 2;
            const isBull = c.close >= c.open;
            const candleColor = isBull ? '#10b981' : '#ef4444';
            const yHigh = priceToY(c.high);
            const yLow = priceToY(c.low);
            const yOpen = priceToY(c.open);
            const yClose = priceToY(c.close);
            const bodyY = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(Math.abs(yClose - yOpen), 1.5);

            return (
              <g key={i} className="transition-opacity">
                {/* Wick */}
                <line
                  x1={x}
                  y1={yHigh}
                  x2={x}
                  y2={yLow}
                  stroke={candleColor}
                  strokeWidth={1.2}
                />
                {/* Body */}
                <rect
                  x={x - candleWidth / 2}
                  y={bodyY}
                  width={candleWidth}
                  height={bodyHeight}
                  fill={isBull ? '#10b981' : '#ef4444'}
                  stroke={candleColor}
                  strokeWidth={0.5}
                  rx={1}
                />
              </g>
            );
          })}

          {/* Current Live Price Marker */}
          {signal.currentPrice && (
            <g>
              <line
                x1={paddingLeft}
                y1={priceToY(signal.currentPrice)}
                x2={chartWidth - paddingRight}
                y2={priceToY(signal.currentPrice)}
                stroke="#e2e8f0"
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.8}
              />
              <circle
                cx={chartWidth - paddingRight}
                cy={priceToY(signal.currentPrice)}
                r={3}
                fill="#f8fafc"
              />
            </g>
          )}

          {/* RSI Sub-Chart Panel */}
          {showIndicators && (
            <g>
              {/* Divider */}
              <line
                x1={0}
                y1={mainChartHeight}
                x2={chartWidth}
                y2={mainChartHeight}
                stroke="#334155"
                strokeWidth={1}
              />
              {/* RSI background */}
              <rect
                x={0}
                y={mainChartHeight}
                width={chartWidth}
                height={rsiHeight + 10}
                fill="#050810"
              />
              {/* RSI Level 70 */}
              <line
                x1={paddingLeft}
                y1={rsiToY(70)}
                x2={chartWidth - paddingRight}
                y2={rsiToY(70)}
                stroke="#ef4444"
                strokeWidth={0.8}
                strokeDasharray="2 2"
                opacity={0.6}
              />
              <text x={chartWidth - paddingRight + 5} y={rsiToY(70) + 3} fill="#ef4444" fontSize={9} fontFamily="monospace">
                70
              </text>
              {/* RSI Level 50 */}
              <line
                x1={paddingLeft}
                y1={rsiToY(50)}
                x2={chartWidth - paddingRight}
                y2={rsiToY(50)}
                stroke="#64748b"
                strokeWidth={0.6}
                strokeDasharray="3 3"
              />
              <text x={chartWidth - paddingRight + 5} y={rsiToY(50) + 3} fill="#64748b" fontSize={9} fontFamily="monospace">
                50
              </text>
              {/* RSI Level 30 */}
              <line
                x1={paddingLeft}
                y1={rsiToY(30)}
                x2={chartWidth - paddingRight}
                y2={rsiToY(30)}
                stroke="#10b981"
                strokeWidth={0.8}
                strokeDasharray="2 2"
                opacity={0.6}
              />
              <text x={chartWidth - paddingRight + 5} y={rsiToY(30) + 3} fill="#10b981" fontSize={9} fontFamily="monospace">
                30
              </text>

              {/* RSI Curve */}
              <path d={rsiPath} fill="none" stroke="#a855f7" strokeWidth={1.6} />

              {/* Label */}
              <text x={paddingLeft} y={mainChartHeight + 16} fill="#a855f7" fontSize={10} fontWeight="bold" fontFamily="monospace">
                RSI (14): {signal.indicators.rsi}
              </text>
            </g>
          )}

          {/* Mouse Crosshair */}
          {mousePos && (
            <g pointerEvents="none">
              {/* Vertical line */}
              <line
                x1={mousePos.x}
                y1={paddingTop}
                x2={mousePos.x}
                y2={height - 10}
                stroke="#94a3b8"
                strokeWidth={0.8}
                strokeDasharray="3 3"
                opacity={0.6}
              />
              {/* Horizontal line in main area */}
              {mousePos.y <= mainChartHeight && (
                <line
                  x1={paddingLeft}
                  y1={mousePos.y}
                  x2={chartWidth - paddingRight}
                  y2={mousePos.y}
                  stroke="#94a3b8"
                  strokeWidth={0.8}
                  strokeDasharray="3 3"
                  opacity={0.6}
                />
              )}
            </g>
          )}
        </svg>
      </div>

      {/* Chart Footer Indicator Status */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-900 text-[11px] text-slate-400 font-mono">
        <div className="flex items-center gap-3">
          <span>ATR (14): <strong className="text-white">{signal.indicators.atr}</strong></span>
          <span>ADX: <strong className="text-white">{signal.indicators.adx}</strong></span>
          <span>MACD: <strong className={signal.indicators.macd.histogram >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{signal.indicators.macd.histogram}</strong></span>
        </div>
        <div className="flex items-center gap-2">
          <span>معدل العائد إلى المخاطرة R:R: <strong className="text-amber-400">{signal.riskRewardRatio}</strong></span>
        </div>
      </div>
    </div>
  );
};
