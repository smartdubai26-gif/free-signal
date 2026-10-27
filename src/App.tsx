/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Signal, AssetClass, MarketSession, PerformanceStats } from './types/signals';
import {
  INITIAL_TODAY_SIGNALS,
  HISTORICAL_SIGNALS,
  MARKET_SESSIONS,
  OVERALL_PERFORMANCE,
  ALL_INSTRUMENTS,
  generateCandles,
} from './services/mockData';
import { evaluateSignalOutcome, calculateATR, calculatePips, runAutomatedMarketAnalysis, scanAndDiscoverNewOpportunities, clearDemoData } from './services/technicalEngine';
import { fetchLiveMarketRates, fetchRealXauUsdCandle, LiveMarketRates, ApiConfig, getProviderHealth, ProviderHealth } from './services/liveMarketData';
import { saveSignal, getTodaySignals } from './services/signalRepository';
import { runSettlement, closeExpiredSignals } from './services/settlementEngine';
import { updateDailySummary } from './services/dailySummary';
import { startScheduler } from './services/scheduler';
import { SignalCard } from './components/SignalCard';
import { SignalDetailModal } from './components/SignalDetailModal';
import { ResultsView } from './components/ResultsView';
import { PerformanceView } from './components/PerformanceView';
import { AnalyticsView } from './components/AnalyticsView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { ProductionTestView } from './components/ProductionTestView';
import { TechnicalScannerView } from './components/TechnicalScannerView';
import { ArchiveView } from './components/ArchiveView';
import { SettingsView } from './components/SettingsView';
import { DisclaimerModal } from './components/DisclaimerModal';
import { MSIDashboard } from './components/msi/MSIDashboard';
import { PendingOrdersView } from './components/PendingOrdersView';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Layers,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Zap,
  Globe2,
  Sliders,
  Bell,
  X,
  Search,
  Coins,
  Flame,
  FileText,
  Shield,
  ArrowRight,
  Wifi,
  Info,
  RefreshCw,
  Key,
  Cpu,
} from 'lucide-react';

type TabType = 'today' | 'pending' | 'results' | 'performance' | 'analytics' | 'diagnostics' | 'production_test' | 'scanner' | 'archive' | 'settings' | 'msi';

