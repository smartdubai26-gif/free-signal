import React, { useState } from 'react';
import { useResponsiveTable } from '../hooks/useResponsiveTable';
import { Signal, Timeframe } from '../types/signals';
import {
  Search,
  Filter,
  Download,
  Calendar,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
} from 'lucide-react';

interface ArchiveViewProps {
  signals: Signal[];
  onOpenDetails: (signal: Signal) => void;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  signals,
  onOpenDetails,
}) => {
  const t1Ref = useResponsiveTable<HTMLTableElement>();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAsset, setSelectedAsset] = useState('all');
  const [selectedDirection, setSelectedDirection] = useState('all');
  const [selectedOutcome, setSelectedOutcome] = useState('all');

  const filteredSignals = signals.filter((sig) => {
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchSymbol = sig.symbol.toLowerCase().includes(q);
      const matchName = sig.nameAr.toLowerCase().includes(q) || sig.nameEn.toLowerCase().includes(q);
      if (!matchSymbol && !matchName) return false;
    }

    // Asset class
    if (selectedAsset !== 'all' && sig.assetClass !== selectedAsset) return false;

    // Direction
    if (selectedDirection !== 'all' && sig.direction !== selectedDirection) return false;

    // Outcome
    if (selectedOutcome === 'tp' && !sig.status.startsWith('TP')) return false;
    if (selectedOutcome === 'sl' && sig.status !== 'SL_HIT') return false;

    return true;
  });

  // Export to CSV function
  const handleExportCSV = () => {
    const headers = ['Symbol', 'Asset', 'Direction', 'Entry', 'SL', 'TP1', 'TP2', 'Confidence', 'Status', 'Pips', 'Date'];
    const rows = filteredSignals.map((s) => [
      s.symbol,
      s.assetClass,
      s.direction,
      s.entry,
      s.stopLoss,
      s.takeProfit1,
      s.takeProfit2,
      `${s.confidence}%`,
      s.status,
      s.resultPips,
      s.timestamp,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `AlphaFX_Signals_Archive_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Top Search & Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="ابحث بالرمز أو الاسم (مثلاً XAU, EUR, Oil)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl pr-9 pl-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          {/* Export CSV Button */}
          <button
            onClick={handleExportCSV}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-colors border border-slate-700"
          >
            <Download className="w-3.5 h-3.5 text-amber-400" />
            <span>تصدير السجل بتنسيق CSV</span>
          </button>
        </div>

        {/* Filter Badges */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-800/80 text-xs">
          {/* Asset filter */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px] px-2">الفئة:</span>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'metals', label: 'المعادن' },
              { id: 'energy', label: 'النفط' },
              { id: 'forex-major', label: 'العملات' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedAsset(f.id)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  selectedAsset === f.id ? 'bg-slate-850 bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Direction filter */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px] px-2">الاتجاه:</span>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'LONG', label: 'شراء' },
              { id: 'SHORT', label: 'بيع' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDirection(d.id)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  selectedDirection === d.id ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          {/* Outcome filter */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <span className="text-slate-400 text-[11px] px-2">النتيجة:</span>
            {[
              { id: 'all', label: 'الكل' },
              { id: 'tp', label: 'رابحة TP' },
              { id: 'sl', label: 'خاسرة SL' },
            ].map((o) => (
              <button
                key={o.id}
                onClick={() => setSelectedOutcome(o.id)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  selectedOutcome === o.id ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Archive Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table ref={t1Ref} className="rtable w-full text-xs text-right">
            <thead>
              <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400">
                <th className="py-3.5 px-4 font-semibold">التاريخ</th>
                <th className="py-3.5 px-3 font-semibold">الأصل المالي</th>
                <th className="py-3.5 px-3 font-semibold text-center">الاتجاه</th>
                <th className="py-3.5 px-3 font-semibold">سعر الدخول</th>
                <th className="py-3.5 px-3 font-semibold">وقف الخسارة</th>
                <th className="py-3.5 px-3 font-semibold">الأهداف (TP1 / TP2)</th>
                <th className="py-3.5 px-3 font-semibold text-center">الثقة</th>
                <th className="py-3.5 px-3 font-semibold text-center">الحالة</th>
                <th className="py-3.5 px-3 font-semibold text-left">النقاط</th>
                <th className="py-3.5 px-4 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredSignals.map((sig) => {
                const isLong = sig.direction === 'LONG';
                const isTP = sig.status.startsWith('TP');
                const isSL = sig.status === 'SL_HIT';

                return (
                  <tr key={sig.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 text-slate-400 font-sans whitespace-nowrap">
                      {new Date(sig.timestamp).toLocaleDateString('ar-EG', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>

                    <td className="py-3.5 px-3 font-sans">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white font-mono text-sm">{sig.symbol}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}>
                        {isLong ? 'شراء' : 'بيع'}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-white font-semibold">
                      {sig.entry.toFixed(sig.pipValueDecimals)}
                    </td>

                    <td className="py-3.5 px-3 text-rose-400">
                      {sig.stopLoss.toFixed(sig.pipValueDecimals)}
                    </td>

                    <td className="py-3.5 px-3 text-sky-400">
                      {sig.takeProfit1.toFixed(sig.pipValueDecimals)} / {sig.takeProfit2.toFixed(sig.pipValueDecimals)}
                    </td>

                    <td className="py-3.5 px-3 text-center text-amber-400 font-bold">
                      {sig.confidence}%
                    </td>

                    <td className="py-3.5 px-3 text-center font-sans">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                        isTP ? 'bg-emerald-500/15 text-emerald-300' : isSL ? 'bg-rose-500/15 text-rose-300' : 'bg-sky-500/15 text-sky-300'
                      }`}>
                        {isTP ? 'هدف محقق' : isSL ? 'وقف خسارة' : 'قيد التداول'}
                      </span>
                    </td>

                    <td className="py-3.5 px-3 text-left font-bold">
                      <span className={sig.resultPips > 0 ? 'text-emerald-400' : sig.resultPips < 0 ? 'text-rose-400' : 'text-slate-300'}>
                        {sig.resultPips > 0 ? `+${sig.resultPips}` : sig.resultPips}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-center font-sans">
                      <button
                        onClick={() => onOpenDetails(sig)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded text-xs font-semibold transition-colors border border-slate-700"
                      >
                        الشارت
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredSignals.length === 0 && (
          <div className="p-8 text-center text-slate-400 text-xs font-sans">
            لم يتم العثور على أي نتائج تطابق البحث والفلاتر.
          </div>
        )}
      </div>
    </div>
  );
};
