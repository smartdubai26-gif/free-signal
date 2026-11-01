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
  buildSeedSignals,
} from './services/mockData';
import { evaluateSignalOutcome, calculateATR, calculatePips, runAutomatedMarketAnalysis, scanAndDiscoverNewOpportunities, clearDemoData } from './services/technicalEngine';
import { fetchLiveMarketRates, fetchRealXauUsdCandle, LiveMarketRates, ApiConfig, getProviderHealth, ProviderHealth } from './services/liveMarketData';
import { saveSignal, getTodaySignals } from './services/signalRepository';
import { runSettlement, closeExpiredSignals } from './services/settlementEngine';
import { updateDailySummary } from './services/dailySummary';
import { startScheduler } from './services/scheduler';
import {
  getMarketClock,
  getMarketSessions,
  classifySignal,
  getAnalysisSchedule,
  applyScanWeight,
  formatMarketDateTime,
  formatMarketDateTimeShort,
  MARKET_TZ_LABEL_AR,
  type MarketClock,
  type AnalysisSchedule,
} from './services/marketClock';
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
import { MobileNav, DesktopNav, HeaderActions, type TabId } from './components/navigation/AppNav';
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

  // API Configuration.
  // SECURITY: no key is ever read from or written to localStorage. The provider
  // selection is a UI preference only; credentials live in server env vars.
  const [apiConfig, setApiConfig] = useState<ApiConfig>(() => {
    try {
      const saved = localStorage.getItem('alphafx_provider_pref');
      const provider = saved ? JSON.parse(saved)?.provider : 'twelvedata';
      return { provider: provider || 'twelvedata', apiKey: '', isCustomConnected: true };
    } catch {
      return { provider: 'twelvedata', apiKey: '', isCustomConnected: true };
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
      // BUGFIX (the reported bug): the guard compared the stored signal's UTC
      // date against `new Date().toISOString()` — the UTC date — while the rest
      // of the app spoke Cairo time. Worse, when the dates did NOT match it fell
      // through to `INITIAL_TODAY_SIGNALS`, which was itself stamped with
      // today's date at a hard-coded 07:30Z. So on a Saturday the app happily
      // re-seeded "today's opportunities" for a closed market.
      //
      // Now: the guard uses the Cairo calendar day, and the fallback is
      // `buildSeedSignals()`, which knows the market is shut and returns
      // explicitly EXPIRED setups instead of fake live ones.
      const clock = getMarketClock();
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.cleared) return [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Keep only signals that are genuinely usable today: drop anything
          // whose activation is in the future or belongs to a previous session.
          const usable = parsed.filter((s: Signal) => {
            const f = classifySignal(s, clock.nowMs);
            return f !== 'invalid_future' && f !== 'stale';
          });
          if (usable.length > 0) return usable;
        }
      }
      return buildSeedSignals(clock.nowMs);
    } catch {
      return buildSeedSignals();
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

  // Countdown to the next H4 candle close (the analysis trigger)
  const [sessionCountdown, setSessionCountdown] = useState<string>('--:--:--');
  const [gmtTimeStr, setGmtTimeStr] = useState<string>('');
  // Full H4 schedule: last scan, next scan, priority, weekend deferral.
  const [analysisSchedule, setAnalysisSchedule] = useState<AnalysisSchedule>(() =>
    getAnalysisSchedule()
  );
  // Live market clock — drives the closed-market banner and the session chips.
  const [marketClock, setMarketClock] = useState<MarketClock>(() => getMarketClock());

  // Save provider preference only — never the credential itself.
  const handleSaveApiConfig = (newConfig: ApiConfig) => {
    const safeConfig: ApiConfig = { ...newConfig, apiKey: '' };
    setApiConfig(safeConfig);
    try {
      localStorage.setItem('alphafx_provider_pref', JSON.stringify({ provider: safeConfig.provider }));
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
  /**
   * Runs the analysis engine.
   *
   * `scanWeight` is the H4 session priority multiplier supplied by the
   * scheduler: 1.15 for the 08:00 UTC London-open candle, 1.08 for the 12:00
   * UTC London/New York overlap, 1 for the routine closes. Manual runs from the
   * UI pass nothing and therefore use 1.
   */
  const handleRunAnalysisEngine = useCallback(async (scanWeight: number = 1) => {
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

      // Apply the session weight to freshly discovered opportunities only.
      // Existing signals keep the confidence they were published with — a
      // later scan must never silently re-grade a live recommendation.
      const weightedNew = newSignals.map((s) => {
        if (scanWeight === 1) return s;
        const boosted = applyScanWeight(s.confidence, scanWeight);
        return {
          ...s,
          confidence: boosted,
          isTopOpportunity: boosted >= 85,
        };
      });

      const validSignals = [...weightedNew, ...updatedSignals].filter(
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

  // Live feed status.
  // SECURITY: the browser no longer opens a provider WebSocket directly, because
  // that required putting the provider token in the URL. All market data now
  // flows through /api/market/* on our own server.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/market/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((health) => {
        if (cancelled || !health) return;
        setWsTokenMissing(!health.alltick);
        setIsLiveConnected(Boolean(health.alltick || health.twelvedata || health.finnhub));
      })
      .catch(() => {
        if (!cancelled) setWsTokenMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Immediate live rates refresh on mount
  useEffect(() => {
    refreshRates();
  }, [refreshRates]);

  // Fetch the initial XAU/USD candle through our own proxy (no client token).
  useEffect(() => {
    fetchRealXauUsdCandle().catch(() => {
      /* the rates endpoint already reports provider health */
    });
  }, []);

  // Load persisted signals from Supabase on mount
  useEffect(() => {
    getTodaySignals().then((dbSignals) => {
      if (dbSignals && dbSignals.length > 0) {
        setTodaySignals(dbSignals);
        console.log("Loaded persisted signals from Supabase:", dbSignals.length);
      }
    });
  }, []);

  // Initialize automated trading lifecycle scheduler (H4 candle closes, hourly settlement, Cairo 23:00 EOD)
  useEffect(() => {
    const cleanup = startScheduler({
      onRunAnalysis: async (closeMs, weight) => {
        console.log(
          `[Scheduler] Executing H4 close analysis for ${new Date(closeMs).toISOString()} (weight ${weight})`
        );
        await handleRunAnalysisEngine(weight);
      },
      onScheduleChange: (schedule) => setAnalysisSchedule(schedule),
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
      // BUGFIX: when the week opens or closes, the list must change immediately.
      // On close we re-seed as EXPIRED; on open we clear the stale set so the
      // engine can produce genuine opportunities for the new session.
      onMarketStateChange: (isOpen) => {
        const clock = getMarketClock();
        setMarketClock(clock);
        if (!isOpen) {
          setTodaySignals(buildSeedSignals(clock.nowMs));
        } else {
          setTodaySignals((prev) =>
            prev.filter((s) => classifySignal(s, clock.nowMs) !== 'stale')
          );
        }
      },
    });

    return cleanup;
  }, [handleRunAnalysisEngine]);

  // Initial load effect: fetch real rates and sync existing signals (Strictly NO overwrite of entry/targets)
  useEffect(() => {
    refreshRates();
  }, [refreshRates]);

  // H4 candle-close countdown
  // BUGFIX: the countdown used to target a single daily 07:30 milestone while
  // the engine now scans every H4 close. It also counted straight through the
  // weekend to a Saturday "generation" that could not happen. Both are fixed:
  // the target comes from getAnalysisSchedule(), which returns the next H4
  // close while open and the week-open instant while closed.
  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      const clock = getMarketClock(now.getTime());
      setMarketClock(clock);

      setGmtTimeStr(
        now.toLocaleTimeString('en-GB', {
          timeZone: 'UTC',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }) + ' GMT'
      );

      const schedule = getAnalysisSchedule(now.getTime());
      setAnalysisSchedule(schedule);

      const diffMs = schedule.msUntilNext;
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
    localStorage.removeItem('alphafx_provider_pref');
    // Purge any credential left behind by an older build of this app.
    localStorage.removeItem('alphafx_api_config');
    setTodaySignals(buildSeedSignals());
    setHistoricalSignals(HISTORICAL_SIGNALS);
    setApiConfig({ provider: 'demo', apiKey: '', isCustomConnected: false });
    setToastMessage({
      title: 'تمت استعادة البيانات الافتراضية',
      desc: 'تمت إعادة ضبط السجلات وقائمة التوصيات الأولية',
    });
    setTimeout(() => setToastMessage(null), 3000);
  };

  /**
   * Header "تصفير وإعادة فحص" action.
   *
   * Identical behaviour to the old inline handler, extracted so the header can
   * stay presentational. Kept out of the reset-data path above because it also
   * re-runs the analysis engine.
   */
  const handleResetAndRescan = useCallback(() => {
    localStorage.removeItem('alphafx_today_signals');
    setTodaySignals([]);
    setToastMessage({
      title: 'تم مسح البيانات',
      desc: 'تم مسح كافة الصفقات القديمة. ابدأ الآن بفحص السوق.',
    });
    handleRunAnalysisEngine();
  }, [handleRunAnalysisEngine]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500/20 selection:text-amber-200">
      {/* Persistent Regulatory Risk Banner.
          On a phone the single truncated line cut the sentence off mid-word;
          the text now wraps to two/three lines and the link stays reachable. */}
      <div className="bg-amber-950/40 border-b border-amber-900/40 text-amber-300/90 px-3 sm:px-4 py-1.5 text-[11px] sm:text-xs">
        <div className="max-w-7xl mx-auto flex items-start sm:items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-start sm:items-center gap-2 min-w-0">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5 sm:mt-0" />
            <span className="leading-snug line-clamp-2 sm:line-clamp-none">
              <strong>إخلاء مسؤولية تنظيمي:</strong> التطبيق يقدم توصيات ونماذج تحليلية فنية فقط. لا يتصل بأي وسيط مالي ولا ينفذ صفقات. القرار الاستثماري النهائي يقع على عاتق المستخدم وحده.
            </span>
          </div>
          <button
            onClick={() => setShowDisclaimerModal(true)}
            className="shrink-0 underline hover:text-white transition-colors cursor-pointer min-h-[36px] px-1 flex items-center text-[11px] sm:text-xs"
          >
            التفاصيل
          </button>
        </div>
      </div>

      {/* ── Top Bar ────────────────────────────────────────────────
           Rebuilt for phones. The old header packed the wordmark, two
           labelled action buttons and an 11-item tab strip into one row;
           at 375px that row measured 499px and pushed 140px of the document
           off-screen. Now the top row is wordmark + icon-only actions, and
           navigation gets its own rows via <MobileNav> / <DesktopNav>. */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 px-3 sm:px-6 lg:px-8 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          {/* Wordmark — truncates instead of widening the row */}
          <div className="flex items-center gap-2 shrink min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-amber-300 flex items-center justify-center text-slate-950 font-extrabold text-sm shadow-md shrink-0">
              αFX
            </div>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="text-base sm:text-lg font-bold tracking-tight text-white font-mono truncate"
            >
              <span className="hidden sm:inline">AlphaFX Signals</span>
              <span className="sm:hidden">AlphaFX</span>
            </a>
          </div>

          <DesktopNav activeTab={activeTab} onChange={setActiveTab} />

          <div className="ms-auto flex items-center shrink-0">
            <HeaderActions
              isRunning={isRunningEngine}
              onRun={handleRunAnalysisEngine}
              onReset={handleResetAndRescan}
            />
          </div>
        </div>

        <MobileNav activeTab={activeTab} onChange={setActiveTab} />
      </header>

      {/* Continuous Provider Status Banner with Red Alert on Token Failure.
          The raw provider error is technical English; on a phone it was mixed
          inline with the Arabic sentence and pushed the layout around. It is
          now its own LTR line, truncated, with the full text on hover. */}
      {providerHealth.alltick.status === 'red' ? (
        <div className="bg-rose-950/80 border-b border-rose-800/60 text-rose-200 px-3 sm:px-4 py-2 text-xs font-mono">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0 mt-1 sm:mt-0"></span>
              <span className="font-bold text-rose-300 shrink-0">🔴 تنبيه مزود AllTick:</span>
              <span
                dir="ltr"
                title={providerHealth.alltick.message}
                className="text-rose-200/80 text-[11px] truncate min-w-0 flex-1 text-left"
              >
                {providerHealth.alltick.message}
              </span>
            </div>
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0 mt-1 sm:mt-0"></span>
              <span className="text-emerald-300 font-bold shrink-0">🟢 البث الحي الاحتياطي:</span>
              <span className="text-slate-300">الفرص تعمل وتتحدث كل {autoRefreshIntervalSecs} ثانية.</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-950/60 border-b border-emerald-800/40 text-emerald-200 px-3 sm:px-4 py-1.5 text-xs font-mono">
          <div className="max-w-7xl mx-auto flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"></span>
            <span className="font-bold text-emerald-300 shrink-0">🟢 مزود AllTick:</span>
            <span className="truncate">بث الأسعار الحية يعمل باستمرار</span>
          </div>
        </div>
      )}

      {/* Live Market Rates Mini Ticker Bar.
          Previously the whole bar was `overflow-x-auto`, which dragged the
          provider pill off-screen with the prices and left the page scroller
          active. Now only the price list scrolls. */}
      <div className="bg-slate-900/90 border-b border-slate-800/80 px-3 sm:px-8 py-2 text-xs">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
            <button
              onClick={() => setShowLiveSourceModal(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer max-w-full min-w-0 ${
                providerHealth.alltick.status === 'red'
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25'
                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
              }`}
            >
              <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${providerHealth.alltick.status === 'red' ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400 animate-pulse'}`}></span>
              <span className="truncate">
                {providerHealth.alltick.status === 'red'
                  ? '🔴 AllTick (401) · 🟢 البث الحي متصل'
                  : '🟢 بث حي متصل ومستمر'}
              </span>
              <Info className="w-3 h-3 ml-0.5 shrink-0" />
            </button>
            <span className="text-slate-400 text-[11px] hidden sm:inline">
              الأسعار الحية اللحظية:
            </span>
          </div>

          <div className="scroll-hint flex items-center gap-3 sm:gap-4 font-mono text-[11px] text-slate-300 overflow-x-auto no-scrollbar whitespace-nowrap -mx-3 px-3 sm:mx-0 sm:px-0 py-0.5">
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
                className="tap-h flex items-center justify-center px-1.5 hover:text-white text-slate-400 transition-colors rounded-lg"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Viewport Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6 relative">
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
          <div className="fixed top-20 sm:top-24 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-50 bg-slate-900 border border-amber-500/50 text-white px-4 sm:px-5 py-3 rounded-xl shadow-2xl flex items-center justify-between gap-3 sm:gap-4 sm:max-w-md mx-auto animate-in fade-in slide-in-from-top-4">
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
            {/* ── Market-closed banner ──────────────────────────────────
                BUGFIX (the reported bug): the app had no concept of a closed
                market, so on a Saturday it presented Friday's setups as
                "today's opportunities" with a Saturday activation time.
                This banner states the truth and explains what the list below
                actually contains. */}
            {!marketClock.isOpen && (
              <div className="rounded-2xl border border-amber-600/50 bg-amber-950/30 p-4 sm:p-5 shadow-xl">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-amber-300">
                        السوق مغلق الآن — لا توجد فرص جديدة اليوم
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40 font-mono">
                        MARKET CLOSED
                      </span>
                    </div>
                    <p className="text-xs text-amber-100/80 mt-1 leading-relaxed">
                      {marketClock.closedReasonAr}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] font-mono text-amber-200/90">
                      <span>
                        🕐 الآن: {formatMarketDateTime(new Date(marketClock.nowMs).toISOString())} ({MARKET_TZ_LABEL_AR})
                      </span>
                      <span>
                        🔓 يُفتح التداول: {formatMarketDateTime(new Date(marketClock.nextOpenMs).toISOString())}
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-100/60 mt-2 leading-relaxed">
                      الإشارات المعروضة أدناه هي آخر إعدادات صادرة من الجلسة السابقة، وتم
                      وسمها <strong className="text-amber-200">«منتهية»</strong> — وليست فرصاً
                      قابلة للتنفيذ الآن. لن يُولّد المحرك أي فرصة جديدة حتى إعادة فتح السوق.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* H4 Scan Schedule Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
              {/* Next H4 close countdown */}
              <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-xs font-semibold text-amber-400">
                      الفحص القادم — إغلاق شمعة 4 ساعات
                    </span>
                    <span className="text-[11px] text-slate-400">
                      (00:00 · 04:00 · 08:00 · 12:00 · 16:00 · 20:00 UTC)
                    </span>
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
                    <span className="text-xl sm:text-2xl font-bold font-mono text-white tabular-nums">
                      {sessionCountdown}
                    </span>
                    <span className="text-[11px] sm:text-xs text-slate-400 font-mono">
                      متبقي · الآن {gmtTimeStr}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
                        analysisSchedule.nextPriority.priority === 'london_open'
                          ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                          : analysisSchedule.nextPriority.priority === 'overlap'
                          ? 'bg-violet-500/15 border-violet-500/40 text-violet-300'
                          : 'bg-slate-800/80 border-slate-700 text-slate-400'
                      }`}
                    >
                      {analysisSchedule.nextPriority.labelAr}
                    </span>
                    {analysisSchedule.deferredFromWeekend && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/15 border-amber-500/40 text-amber-300 font-medium">
                        مؤجَّل من العطلة
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Last scan + timezone */}
              <div className="flex flex-col gap-1.5 text-[11px] sm:text-xs border-t lg:border-t-0 lg:border-r border-slate-800 pt-3 lg:pt-0 lg:pr-4 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-slate-500 shrink-0">آخر فحص:</span>
                  <span className="text-slate-300 font-mono">
                    {formatMarketDateTimeShort(new Date(analysisSchedule.lastCheckMs).toISOString())}
                  </span>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-slate-500 shrink-0">الفحص القادم:</span>
                  <span className="text-slate-300 font-mono">
                    {formatMarketDateTimeShort(new Date(analysisSchedule.nextCheckMs).toISOString())}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500">
                  جميع الأوقات بـ {MARKET_TZ_LABEL_AR} مع إزاحة صريحة
                </div>
              </div>

              {/* World Sessions Status — computed live, not hard-coded */}
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                {getMarketSessions(marketClock.nowMs).map((sess) => (
                  <div
                    key={sess.id}
                    className={`px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg border flex items-center gap-1.5 ${
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
                  className={`px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
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
                  className={`px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
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
                  className={`px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
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
                  className={`px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg font-medium transition-all flex items-center gap-1.5 ${
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
                    className={`px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 rounded-lg text-xs font-medium transition-all ${
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
                    className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-2 sm:py-0.5 min-h-[44px] sm:min-h-0 focus:outline-none focus:border-amber-400"
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
                  className="tap-h flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRunningEngine ? 'animate-spin' : ''}`} />
                  <span>{isRunningEngine ? 'جاري الفحص...' : '🔄 فحص السوق وتحديث الفرص الآن'}</span>
                </button>

                <button
                  onClick={handleRunSettlement}
                  disabled={isSettling}
                  title="فحص أسعار السوق الحالية لتفعيل المعلقات وحسم الأهداف ووقف الخسارة في Supabase"
                  className="tap-h flex items-center justify-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 whitespace-nowrap cursor-pointer disabled:opacity-50"
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
                  onClick={() => handleRunAnalysisEngine()}
                  disabled={isRunningEngine}
                  className="tap-h flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 whitespace-nowrap shrink-0"
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
                      // BUGFIX: this used the module-level INITIAL_TODAY_SIGNALS
                      // snapshot, which was frozen at page-load time and always
                      // claimed a 07:30 activation. Rebuild from the live clock
                      // so the reloaded set is honest about the current session.
                      const seeds = buildSeedSignals();
                      setTodaySignals(seeds);
                      try {
                        localStorage.setItem('alphafx_today_signals', JSON.stringify(seeds));
                      } catch {}
                      setToastMessage({
                        title: marketClock.isOpen
                          ? 'تم استعادة باقة توصيات اليوم'
                          : 'تم استعادة آخر إعدادات الجلسة السابقة',
                        desc: marketClock.isOpen
                          ? `تم تحميل ${seeds.length} فرصة تداول للذهب والعملات والنفط بنجاح`
                          : `السوق مغلق — تم تحميل ${seeds.length} إعداد موسوم «منتهية» من الجلسة السابقة`,
                      });
                      setTimeout(() => setToastMessage(null), 3000);
                    }}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-md flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>
                      {marketClock.isOpen ? 'تحميل فرص اليوم الأساسية' : 'تحميل إعدادات الجلسة السابقة'} (
                      {INITIAL_TODAY_SIGNALS.length} فرص)
                    </span>
                  </button>
                  <button
                    onClick={() => handleRunAnalysisEngine()}
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
              className="hover:text-slate-300 transition-colors min-h-[36px] flex items-center"
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