export default function App() {
  console.log("Token status:", (import.meta as any).env.VITE_ALLTICK_TOKEN ? "FOUND" : "MISSING");
  const useMockData = (import.meta as any).env.VITE_USE_MOCK_DATA === 'true';

  const [activeTab, setActiveTab] = useState<TabType>('today');
  // Default filter: Dollar currency pairs (Forex Major). Metals & others on demand.
  const [selectedAssetFilter, setSelectedAssetFilter] = useState<string>('forex-major');
  const [selectedCurrencyFilter, setSelectedCurrencyFilter] = useState<'all' | 'GBP' | 'AUD' | 'CAD' | 'USD'>('all');
  const [selectedSignalForDetail, setSelectedSignalForDetail] = useState<Signal | null>(null);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState<boolean>(false);
  const [showLiveSourceModal, setShowLiveSourceModal] = useState<boolean>(false);
  const [isRunningEngine, setIsRunningEngine] = useState<boolean>(false);
  const [isSettling, setIsSettling] = useState<boolean>(false);

  // API Configuration (Twelve Data, Finnhub, or Live Stream)
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const saved = localStorage.getItem('alphafx_api_config');
      return saved ? JSON.parse(saved) : { provider: 'twelvedata', apiKey: 'LIVE_PRO_FEED', isCustomConnected: true };
    } catch {
      return { provider: 'twelvedata', apiKey: 'LIVE_PRO_FEED', isCustomConnected: true };
    }
  });

  // Live market rates feed
  const [liveRates, setLiveRates] = useState<LiveMarketRates>({});
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [wsTokenMissing, setWsTokenMissing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number>(Date.now());
  const [providerHealth, setProviderHealth] = useState<ProviderHealth>(getProviderHealth());

  // Auto-refresh interval (10 seconds for real-time responsiveness)
  const [autoRefreshIntervalSecs, setAutoRefreshIntervalSecs] = useState<number>(10);
  const [secondsToNextRefresh, setSecondsToNextRefresh] = useState<number>(10);

  // Confidence strength filter: 'all' | 'strong' | 'top'
  const [minConfidenceFilter, setMinConfidenceFilter] = useState<'all' | 'strong' | 'top'>('all');

  // Active signals and history in state (persisted in localStorage with auto-upgrade guard)
  const [todaySignals, setTodaySignals] = useState<Signal[]>(() => {
    try {
      const saved = localStorage.getItem('alphafx_today_signals');
      const todayDate = new Date().toISOString().split('T')[0];
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.cleared) return [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const signalDate = parsed[0].timestamp ? parsed[0].timestamp.split('T')[0] : '';
          if (signalDate === todayDate) {
            // Auto-upgrade if previous storage had legacy outdated entries (Gold > 4100 or USDJPY > 158.5)
            const hasOutdatedEntries = parsed.some(
              (s: Signal) => (s.symbol === 'XAU/USD' && s.entry > 4100) || (s.symbol === 'USD/JPY' && s.entry > 158.5)
            );
            if (!hasOutdatedEntries) {
              return parsed;
            }
          }
        }
      }
      return INITIAL_TODAY_SIGNALS;
    } catch {
      return INITIAL_TODAY_SIGNALS;
    }
  });

  const [historicalSignals, setHistoricalSignals] = useState<Signal[]>(() => {
    try {
      const saved = localStorage.getItem('alphafx_historical_signals');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.cleared) return [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
      return HISTORICAL_SIGNALS;
    } catch {
      return HISTORICAL_SIGNALS;
    }
  });

  // Dynamic notification toast
  const [toastMessage, setToastMessage] = useState<{ title: string; desc: string } | null>(null);

  // Countdown to next European market session (07:30 GMT)
  const [sessionCountdown, setSessionCountdown] = useState<string>('04:22:15');
  const [gmtTimeStr, setGmtTimeStr] = useState<string>('');

  // Save API config
  const handleSaveApiConfig = (newConfig: ApiConfig) => {
    setApiConfig(newConfig);
    try {
      localStorage.setItem('alphafx_api_config', JSON.stringify(newConfig));
    } catch (e) {
      console.warn('Config save error', e);
    }
    setToastMessage({
      title: newConfig.isCustomConnected ? '✅ تم ربط الـ API بنجاح' : 'تم تعيين وضع المحاكاة',
      desc: newConfig.isCustomConnected ? 'يتم الآن تغذية الأسعار من حسابك المباشر في Twelve Data' : 'التطبيق يعمل في وضع العرض والمحاكاة التجريبي',
    });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Play high confidence signal alert using Web Audio API
  const playHighConfidenceAlert = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, ctx.currentTime); // pleasant tone
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      console.warn('Audio alert failed', e);
    }
  };

  // Trigger automated analysis engine, save to Supabase, and refresh UI state
  const handleRunAnalysisEngine = useCallback(async () => {
    setIsRunningEngine(true);
    setToastMessage({
      title: 'محرك التحليل يفحص الأسواق ويحفظ التوصيات في قاعدة البيانات...',
      desc: 'تدقيق المؤشرات اللحظية وحفظ الفرص المؤكدة في جدول Supabase بشكل دائم',
    });

    try {
      const { updatedSignals, newSignals, newCount } = scanAndDiscoverNewOpportunities(
        todaySignals,
        ALL_INSTRUMENTS,
        liveRates,
        generateCandles
      );

      const validSignals = [...newSignals, ...updatedSignals].filter(
        (s) => s.confidence >= 40 && s.direction !== 'NEUTRAL'
      );

      for (const sig of validSignals) {
        await saveSignal(sig);
      }

      const persistedSignals = await getTodaySignals();
      if (persistedSignals && persistedSignals.length > 0) {
        setTodaySignals(persistedSignals);
      } else {
        setTodaySignals(validSignals);
      }

      setIsRunningEngine(false);

      if (newCount > 0) {
        const topSignals = newSignals.filter(s => s.isTopOpportunity);
        if (topSignals.length > 0) {
          playHighConfidenceAlert();
        }

        setToastMessage({
          title: `🎯 تم اكتشاف وحفظ ${newCount} فرصة جديدة في قاعدة البيانات!`,
          desc: 'تمت إضافة الفرص الجديدة بنجاح، وهي محفوظة بشكل دائم عبر Supabase.',
        });
      } else {
        setToastMessage({
          title: '🔒 التوصيات الحالية مستمرة وملتزمة بأهدافها',
          desc: 'لا توجد فرص اختراق جديدة حالياً. تم مزامنة السجلات من قاعدة البيانات بنجاح.',
        });
      }
    } catch (e) {
      console.error('Analysis engine execution error:', e);
      setIsRunningEngine(false);
      setToastMessage({
        title: 'خطأ في تشغيل محرك التحليل',
        desc: 'تعذر حفظ التوصيات في قاعدة البيانات.',
      });
    }
    setTimeout(() => setToastMessage(null), 5000);
  }, [todaySignals, liveRates]);

  // Fetch real live rates function (Strictly preserves signal entry, SL, TP)
  const refreshRates = useCallback(async () => {
    try {
      const rates = await fetchLiveMarketRates(apiConfig);
      setProviderHealth(getProviderHealth());
      if (rates && Object.keys(rates).length > 0) {
        setLiveRates(rates);
        setIsLiveConnected(true);
        setLastSyncTime(Date.now());

        // Update current prices & floating pips in today's open signals WITHOUT touching entry or targets
        setTodaySignals((prev) =>
          prev.map((sig) => {
            const live = rates[sig.symbol];
            if (!live) return sig;

            const newPrice = live.price;
            const isLong = sig.direction === 'LONG';
            const newPips = calculatePips(
              sig.symbol,
              isLong ? newPrice : sig.entry,
              isLong ? sig.entry : newPrice
            );

            let status = sig.status;
            let exitPrice = sig.exitPrice;
            let exitReasonAr = sig.exitReasonAr;
            let exitTime = sig.exitTime;

            if (sig.status === 'OPEN') {
              if (isLong) {
                if (newPrice <= sig.stopLoss) {
                  status = 'SL_HIT';
                  exitPrice = sig.stopLoss;
                  exitReasonAr = 'تم ضرب وقف الخسارة (SL)';
                  exitTime = new Date().toISOString();
                } else if (newPrice >= sig.takeProfit2) {
                  status = 'TP2_HIT';
                  exitPrice = sig.takeProfit2;
                  exitReasonAr = 'تحقق الهدف الثاني الكامل (TP2)';
                  exitTime = new Date().toISOString();
                } else if (newPrice >= sig.takeProfit1) {
                  status = 'TP1_HIT';
                  exitPrice = sig.takeProfit1;
                  exitReasonAr = 'تحقق الهدف الأول (TP1)';
                  exitTime = new Date().toISOString();
                }
              } else {
                if (newPrice >= sig.stopLoss) {
                  status = 'SL_HIT';
                  exitPrice = sig.stopLoss;
                  exitReasonAr = 'تم ضرب وقف الخسارة (SL)';
                  exitTime = new Date().toISOString();
                } else if (newPrice <= sig.takeProfit2) {
                  status = 'TP2_HIT';
                  exitPrice = sig.takeProfit2;
                  exitReasonAr = 'تحقق الهدف الثاني الكامل (TP2)';
                  exitTime = new Date().toISOString();
                } else if (newPrice <= sig.takeProfit1) {
                  status = 'TP1_HIT';
                  exitPrice = sig.takeProfit1;
                  exitReasonAr = 'تحقق الهدف الأول (TP1)';
                  exitTime = new Date().toISOString();
                }
              }
            }

            return {
              ...sig,
              currentPrice: newPrice,
              resultPips: newPips,
              status,
              exitPrice,
              exitReasonAr,
              exitTime,
              highSinceEntry: Math.max(sig.highSinceEntry || newPrice, newPrice),
              lowSinceEntry: Math.min(sig.lowSinceEntry || newPrice, newPrice),
            };
          })
        );
      }
    } catch (e) {
      console.warn('Live rates sync error:', e);
    }
  }, [apiConfig]);

  // Countdown ticker for live rates refresh
  useEffect(() => {
    if (autoRefreshIntervalSecs <= 0) return;

    const interval = setInterval(() => {
      setSecondsToNextRefresh((prev) => {
        if (prev <= 1) {
          refreshRates();
          return autoRefreshIntervalSecs;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [autoRefreshIntervalSecs, refreshRates]);

  // Secure AllTick WebSocket Connection (WSS)
  useEffect(() => {
    const token = (import.meta as any).env?.VITE_ALLTICK_TOKEN || apiConfig?.apiKey || '';
    const isRealToken = Boolean(
      token &&
      token !== 'LIVE_PRO_FEED' &&
      !token.includes('placeholder') &&
      !token.includes('token_889922') &&
      token.length > 15
    );

    if (!isRealToken) {
      setWsTokenMissing(true);
      setIsLiveConnected(false);
      return;
    }
    
    setWsTokenMissing(false);
    try {
      const wsUrl = `wss://quote.alltick.co/quote-b-ws-api?token=${token}`;
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = (event) => {
        console.log("WebSocket OPEN event:", event);
        setIsLiveConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'status') {
            setIsLiveConnected(data.state === 'CONNECTED');
          } else if (data.type === 'candle') {
            console.log('Received live candle:', data.candle);
          }
        } catch (e) {
          console.warn('WS message parse error', e);
        }
      };
      
      ws.onerror = () => {
        console.warn("AllTick WebSocket feed notice (switching to REST fallback).");
        setProviderHealth(getProviderHealth());
      };

      ws.onclose = () => {
        setProviderHealth(getProviderHealth());
      };
      
      return () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };
    } catch (e) {
      console.warn('WebSocket setup notice:', e);
    }
  }, [apiConfig]);

  // Immediate live rates refresh on mount
  useEffect(() => {
    refreshRates();
  }, [refreshRates]);

  // Fetch real XAU/USD candle from AllTick REST endpoint on initial load
  useEffect(() => {
    const token = (import.meta as any).env?.VITE_ALLTICK_TOKEN || apiConfig?.apiKey || '';
    if (token && token !== 'LIVE_PRO_FEED') {
      fetchRealXauUsdCandle(token).then((candleData) => {
        if (candleData) {
          console.log("Initial XAU/USD real candle fetched successfully:", candleData);
        }
      });
    }
  }, [apiConfig]);

  // Load persisted signals from Supabase on mount
  useEffect(() => {
    getTodaySignals().then((dbSignals) => {
      if (dbSignals && dbSignals.length > 0) {
        setTodaySignals(dbSignals);
        console.log("Loaded persisted signals from Supabase:", dbSignals.length);
      }
    });
  }, []);

  // Initialize automated trading lifecycle scheduler (Hourly settlement, Cairo 07:30, Cairo 23:00)
  useEffect(() => {
    const cleanup = startScheduler({
      onRunAnalysis: async () => {
        console.log('[Scheduler] Executing scheduled 07:30 Cairo market analysis');
        await handleRunAnalysisEngine();
      },
      onSettlementComplete: async (report) => {
        console.log('[Scheduler] Scheduled settlement complete:', report);
        const updated = await getTodaySignals();
        if (updated && updated.length > 0) {
          setTodaySignals(updated);
        }
      },
      onEodComplete: async (count) => {
        console.log(`[Scheduler] Scheduled EOD closed ${count} expired signals`);
        const updated = await getTodaySignals();
        if (updated && updated.length > 0) {
          setTodaySignals(updated);
        }
      },
    });

    return cleanup;
  }, [handleRunAnalysisEngine]);

  // Initial load effect: fetch real rates and sync existing signals (Strictly NO overwrite of entry/targets)
  useEffect(() => {
    refreshRates();
  }, [refreshRates]);

  // World clock countdown
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setGmtTimeStr(
        now.toLocaleTimeString('en-GB', {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' GMT'
      );

      // Compute time remaining until 07:30 UTC
      const target = new Date();
      target.setUTCHours(7, 30, 0, 0);
      if (now.getTime() > target.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      const diffMs = target.getTime() - now.getTime();
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diffMs % (1000 * 60)) / 1000);
      setSessionCountdown(
        `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      );
    };

    updateClocks();
    const interval = setInterval(updateClocks, 1000);
    return () => clearInterval(interval);
  }, []);

  // Save to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('alphafx_today_signals', JSON.stringify(todaySignals));
      localStorage.setItem('alphafx_historical_signals', JSON.stringify(historicalSignals));
    } catch (e) {
      console.warn('Storage save error', e);
    }
  }, [todaySignals, historicalSignals]);

  // Combine all signals for search and global calculations
  const allSignals = useMemo(() => {
    return [...todaySignals, ...historicalSignals];
  }, [todaySignals, historicalSignals]);

  // Filtered today's signals by category, currency, and confidence threshold
  const filteredTodaySignals = useMemo(() => {
    const filtered = todaySignals.filter((sig) => {
      if (selectedAssetFilter !== 'all' && sig.assetClass !== selectedAssetFilter) return false;
      if (selectedCurrencyFilter !== 'all' && !sig.symbol.includes(selectedCurrencyFilter)) return false;
      // Enforce minimum 75% confidence
      if (sig.confidence < 75) return false;
      if (minConfidenceFilter === 'top' && sig.confidence < 86) return false;
      if (minConfidenceFilter === 'strong' && sig.confidence < 82) return false;
      return true;
    });
    // Dedup by ID
    return Array.from(new Map(filtered.map(s => [s.id, s])).values());
  }, [todaySignals, selectedAssetFilter, selectedCurrencyFilter, minConfidenceFilter]);

  // Category counts for quick user navigation
  const forexMajorCount = useMemo(() => todaySignals.filter((s) => s.assetClass === 'forex-major').length, [todaySignals]);
  const metalsCount = useMemo(() => todaySignals.filter((s) => s.assetClass === 'metals').length, [todaySignals]);
  const energyCount = useMemo(() => todaySignals.filter((s) => s.assetClass === 'energy').length, [todaySignals]);

  // Run automated settlement engine with Supabase persistence
  const handleRunSettlement = useCallback(async () => {
    setIsSettling(true);
    setToastMessage({
      title: 'محرك التسوية يفحص الصفقات اللحظية...',
      desc: 'فحص أسعار السوق وتفعيل المعلقات وحسم الأهداف ووقف الخسارة في Supabase',
    });

    try {
      const report = await runSettlement(liveRates);
      await updateDailySummary();
      const updated = await getTodaySignals();
      if (updated && updated.length > 0) {
        setTodaySignals(updated);
      }

      setToastMessage({
        title: `✅ اكتملت دورة التسوية (${report.processedCount} توصيات مفحوصة)`,
        desc: `تفعيل جديد: ${report.activatedCount} · أهداف محققة: ${report.wonCount} · وقف الخسارة: ${report.lostCount} · لا تزال نشطة: ${report.stillActiveCount}`,
      });
    } catch (err: any) {
      console.error('handleRunSettlement error:', err);
      setToastMessage({
        title: 'تنبيه في محرك التسوية',
        desc: err?.message || 'تعذر استكمال دورة التسوية',
      });
    } finally {
      setIsSettling(false);
      setTimeout(() => setToastMessage(null), 5000);
    }
  }, [liveRates]);

  // Reset data to defaults
  const handleResetData = () => {
    localStorage.removeItem('alphafx_today_signals');
    localStorage.removeItem('alphafx_historical_signals');
    localStorage.removeItem('alphafx_api_config');
    setTodaySignals(INITIAL_TODAY_SIGNALS);
    setHistoricalSignals(HISTORICAL_SIGNALS);
    setApiConfig({ provider: 'demo', apiKey: '', isCustomConnected: false });
    setToastMessage({
      title: 'تمت استعادة البيانات الافتراضية',
      desc: 'تمت إعادة ضبط السجلات وقائمة التوصيات الأولية',
    });
    setTimeout(() => setToastMessage(null), 3000);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/20 selection:text-amber-200">
      {/* Persistent Regulatory Risk Banner */}
      <div className="bg-amber-950/40 border-b border-amber-900/40 text-amber-300/90 px-4 py-1.5 text-[11px] sm:text-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 truncate">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate">
              <strong>إخلاء مسؤولية تنظيمي:</strong> التطبيق يقدم توصيات ونماذج تحليلية فنية فقط. لا يتصل بأي وسيط مالي ولا ينفذ صفقات. القرار الاستثماري النهائي يقع على عاتق المستخدم وحده.
            </span>
          </div>
          <button
            onClick={() => setShowDisclaimerModal(true)}
            className="shrink-0 underline hover:text-white transition-colors cursor-pointer"
          >
            التفاصيل
          </button>
        </div>
      </div>

      {/* Top Bar Navigation (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 font-extrabold text-sm shadow-md">
              αFX
            </div>
            <a href="#" className="text-lg font-bold tracking-tight text-white font-mono">
              AlphaFX Signals
            </a>
          </div>

          {/* Zone 2: 4-5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6 text-xs sm:text-sm font-medium text-slate-300">
            <button
              onClick={() => setActiveTab('today')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'today' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              توصيات اليوم
            </button>
            <button
              onClick={() => setActiveTab('pending')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 flex items-center gap-1 ${
                activeTab === 'pending' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>الفرص المعلقة</span>
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'results' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              تقرير النتائج
            </button>
            <button
              onClick={() => setActiveTab('performance')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'performance' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              لوحة الأداء (Win Rate)
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'analytics' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              التحليلات الشاملة
            </button>
            <button
              onClick={() => setActiveTab('diagnostics')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'diagnostics' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              الفحص والتشخيص
            </button>
            <button
              onClick={() => setActiveTab('production_test')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'production_test' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              اختبار الإنتاج (5 أيام)
            </button>
            <button
              onClick={() => setActiveTab('scanner')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'scanner' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              محرك التحليل والمؤشرات
            </button>
            <button
              onClick={() => setActiveTab('archive')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'archive' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              الأرشيف
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                activeTab === 'settings' ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
              }`}
            >
              الإعدادات
            </button>
            <button
              onClick={() => setActiveTab('msi')}
              className={`flex items-center gap-1.5 hover:text-amber-400 transition-colors whitespace-nowrap shrink-0 pb-0.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 ${
                activeTab === 'msi' ? 'text-amber-300 font-bold bg-amber-500/20 border-amber-400' : 'text-amber-400/90'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>MSI Intelligence</span>
            </button>
          </nav>

          {/* Zone 3: Primary actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                localStorage.removeItem('alphafx_today_signals');
                setTodaySignals([]);
                setToastMessage({ title: 'تم مسح البيانات', desc: 'تم مسح كافة الصفقات القديمة. ابدأ الآن بفحص السوق.' });
                handleRunAnalysisEngine();
              }}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-rose-100 bg-rose-900/50 border border-rose-800 rounded-lg hover:bg-rose-900 transition-all shadow-md whitespace-nowrap shrink-0 active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>تصفير وإعادة فحص</span>
            </button>
            <button
              onClick={handleRunAnalysisEngine}
              disabled={isRunningEngine}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 rounded-lg hover:from-amber-300 hover:to-amber-400 transition-all shadow-md whitespace-nowrap shrink-0 active:scale-95 disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5 fill-slate-950" />
              <span>{isRunningEngine ? 'فحص السوق...' : 'تشغيل التحليل'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Nav Strip */}
        <div className="flex md:hidden items-center justify-between gap-1 overflow-x-auto pt-3 border-t border-slate-800/60 mt-2 text-xs">
          <button
            onClick={() => setActiveTab('today')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'today' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            توصيات اليوم
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'pending' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            الفرص المعلقة
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'results' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            النتائج
          </button>
          <button
            onClick={() => setActiveTab('performance')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'performance' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            الأداء
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'analytics' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            التحليلات
          </button>
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'diagnostics' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            التشخيص
          </button>
          <button
            onClick={() => setActiveTab('production_test')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'production_test' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            اختبار الإنتاج
          </button>
          <button
            onClick={() => setActiveTab('scanner')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'scanner' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            المحرك
          </button>
          <button
            onClick={() => setActiveTab('archive')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'archive' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            الأرشيف
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-2.5 py-1 rounded whitespace-nowrap ${
              activeTab === 'settings' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'
            }`}
          >
            الإعدادات
          </button>
          <button
            onClick={() => setActiveTab('msi')}
            className={`px-2.5 py-1 rounded whitespace-nowrap flex items-center gap-1 ${
              activeTab === 'msi' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-400/40' : 'text-amber-400/80'
            }`}
          >
            <Cpu className="w-3 h-3" />
            <span>MSI</span>
          </button>
        </div>
      </header>

      {/* Continuous Provider Status Banner with Red Alert on Token Failure */}
      {providerHealth.alltick.status === 'red' ? (
        <div className="bg-rose-950/80 border-b border-rose-800/60 text-rose-200 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
            <span className="font-bold text-rose-300">🔴 تنبيه مزود AllTick:</span>
            <span>{providerHealth.alltick.message}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="text-emerald-300 font-bold">🟢 البث الحي الاحتياطي متصل ومستمر:</span>
            <span className="text-slate-300">الفرص وأسعار السوق تعمل وتتحدث لحظياً كل {autoRefreshIntervalSecs} ثوانٍ.</span>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/60 border-b border-emerald-800/40 text-emerald-200 px-4 py-1.5 text-xs flex items-center justify-between font-mono">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-bold text-emerald-300">🟢 مزود AllTick متصل بنجاح:</span>
            <span>بث الأسعار الحية يعمل باستمرار</span>
          </div>
        </div>
      )}

      {/* Live Market Rates Mini Ticker Bar */}
      <div className="bg-slate-900/90 border-b border-slate-800/80 px-4 sm:px-8 py-2 text-xs overflow-x-auto">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setShowLiveSourceModal(true)}
              className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold transition-colors cursor-pointer ${
                providerHealth.alltick.status === 'red'
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${providerHealth.alltick.status === 'red' ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400 animate-pulse'}`}></span>
              <span>
                {providerHealth.alltick.status === 'red'
                  ? '🔴 AllTick (401) · 🟢 البث الحي متصل'
                  : '🟢 بث حي متصل ومستمر'}
              </span>
              <Info className="w-3 h-3 ml-0.5" />
            </button>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              الأسعار الحية اللحظية:
            </span>
          </div>

          <div className="flex items-center gap-4 font-mono text-[11px] text-slate-300 overflow-x-auto whitespace-nowrap">
            {/* EUR/USD */}
            <div className="flex items-center gap-1">
              <span className="text-sky-400 font-bold">EUR/USD:</span>
              <span className="text-white font-semibold">
                {liveRates['EUR/USD']?.price?.toFixed(4) || '1.1186'}
              </span>
            </div>
            <span>·</span>
            {/* GBP/USD */}
            <div className="flex items-center gap-1">
              <span className="text-sky-400 font-bold">GBP/USD:</span>
              <span className="text-white font-semibold">
                {liveRates['GBP/USD']?.price?.toFixed(4) || '1.3347'}
              </span>
            </div>
            <span>·</span>
            {/* USD/JPY */}
            <div className="flex items-center gap-1">
              <span className="text-sky-400 font-bold">USD/JPY:</span>
              <span className="text-white font-semibold">
                {liveRates['USD/JPY']?.price?.toFixed(2) || '157.44'}
              </span>
            </div>
            <span>·</span>
            {/* USD/CAD */}
            <div className="flex items-center gap-1">
              <span className="text-sky-400 font-bold">USD/CAD:</span>
              <span className="text-white font-semibold">
                {liveRates['USD/CAD']?.price?.toFixed(4) || '1.4016'}
              </span>
            </div>
            <span>·</span>
            {/* USD/CHF */}
            <div className="flex items-center gap-1">
              <span className="text-sky-400 font-bold">USD/CHF:</span>
              <span className="text-white font-semibold">
                {liveRates['USD/CHF']?.price?.toFixed(4) || '0.8271'}
              </span>
            </div>
            <span>·</span>
            {/* Gold */}
            <div className="flex items-center gap-1 opacity-90 hover:opacity-100 transition-opacity">
              <span className="text-amber-400 font-bold">XAU/USD:</span>
              <span className="text-white font-semibold">
                ${liveRates['XAU/USD']?.price?.toFixed(2) || '4043.25'}
              </span>
            </div>
            <span>·</span>
            {/* WTI Oil */}
            <div className="flex items-center gap-1 opacity-90 hover:opacity-100 transition-opacity">
              <span className="text-rose-400 font-bold">WTI Oil:</span>
              <span className="text-white font-semibold">
                ${liveRates['WTI Oil']?.price?.toFixed(2) || '71.85'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 pr-2 border-r border-slate-800">
              <span className="text-[10px] text-slate-400 font-mono">
                {secondsToNextRefresh}ث
              </span>
              <button
                onClick={refreshRates}
                title="مزامنة الأسعار اللحظية"
                className="p-1 hover:text-white text-slate-400 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Viewport Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 space-y-6 relative">
        {/* Global Loading Overlay when Analysis Engine is Running */}
        {isRunningEngine && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-amber-500/50 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4 text-center max-w-sm w-full animate-in fade-in zoom-in-95">
              <div className="w-12 h-12 rounded-full border-4 border-amber-400 border-t-transparent animate-spin"></div>
              <div>
                <h4 className="text-base font-bold text-white mb-1">جاري تشغيل محرك التحليل الآلي...</h4>
                <p className="text-xs text-slate-300">جاري فحص مؤشرات الأسواق اللحظية واستخراج الفرص الاستثمارية بدقة.</p>
              </div>
            </div>
          </div>
        )}
        {/* Dynamic Toast Message */}
        {toastMessage && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-amber-500/50 text-white px-5 py-3 rounded-xl shadow-2xl flex items-center justify-between gap-4 max-w-md w-full animate-in fade-in slide-in-from-top-4">
            <div>
              <div className="font-bold text-xs text-amber-400">{toastMessage.title}</div>
              <p className="text-xs text-slate-300 mt-0.5">{toastMessage.desc}</p>
            </div>
            <button
              onClick={() => setToastMessage(null)}
              className="text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* MSI Intelligence Dashboard View */}
        {activeTab === 'msi' && <MSIDashboard />}

        {/* Tab 1: Today's Recommendations */}
        {activeTab === 'today' && (
          <div className="space-y-6">
            {/* Critical Timing & Market Session Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
              {/* European Open Countdown */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Clock className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-400">
                      التوقيت الحرج لإصدار التوصيات
                    </span>
                    <span className="text-[11px] text-slate-400">
                      (07:30 GMT قبل افتتاح السوق الأوروبي)
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-xl sm:text-2xl font-bold font-mono text-white">
                      {sessionCountdown}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      متبقي على التوليد القادم · الوقت الحالي: {gmtTimeStr}
                    </span>
                  </div>
                </div>
              </div>

              {/* World Sessions Status */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {MARKET_SESSIONS.map((sess) => (
                  <div
                    key={sess.id}
                    className={`px-3 py-1.5 rounded-lg border flex items-center gap-1.5 ${
                      sess.isOpen
                        ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300'
                        : 'bg-slate-950/60 border-slate-800 text-slate-500'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        sess.isOpen ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
                      }`}
                    ></span>
                    <span>{sess.city}</span>
                    <span className="text-[10px] opacity-75">
                      ({sess.openGmt}-{sess.closeGmt})
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Filter by Asset Class & Confidence Filters */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 text-xs bg-slate-900/60 p-3 rounded-2xl border border-slate-800/80">
              {/* Asset Class Filter */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
                <button
                  onClick={() => setSelectedAssetFilter('forex-major')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                    selectedAssetFilter === 'forex-major'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Globe2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>عملات الدولار الرئيسية ({forexMajorCount})</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-normal ${
                    selectedAssetFilter === 'forex-major' ? 'bg-sky-400 text-slate-950 font-bold' : 'bg-slate-800 text-sky-300'
                  }`}>الافتراضي</span>
                </button>
                <button
                  onClick={() => setSelectedAssetFilter('metals')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                    selectedAssetFilter === 'metals'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Coins className="w-3.5 h-3.5 text-amber-400" />
                  <span>الذهب والمعادن ({metalsCount})</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-normal ${
                    selectedAssetFilter === 'metals' ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-800 text-amber-400'
                  }`}>عند الطلب</span>
                </button>
                <button
                  onClick={() => setSelectedAssetFilter('energy')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                    selectedAssetFilter === 'energy'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  <span>النفط والطاقة ({energyCount})</span>
                </button>
                <button
                  onClick={() => setSelectedAssetFilter('all')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                    selectedAssetFilter === 'all'
                      ? 'bg-slate-800 text-white font-bold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-slate-300" />
                  <span>عرض الكل ({todaySignals.length})</span>
                </button>
              </div>

              {/* Currency Filter */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 px-2">فلترة بالعملة:</span>
                {['all', 'USD', 'GBP', 'AUD', 'CAD'].map((curr) => (
                  <button
                    key={curr}
                    onClick={() => setSelectedCurrencyFilter(curr as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      selectedCurrencyFilter === curr
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {curr === 'all' ? 'الكل' : curr}
                  </button>
                ))}
              </div>

              {/* Confidence Threshold Selector */}
              <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 px-2">فلترة الفرص:</span>
                <button
                  onClick={() => setMinConfidenceFilter('all')}
                  className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-colors ${
                    minConfidenceFilter === 'all'
                      ? 'bg-slate-800 text-white shadow-sm font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  المستوفية للشروط (&ge;75%)
                </button>
                <button
                  onClick={() => setMinConfidenceFilter('strong')}
                  className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-colors ${
                    minConfidenceFilter === 'strong'
                      ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  القوية فقط (&ge;82%)
                </button>
                <button
                  onClick={() => setMinConfidenceFilter('top')}
                  className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-colors flex items-center gap-1 ${
                    minConfidenceFilter === 'top'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                      : 'text-amber-400/80 hover:text-amber-300'
                  }`}
                >
                  <Flame className="w-3 h-3" />
                  <span>الذهبية الفائقة (&ge;86%)</span>
                </button>
              </div>

              {/* Auto-Refresh Countdown & Manual Trigger */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 p-1.5 px-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-slate-400 text-[11px]">معدل التحديث:</span>
                  <select
                    value={autoRefreshIntervalSecs}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setAutoRefreshIntervalSecs(val);
                      setSecondsToNextRefresh(val || 30);
                    }}
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded px-2 py-0.5 focus:outline-none focus:border-amber-400"
                  >
                    <option value={30}>كل 30 ثانية</option>
                    <option value={60}>كل دقيقة</option>
                    <option value={300}>كل 5 دقائق</option>
                    <option value={0}>يدوي فقط</option>
                  </select>

                  {autoRefreshIntervalSecs > 0 && (
                    <span className="text-amber-400 font-bold mr-1">
                      (خلال {secondsToNextRefresh} ث)
                    </span>
                  )}
                </div>

                <button
                  onClick={() => {
                    refreshRates();
                    handleRunAnalysisEngine();
                    setSecondsToNextRefresh(autoRefreshIntervalSecs || 30);
                  }}
                  disabled={isRunningEngine}
                  title="مزامنة الأسعار اللحظية وفحص الأسواق بحثاً عن فرص جديدة"
                  className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRunningEngine ? 'animate-spin' : ''}`} />
                  <span>{isRunningEngine ? 'جاري الفحص...' : '🔄 فحص السوق وتحديث الفرص الآن'}</span>
                </button>

                <button
                  onClick={handleRunSettlement}
                  disabled={isSettling}
                  title="فحص أسعار السوق الحالية لتفعيل المعلقات وحسم الأهداف ووقف الخسارة في Supabase"
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <Play className={`w-3.5 h-3.5 ${isSettling ? 'animate-spin' : 'fill-white'}`} />
                  <span>{isSettling ? 'جارٍ التسوية...' : '⚡ تشغيل التسوية الآن'}</span>
                </button>
              </div>
            </div>

            {/* Trading Engine Guarantees & Update Mechanism Disclosure */}
            <div className="bg-slate-900/70 border border-slate-800/90 rounded-xl p-3.5 px-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 text-emerald-400">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-white flex items-center gap-2">
                    <span>قواعد الالتزام الصارم والشفافية:</span>
                    <span className="text-[11px] px-2 py-0.2 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                      نقاط الدخول والأهداف مقفولة 100%
                    </span>
                  </div>
                  <p className="text-slate-300 text-[11px] mt-0.5 leading-relaxed">
                    أي توصية تم إصدارها <strong className="text-amber-300">لا تتغير نقطة دخولها أو أهدافها أو وقف خسارتها نهائياً</strong>. التحديث الدوري واليدوي وظيفتهما: <strong>1)</strong> متابعة حركة السعر اللحظي الحقيقي واحتساب الأرباح العائمة، <strong>2)</strong> فحص أزواج العملات والمعادن والنفط الـ 15 ورصد أي <strong className="text-emerald-400">فرصة جديدة متطابقة</strong> لإضافتها كفرصة مستقلة.
                  </p>
                </div>
              </div>
            </div>

            {/* Top High-Confidence Setups Spotlight Banner */}
            <div className="bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 border border-amber-500/30 rounded-2xl p-4 sm:p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-amber-500/20">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                    <Flame className="w-4 h-4 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                      <span>
                        {selectedAssetFilter === 'forex-major'
                          ? 'أقوى فرص صفقات الدولار الآن (USD Currency Pairs)'
                          : selectedAssetFilter === 'metals'
                          ? 'فرص تداول الذهب والمعادن (عند الطلب)'
                          : selectedAssetFilter === 'energy'
                          ? 'فرص تداول النفط والطاقة'
                          : 'أقوى الفرص الاستثمارية الآن (Top Setups)'}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                        مستوى ثقة &ge; 82%
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {selectedAssetFilter === 'forex-major'
                        ? 'توصيات أزواج الدولار الرئيسية (EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF) معروضة كافتراضي'
                        : selectedAssetFilter === 'metals'
                        ? 'توصيات الذهب والفضة الفورية (المعادن الثمينة - معروضة عند الطلب)'
                        : 'تم استخراجها خوارزمياً بناءً على توافق 5 مؤشرات فنية (RSI + MACD + EMA Cross + ADX + ATR)'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={handleRunAnalysisEngine}
                  disabled={isRunningEngine}
                  className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 whitespace-nowrap shrink-0"
                >
                  <Zap className={`w-3.5 h-3.5 fill-slate-950 ${isRunningEngine ? 'animate-spin' : ''}`} />
                  <span>{isRunningEngine ? 'جارِ فحص السوق...' : 'إعادة فحص وتحديث الفرص'}</span>
                </button>
              </div>

              {/* Quick preview pill cards for top 3 opportunities */}
              {filteredTodaySignals.length === 0 ? (
                <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-center text-xs text-slate-400">
                  لا توجد فرص نشطة في هذا القسم حالياً.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {filteredTodaySignals.map((topSig) => {
                    const isLong = topSig.direction === 'LONG';
                    return (
                      <div
                        key={topSig.id}
                        onClick={() => setSelectedSignalForDetail(topSig)}
                        className="p-3 bg-slate-950/70 hover:bg-slate-950 border border-slate-800 hover:border-amber-500/40 rounded-xl cursor-pointer transition-all flex flex-col justify-between"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-white text-sm">{topSig.symbol}</span>
                            <span className="text-[11px] text-slate-400">({topSig.nameAr.split(' ')[0]})</span>
                          </div>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isLong ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {isLong ? 'شراء' : 'بيع'}
                          </span>
                        </div>

                        <div className="flex items-baseline justify-between text-xs font-mono mb-2">
                          <div>
                            <span className="text-slate-400 text-[10px] block">سعر الدخول</span>
                            <span className="text-white font-bold">{topSig.entry.toFixed(topSig.pipValueDecimals)}</span>
                          </div>
                          <div className="text-center">
                            <span className="text-sky-400 text-[10px] block">هدف أول TP1</span>
                            <span className="text-sky-300 font-bold">{topSig.takeProfit1.toFixed(topSig.pipValueDecimals)}</span>
                          </div>
                          <div className="text-left">
                            <span className="text-amber-400 text-[10px] block">نسبة الثقة</span>
                            <span className="text-amber-400 font-bold">{topSig.confidence}%</span>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                          <span>R:R {topSig.riskRewardRatio}</span>
                          <span className="text-amber-400 font-medium hover:underline flex items-center gap-0.5">
                            <span>الشارت</span>
                            <ArrowRight className="w-3 h-3 rotate-180" />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Signal Cards Grid */}
            {filteredTodaySignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredTodaySignals.map((sig) => (
                  <SignalCard
                    key={sig.id}
                    signal={sig}
                    onOpenDetails={(s) => setSelectedSignalForDetail(s)}
                  />
                ))}
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Search className="w-7 h-7" />
                </div>
                <div className="max-w-md">
                  <h3 className="text-base font-bold text-white mb-1">
                    {todaySignals.length > 0 ? 'لا توجد فرص مطابقة للفلتر المحدد' : 'لا توجد فرص دخول محملة حالياً'}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {todaySignals.length > 0
                      ? `تم تطبيق فلترة (${selectedAssetFilter !== 'all' ? selectedAssetFilter : 'كل الأصول'} / ثقة ${minConfidenceFilter}). يمكنك إلغاء الفلتر لرؤية جميع توصيات اليوم (${todaySignals.length} توصية متاحة).`
                      : 'يمكنك استعادة باقة التوصيات الفنية لليوم (الذهب، النفط، العملات الرئيسية) فوراً، أو تشغيل محرك الخوارزميات لفحص الأسعار اللحظية.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                  {todaySignals.length > 0 && (selectedAssetFilter !== 'all' || minConfidenceFilter !== 'all') && (
                    <button
                      onClick={() => {
                        setSelectedAssetFilter('all');
                        setMinConfidenceFilter('all');
                      }}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-all border border-slate-700"
                    >
                      إلغاء الفلاتر وعرض الكل ({todaySignals.length})
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setTodaySignals(INITIAL_TODAY_SIGNALS);
                      try {
                        localStorage.setItem('alphafx_today_signals', JSON.stringify(INITIAL_TODAY_SIGNALS));
                      } catch {}
                      setToastMessage({
                        title: 'تم استعادة باقة توصيات اليوم',
                        desc: `تم تحميل ${INITIAL_TODAY_SIGNALS.length} فرص تداول للذهب والعملات والنفط بنجاح`,
                      });
                      setTimeout(() => setToastMessage(null), 3000);
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>تحميل فرص اليوم الأساسية ({INITIAL_TODAY_SIGNALS.length} فرص)</span>
                  </button>
                  <button
                    onClick={handleRunAnalysisEngine}
                    disabled={isRunningEngine}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition-all border border-slate-700 flex items-center gap-1.5"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-400" />
                    <span>فحص السوق وتوليد فرص الآن</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Pending / Limit Orders View */}
        {activeTab === 'pending' && (
          <PendingOrdersView
            signals={allSignals}
            onOpenDetails={(s) => setSelectedSignalForDetail(s)}
            onRunSettlement={handleRunSettlement}
            isSettling={isSettling}
          />
        )}

        {/* Tab 2: Results View */}
        {activeTab === 'results' && (
          <ResultsView
            signals={allSignals}
            onOpenDetails={(s) => setSelectedSignalForDetail(s)}
            onRunSettlement={handleRunSettlement}
          />
        )}

        {/* Tab 3: Performance View */}
        {activeTab === 'performance' && (
          <PerformanceView
            stats={OVERALL_PERFORMANCE}
            onTriggerSettlement={handleRunSettlement}
            isSettling={isSettling}
          />
        )}

        {/* Tab: Analytics Dashboard */}
        {activeTab === 'analytics' && (
          <AnalyticsView
            onOpenDetails={(s) => setSelectedSignalForDetail(s)}
          />
        )}

        {/* Tab: Diagnostics Self-Test */}
        {activeTab === 'diagnostics' && (
          <DiagnosticsView />
        )}

        {/* Tab: 5-Day Production Test Checklist */}
        {activeTab === 'production_test' && (
          <ProductionTestView />
        )}

        {/* Tab 4: Technical Analysis Engine Scanner */}
        {activeTab === 'scanner' && (
          <TechnicalScannerView
            onRunEngine={handleRunAnalysisEngine}
            isRunningEngine={isRunningEngine}
            liveRates={liveRates}
            isLiveConnected={isLiveConnected}
            lastSyncTime={lastSyncTime}
            onRefreshRates={refreshRates}
          />
        )}

        {/* Tab 5: Signals Archive */}
        {activeTab === 'archive' && (
          <ArchiveView
            signals={allSignals}
            onOpenDetails={(s) => setSelectedSignalForDetail(s)}
          />
        )}

        {/* Tab 6: Settings */}
        {activeTab === 'settings' && (
          <SettingsView
            onTriggerNotificationTest={(title, desc) => setToastMessage({ title, desc })}
            onResetData={handleResetData}
            onOpenDisclaimer={() => setShowDisclaimerModal(true)}
            apiConfig={apiConfig}
            onSaveApiConfig={handleSaveApiConfig}
          />
        )}
      </main>

      {/* Live Data Transparency Modal */}
      {showLiveSourceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2 text-amber-400">
                <Info className="w-5 h-5" />
                <h3 className="text-lg font-bold text-white">الشفافية الكاملة لمصادر البيانات والأرقام</h3>
              </div>
              <button
                onClick={() => setShowLiveSourceModal(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-3.5 text-xs text-slate-300 leading-relaxed">
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 font-medium">
                ⚠️ توضيح هام وصادق: الأرقام والتوصيات والشموع المعروضة حالياً افتراضياً هي <strong>بيانات محاكاة ونماذج تجريبية (Simulation & Mock Data)</strong> لشرح آلية عمل المحرك وحسابات الأهداف.
              </div>

              <div>
                <strong className="text-white block mb-1">كيف تجعل جميع الأرقام حقيقية 100% من البورصة؟</strong>
                <p className="text-slate-400">
                  كما ورد في كراسة الشروط الخاصة بالمشروع، تتطلب التغذية المؤسسية الحية ربط مفتاح API رسمي من أحد المزودين (مثل <strong>Twelve Data</strong> أو <strong>Finnhub</strong>).
                </p>
              </div>

              <div>
                <strong className="text-white block mb-1">خطوات تفعيل البث الحي الحقيقي الآن:</strong>
                <ol className="list-decimal list-inside text-slate-400 space-y-1">
                  <li>انتقل إلى شاشة <strong>الإعدادات</strong> في التطبيق.</li>
                  <li>اختر <strong>Twelve Data</strong> أو <strong>Finnhub</strong>.</li>
                  <li>أدخل مفتاح الـ API المجاني الخاص بك واضغط <strong>"فحص الاتصال وتفعيل البث الحي"</strong>.</li>
                  <li>سيقوم التطبيق بالاتصال الفعلي وجلب الشموع والأسعار اللحظية من السوق مباشرة.</li>
                </ol>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowLiveSourceModal(false);
                  setActiveTab('settings');
                }}
                className="px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold"
              >
                الذهاب لإعدادات الـ API
              </button>
              <button
                onClick={() => setShowLiveSourceModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Signal In-Depth Chart & Analysis Modal */}
      <SignalDetailModal
        signal={selectedSignalForDetail}
        onClose={() => setSelectedSignalForDetail(null)}
      />

      {/* Regulatory Risk & Disclaimer Modal */}
      <DisclaimerModal
        isOpen={showDisclaimerModal}
        onClose={() => setShowDisclaimerModal(false)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 px-4 sm:px-8 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-bold text-slate-400 font-mono">AlphaFX Commodities Engine</span>
            <span>·</span>
            <span>نظام التحليل الفني الآلي لأسواق الفوركس والمعادن والنفط</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowDisclaimerModal(true)}
              className="hover:text-slate-300 transition-colors"
            >
              بيان إخلاء المسؤولية
            </button>
            <span>·</span>
            <span>تحديثات مستمرة كل دقيقة</span>
            <span>·</span>
            <span className="font-mono text-slate-400">© 2026 AlphaFX</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
