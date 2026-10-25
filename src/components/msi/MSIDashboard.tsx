/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { ALL_INSTRUMENTS } from '../../services/mockData';
import { DataProvenance, MSITimeframe, MSIDirection, MSIOpportunity } from '../../types/msi';
import {
  Cpu,
  Shield,
  Layers,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Zap,
  BarChart2,
  Lock,
  Coins,
  Radio,
  FileText,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface PaperOpportunityRecord {
  id: string;
  utcTimestamp: string;
  timestampMs: number;
  symbol: string;
  timeframe: string;
  marketPrice: number;
  mode: 'PAPER_MODE';
  brokerOrdersSent: 0;
  decision: 'BLOCKED' | 'CANDIDATE' | 'CONFIRMED';
  decisionReason: string;
  confluenceScore: number;
  evidenceCoverageRatio: number;
  normalizedAvailableScore?: number;
  engineResults: {
    priceAction: { status: string; hasData: boolean };
    volumeProfile: { status: string; hasData: boolean };
    anchoredVWAP: { status: string; hasData: boolean };
    orderFlow: { status: string; hasData: boolean };
  };
  provenance: DataProvenance;
  componentEvidence: {
    supporting: string[];
    conflicting: string[];
  };
  hypotheticalTrade: {
    direction: 'LONG' | 'SHORT' | 'NEUTRAL';
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit1: number | null;
    takeProfit2: number | null;
    spreadPips: number;
    estimatedCostUsd: number;
    // New lifecycle fields
    status: 'WAITING_FOR_ENTRY' | 'ACTIVE' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'CANCELLED' | 'STALE' | 'UNKNOWN';
    lastUpdatePrice: number | null;
    lastUpdateTimestamp: number | null;
    realizedPips: number | null;
  } | null;
}

export const MSIDashboard: React.FC = () => {
  const [selectedSymbol, setSelectedSymbol] = useState<string>('EUR/USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<MSITimeframe>('M15');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisResult, setAnalysisResult] = useState<PaperOpportunityRecord | null>(null);
  const [paperJournal, setPaperJournal] = useState<PaperOpportunityRecord[]>([]);
  const [isLoadingJournal, setIsLoadingJournal] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [lastTick, setLastTick] = useState<Record<string, { price: number; timestamp: number; receiptTime: number }>>({});
  const [wsStatus, setWsStatus] = useState<'CONNECTED' | 'DISCONNECTED' | 'ERROR'>('DISCONNECTED');

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'status') {
        setWsStatus(data.state === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED');
      } else if (data.type === 'trade_update') {
        const updatedOpp = data.opportunity;
        setPaperJournal(prev => prev.map(o => o.id === updatedOpp.id ? updatedOpp : o));
        setAnalysisResult(prev => (prev && prev.id === updatedOpp.id) ? updatedOpp : prev);
      } else if (data.event === 'price') {
        setLastTick(prev => ({
            ...prev,
            [data.symbol]: {
                price: data.price,
                timestamp: data.timestamp, // provider timestamp
                receiptTime: Date.now()
            }
        }));
      }
    };
    
    ws.onopen = () => setWsStatus('CONNECTED');
    ws.onclose = () => setWsStatus('DISCONNECTED');
    ws.onerror = () => setWsStatus('ERROR');
    
    return () => ws.close();
  }, []);

  // Fetch paper trading opportunities journal
  const fetchPaperOpportunities = async () => {
    setIsLoadingJournal(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/msi/paper/opportunities`);
      if (res.ok) {
        const data = await res.json();
        const opps = data.opportunities || [];
        setPaperJournal(opps);
        if (opps.length > 0) {
          const match = opps.find((p: PaperOpportunityRecord) => p.symbol === selectedSymbol && p.timeframe === selectedTimeframe);
          setAnalysisResult(match || null);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch paper opportunities journal:', err);
    } finally {
      setIsLoadingJournal(false);
    }
  };

  useEffect(() => {
    fetchPaperOpportunities();
  }, []);

  const handleRunMSIAnalysis = async () => {
    setIsAnalyzing(true);
    setErrorMsg(null);
    try {
      const baseUrl = typeof window !== 'undefined' ? '' : 'http://localhost:3000';
      const res = await fetch(`${baseUrl}/api/msi/paper/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, timeframe: selectedTimeframe }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || `HTTP ${res.status}`);
      }

      const opp: PaperOpportunityRecord = await res.json();
      setAnalysisResult(opp);
      setPaperJournal((prev) => [opp, ...prev.filter((p) => p.id !== opp.id)]);
    } catch (error: any) {
      console.error('Failed to run MSI analysis:', error);
      setErrorMsg(error.message || 'فشل في تقييم الفرصة في السوق الحية');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in font-sans">
      {/* Supervised Paper Mode Governance Notice */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5 sm:mt-0">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2" dir="ltr">
              <span className="text-[10px] sm:text-xs px-2 py-0.5 rounded font-bold font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 whitespace-nowrap">
                SUPERVISED PAPER MODE
              </span>
              <span className="text-[11px] text-slate-400 font-sans" dir="rtl">جلسة تداول تجريبي حي ومُراقب</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              الأوامر الحقيقية معطلة تماماً (Zero Broker Orders Transmitted). تقييم فني مباشر من بث Twelve Data المباشر.
            </p>
            {/* Live Feed Transparency */}
            <div className="mt-2 text-[10px] font-mono border-t border-emerald-500/20 pt-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${wsStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-rose-400'} animate-pulse`} />
                <span className="text-slate-300">حالة البث: {wsStatus}</span>
              </div>
              {lastTick[selectedSymbol] && (
                <div className="mt-1 text-slate-400">
                  <span>آخر تحديث ({selectedSymbol}): </span>
                  <span className="text-white">{new Date(lastTick[selectedSymbol].timestamp).toLocaleTimeString()}</span>
                  <span className="mx-2">|</span>
                  <span>العمر: </span>
                  <span className="text-white">{Math.floor((Date.now() - lastTick[selectedSymbol].receiptTime) / 1000)}s</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono shrink-0 w-full sm:w-auto justify-between sm:justify-start pt-2 sm:pt-0 border-t sm:border-t-0 border-emerald-500/20">
          <span className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 whitespace-nowrap">
            الفرص المسجلة: <strong className="text-white">{paperJournal.length}</strong>
          </span>
          <button
            onClick={fetchPaperOpportunities}
            disabled={isLoadingJournal}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition-colors cursor-pointer shrink-0"
            title="تحديث السجل"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingJournal ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* MSI Header Banner */}
      <div className="p-4 sm:p-6 rounded-2xl bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-950 border border-amber-500/30 shadow-2xl flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div>
          <div className="flex items-start sm:items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-inner shrink-0">
              <Cpu className="w-5 h-5 animate-pulse" />
            </div>
            <div className="space-y-0.5">
              <h2 className="text-base sm:text-xl md:text-2xl font-bold text-white tracking-tight sm:tracking-wide font-mono" dir="ltr">
                MSI — Market Structure Intelligence
              </h2>
              <p className="text-[11px] sm:text-xs text-amber-300/80 leading-normal">
                منصة التحليل الكمي المتقدمة (Volume Profile + Price Action + Anchored VWAP + Order Flow)
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            محرك ذكي يدمج 4 محركات تحليلية مستقلة بنظام ترجيح وتغطية صارم، مع حماية تامة ضد تضخم النقاط وضمان استقلالية البيانات الحية.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full lg:w-auto shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-amber-500/20">
          <select
            value={selectedSymbol}
            onChange={(e) => {
              const sym = e.target.value;
              setSelectedSymbol(sym);
              const match = paperJournal.find((p) => p.symbol === sym && p.timeframe === selectedTimeframe);
              setAnalysisResult(match || null);
            }}
            className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 font-mono w-full sm:w-auto"
            dir="ltr"
          >
            {ALL_INSTRUMENTS.map((i) => (
              <option key={i.symbol} value={i.symbol}>
                {i.symbol} ({i.nameAr})
              </option>
            ))}
          </select>

          <select
            value={selectedTimeframe}
            onChange={(e) => {
              const tf = e.target.value as MSITimeframe;
              setSelectedTimeframe(tf);
              const match = paperJournal.find((p) => p.symbol === selectedSymbol && p.timeframe === tf);
              setAnalysisResult(match || null);
            }}
            className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 font-mono w-full sm:w-auto"
            dir="ltr"
          >
            <option value="M1">M1 (1 دقيقة)</option>
            <option value="M5">M5 (5 دقائق)</option>
            <option value="M15">M15 (15 دقيقة)</option>
            <option value="M30">M30 (30 دقيقة)</option>
            <option value="H1">H1 (ساعة)</option>
            <option value="H4">H4 (4 ساعات)</option>
            <option value="D1">D1 (يومي)</option>
          </select>

          <button
            onClick={handleRunMSIAnalysis}
            disabled={isAnalyzing}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 rounded-xl text-xs font-bold shadow-lg active:scale-95 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap w-full sm:w-auto"
          >
            <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
            <span>{isAnalyzing ? 'جاري التقييم الحي...' : '⚡ تقييم الفرصة الحية'}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Analysis Results View */}
      {analysisResult && (
        <div className="space-y-6">
          {/* Confluence Score & Eligibility Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-6 pb-5 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 font-mono border border-amber-500/30">
                    نتيجة التوافق الكمي (Quantitative Confluence)
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                    analysisResult.decision === 'CONFIRMED'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : analysisResult.decision === 'CANDIDATE'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}>
                    {analysisResult.decision}
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-white mt-2 font-mono flex items-center gap-3">
                  <span>{analysisResult.symbol}</span>
                  <span className="text-sm px-3 py-1 rounded bg-slate-950 border border-slate-700 text-slate-300">
                    إطار {analysisResult.timeframe}
                  </span>
                  <span className="text-sm font-normal text-amber-400">
                    السعر الحي: {analysisResult.marketPrice}
                  </span>
                </h3>
              </div>

              {/* Provenance Info */}
              <div className="text-[10px] text-slate-400 font-mono">
                المزود: {analysisResult.provenance?.providerId || 'TWELVEDATA_PAPER'} | 
                النمط: {analysisResult.mode} | 
                الوقت UTC: {new Date(analysisResult.timestampMs).toISOString()}
              </div>

              {/* Eligibility & Scores */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-center font-mono">
                  <div className="text-[10px] text-slate-400 mb-1">النقاط المرجحة</div>
                  <div className="text-xl font-bold text-white">
                    {analysisResult.confluenceScore.toFixed(1)} / 100
                  </div>
                </div>

                <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-center font-mono">
                  <div className="text-[10px] text-slate-400 mb-1">نسبة التغطية</div>
                  <div className="text-xl font-bold text-sky-400">
                    {(analysisResult.evidenceCoverageRatio * 100).toFixed(0)}%
                  </div>
                </div>

                <div className={`p-3.5 rounded-xl border text-center font-mono ${
                  analysisResult.decision === 'CONFIRMED'
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                    : analysisResult.decision === 'CANDIDATE'
                    ? 'bg-amber-950/40 border-amber-800/60 text-amber-300'
                    : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
                }`}>
                  <div className="text-[10px] opacity-75 mb-1">قرار التحقق (Decision)</div>
                  <div className="text-sm font-bold flex items-center gap-1 justify-center">
                    {analysisResult.decision === 'CONFIRMED' ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span>مؤكد (CONFIRMED)</span>
                      </>
                    ) : analysisResult.decision === 'CANDIDATE' ? (
                      <>
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span>مرشح (CANDIDATE)</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-rose-400" />
                        <span>محظور (BLOCKED)</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Eligibility Reason & Governance Note */}
            <div className="mt-4 p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs flex items-center gap-3">
              <Shield className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <strong className="text-white">السبب الصريح للقرار: </strong>
                <span className="text-slate-300 font-mono">{analysisResult.decisionReason}</span>
              </div>
            </div>

            {/* Hypothetical Strategy Parameters (PAPER ONLY) */}
            {analysisResult.hypotheticalTrade && (
              <div className={`mt-4 p-4 rounded-xl border ${
                analysisResult.decision === 'BLOCKED'
                  ? 'bg-rose-950/20 border-rose-900/60'
                  : 'bg-slate-950 border-slate-800/80'
              }`}>
                {analysisResult.decision === 'BLOCKED' && (
                  <div className="mb-3 p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 text-xs flex items-start gap-2.5 font-sans">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <strong className="font-bold block">تنبيه حماية - صفقة محظورة (BLOCKED SETUP - NOT ACTIONABLE):</strong>
                      <span className="text-slate-300 text-[11px] leading-relaxed">
                        القرار النهائي محظور (BLOCKED). مستويات الدخول، وقف الخسارة، والأهداف الموضحة أدناه هي <strong>نقاط افتراضية استرشادية بحتة وليست توصية معتمدة</strong> وليست قابلة للتنفيذ. لا يوجد أي أمر حقيقي أو معتمد.
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
                  <span className="text-xs font-bold text-amber-300 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    <span>
                      {analysisResult.decision === 'BLOCKED'
                        ? 'المعطيات الافتراضية الاسترشادية (غير معتمدة / غير قابلة للتنفيذ)'
                        : 'المعطيات الافتراضية المستخلصة (Hypothetical Paper Setup - No Orders Executed)'}
                    </span>
                  </span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    الاتجاه: {analysisResult.hypotheticalTrade.direction}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs font-mono">
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">سعر الدخول (افتراضي)</span>
                    <strong className="text-white">{analysisResult.hypotheticalTrade.entryPrice}</strong>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-rose-400 block">وقف الخسارة (SL)</span>
                    <strong className="text-rose-300">{analysisResult.hypotheticalTrade.stopLoss}</strong>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-emerald-400 block">الهدف 1 (TP1)</span>
                    <strong className="text-emerald-300">{analysisResult.hypotheticalTrade.takeProfit1}</strong>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-emerald-400 block">الهدف 2 (TP2)</span>
                    <strong className="text-emerald-300">{analysisResult.hypotheticalTrade.takeProfit2}</strong>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">السبريد التقديري</span>
                    <strong className="text-slate-300">{analysisResult.hypotheticalTrade.spreadPips} pips</strong>
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-400 block">تكلفة الصفقة التقديرية</span>
                    <strong className="text-slate-300">${analysisResult.hypotheticalTrade.estimatedCostUsd}</strong>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Live Paper Trading Opportunities Journal */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-400" />
              <span>سجل فرص التداول التجريبي الحي (Live Paper Opportunities Journal)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              سجل زمني لجميع عمليات التقييم الكمي اللحظية، مع إبراز أسباب الرفض أو القبول وعدم تنفيذ أي تداول حقيقي.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded bg-slate-950 text-slate-300 border border-slate-800">
              أوامر الوسيط: 0 (ممنوع في وضع Paper)
            </span>
          </div>
        </div>

        {paperJournal.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-xs">
            لا توجد فرص مسجلة بعد في الجلسة الحالية. اضغط على "⚡ تقييم الفرصة الحية" لبدء التسجيل.
          </div>
        ) : (
          <div className="w-full overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 mt-4">
            <table className="w-full min-w-[600px] text-xs font-mono text-slate-300">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 text-start">
                  <th className="py-2.5 px-3 text-start">الوقت (UTC)</th>
                  <th className="py-2.5 px-3 text-start">الزوج / الإطار</th>
                  <th className="py-2.5 px-3 text-start">السعر</th>
                  <th className="py-2.5 px-3 text-start">القرار</th>
                  <th className="py-2.5 px-3 text-start">الحالة</th>
                  <th className="py-2.5 px-3 text-start">النقاط</th>
                  <th className="py-2.5 px-3 text-start">المحركات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {paperJournal.map((opp) => (
                  <tr
                    key={opp.id}
                    onClick={() => setAnalysisResult(opp)}
                    className="hover:bg-slate-950/60 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-3 text-slate-400 text-[10px] whitespace-nowrap">
                      {new Date(opp.timestampMs).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-3 font-bold text-white whitespace-nowrap">
                      {opp.symbol} <span className="text-[9px] font-normal text-slate-400">({opp.timeframe})</span>
                    </td>
                    <td className="py-3 px-3 text-amber-400 whitespace-nowrap">
                      {opp.hypotheticalTrade?.lastUpdatePrice || opp.marketPrice}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        opp.decision === 'CONFIRMED'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : opp.decision === 'CANDIDATE'
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {opp.decision}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                        {opp.hypotheticalTrade?.status || 'N/A'}
                      </span>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-[10px]">
                      {opp.confluenceScore.toFixed(0)}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-[9px]">
                      <span className={opp.engineResults.priceAction.status === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-600'}>PA</span>
                      <span className={`ml-1 ${opp.engineResults.volumeProfile.status === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-600'}`}>VP</span>
                      <span className={`ml-1 ${opp.engineResults.anchoredVWAP.status === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-600'}`}>VW</span>
                      <span className={`ml-1 ${opp.engineResults.orderFlow.status === 'SUCCESS' ? 'text-emerald-400' : 'text-slate-600'}`}>OF</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
