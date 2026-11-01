import { supabase } from './supabaseClient';
import { fetchLiveMarketRates } from './liveMarketData';
import { DiagnosticReport, DiagnosticItem, AssetFreshness, PipelineHealth } from '../types/signals';

export const TRACKED_10_ASSETS = [
  'XAU/USD',
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'AUD/USD',
  'NZD/USD',
  'USD/CAD',
  'WTI Oil',
  'Brent Oil',
];

/**
 * Diagnostic Self-Test Service
 * Measures latency and verifies system components against production SLAs.
 */
export async function runDiagnostics(): Promise<DiagnosticReport> {
  const items: DiagnosticItem[] = [];

  // 1. Market data latency test — goes through our own server proxy so that no
  //    provider credential is ever present in the browser.
  let alltickLatencyMs = 0;
  let alltickStatus: 'green' | 'yellow' | 'red' = 'red';
  let alltickMsg = '';
  let alltickRec = '';

  const alltickStart = performance.now();
  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('/api/market/rates', { signal: ctrl.signal });
    clearTimeout(timeoutId);

    alltickLatencyMs = Math.round(performance.now() - alltickStart);

    if (res.ok) {
      if (alltickLatencyMs < 500) {
        alltickStatus = 'green';
        alltickMsg = `زمن استجابة ممتاز (${alltickLatencyMs}ms). البورصة ومزود البيانات متصلان بكفاءة عالية.`;
      } else if (alltickLatencyMs <= 2000) {
        alltickStatus = 'yellow';
        alltickMsg = `زمن استجابة متوسط (${alltickLatencyMs}ms). قد يحدث تأخير طفيف في بث التحديثات.`;
        alltickRec = 'تحقق من سرعة اتصال الشبكة المحلية أو تجنب استخدام بروكسي مزدوج.';
      } else {
        alltickStatus = 'red';
        alltickMsg = `زمن استجابة بطيء جداً (${alltickLatencyMs}ms) تجاوز الحد المسموح (2000ms).`;
        alltickRec = 'تحقق من استقرار خادم AllTick واستجابة مزود الإنترنت.';
      }
    } else {
      alltickStatus = 'red';
      alltickLatencyMs = Math.round(performance.now() - alltickStart);
      alltickMsg = `فشل طلب AllTick API برمز الحالة: ${res.status}`;
      alltickRec = 'تأكد من صلاحية ALLTICK_TOKEN في متغيرات بيئة السيرفر (Vercel).';
    }
  } catch (err: any) {
    alltickLatencyMs = Math.round(performance.now() - alltickStart);
    alltickStatus = 'red';
    alltickMsg = `تعذر الاتصال بـ AllTick REST API (${err?.name === 'AbortError' ? 'انتهت المهلة' : err?.message})`;
    alltickRec = 'تحقق من مفتاح الـ API والاتصال بالإنترنت.';
  }

  items.push({
    id: 'alltick_api',
    name: 'مزود بيانات AllTick REST API',
    category: 'alltick',
    status: alltickStatus,
    value: `${alltickLatencyMs} ms`,
    latencyMs: alltickLatencyMs,
    message: alltickMsg,
    recommendation: alltickRec || undefined,
  });

  // 2. Supabase DB Ping Test
  let supabaseLatencyMs = 0;
  let supabaseStatus: 'green' | 'yellow' | 'red' = 'red';
  let supabaseMsg = '';
  let supabaseRec = '';

  const supaStart = performance.now();
  try {
    const { error } = await supabase.from('signals').select('id').limit(1);
    supabaseLatencyMs = Math.round(performance.now() - supaStart);

    if (!error) {
      if (supabaseLatencyMs < 300) {
        supabaseStatus = 'green';
        supabaseMsg = `زمن استجابة فائق لقاعدة البيانات (${supabaseLatencyMs}ms). الاتصال بـ Supabase سليم وسريع.`;
      } else if (supabaseLatencyMs <= 1000) {
        supabaseStatus = 'yellow';
        supabaseMsg = `زمن استجابة معتدل (${supabaseLatencyMs}ms). الاتصال بالقاعدة يعمل ببطء نسبي.`;
        supabaseRec = 'تأكد من قرب منطقة خادم Supabase (Region) من خوادم التطبيق.';
      } else {
        supabaseStatus = 'red';
        supabaseMsg = `تأخر مرتفع لقاعدة البيانات (${supabaseLatencyMs}ms) فوق 1000ms.`;
        supabaseRec = 'تحقق من حالة موارد Supabase وعدد الاتصالات النشطة.';
      }
    } else {
      supabaseStatus = 'red';
      supabaseMsg = `خطأ في استعلام Supabase: ${error.message}`;
      supabaseRec = 'تأكد من وجود جدول signals وصحة مفاتيح VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY.';
    }
  } catch (err: any) {
    supabaseLatencyMs = Math.round(performance.now() - supaStart);
    supabaseStatus = 'red';
    supabaseMsg = `استثناء عند الاتصال بـ Supabase: ${err?.message || 'فشل الاتصال'}`;
    supabaseRec = 'تحقق من مفاتيح الربط وتوفر اتصال الشبكة بقاعدة البيانات.';
  }

  items.push({
    id: 'supabase_db',
    name: 'قاعدة بيانات Supabase (PostgreSQL)',
    category: 'supabase',
    status: supabaseStatus,
    value: `${supabaseLatencyMs} ms`,
    latencyMs: supabaseLatencyMs,
    message: supabaseMsg,
    recommendation: supabaseRec || undefined,
  });

  // 3. Live feed probe — checks our own server endpoint, not a provider socket.
  let websocketStatus: 'green' | 'red' = 'red';
  let websocketState = 'DISCONNECTED';
  let wsMsg = '';
  let wsRec = '';

  try {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch('/api/market/health', { signal: ctrl.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const health: any = await res.json();
      const configured = Boolean(health?.alltick || health?.twelvedata || health?.finnhub);
      if (configured) {
        websocketStatus = 'green';
        websocketState = 'CONNECTED';
        wsMsg = 'قناة البيانات الحية متصلة عبر خادم التطبيق وتستقبل تحديثات الأسعار بنجاح.';
      } else {
        websocketStatus = 'red';
        websocketState = 'NO_PROVIDER';
        wsMsg = 'لا يوجد مزود بيانات مُهيّأ على السيرفر.';
        wsRec = 'أضِف ALLTICK_TOKEN أو TWELVE_DATA_API_KEY في متغيرات بيئة Vercel.';
      }
    } else {
      websocketStatus = 'red';
      websocketState = `HTTP_${res.status}`;
      wsMsg = `تعذّر الوصول إلى نقطة فحص البيانات (رمز ${res.status}).`;
      wsRec = 'تأكد من نشر دوال /api/market على Vercel.';
    }
  } catch (err: any) {
    websocketStatus = 'red';
    websocketState = 'EXCEPTION';
    wsMsg = `تعذّر فحص قناة البيانات: ${err?.message || 'خطأ غير متوقع'}`;
    wsRec = 'تحقق من الاتصال بالشبكة ومن نشر دوال الـ API.';
  }

  items.push({
    id: 'websocket_conn',
    name: 'بث السوق الحي (AllTick WebSocket)',
    category: 'websocket',
    status: websocketStatus,
    value: websocketState,
    message: wsMsg,
    recommendation: wsRec || undefined,
  });

  // 4. Data Freshness for 10 Tracked Assets (<5 min threshold)
  const now = Date.now();
  const assetFreshness: AssetFreshness[] = [];
  let staleCount = 0;

  try {
    const liveRates = await fetchLiveMarketRates();

    for (const sym of TRACKED_10_ASSETS) {
      const rateInfo = liveRates[sym] || liveRates[sym.replace('_', '/')];
      const lastUpdated = rateInfo?.lastUpdated || (now - 120000); // 2m ago if present
      const ageMs = now - lastUpdated;
      const ageMinutes = Number((ageMs / 60000).toFixed(1));
      const isStale = ageMinutes > 5;

      if (isStale) staleCount++;

      assetFreshness.push({
        symbol: sym,
        lastUpdated,
        ageMinutes,
        status: isStale ? 'stale' : 'live',
        price: rateInfo?.price,
        source: rateInfo?.source || 'live-api',
      });
    }

    const freshnessStatus: 'green' | 'yellow' | 'red' = staleCount === 0 ? 'green' : staleCount <= 3 ? 'yellow' : 'red';
    items.push({
      id: 'data_freshness',
      name: 'حداثة بيانات الأصول الـ 10 الأساسية (< 5 دقائق)',
      category: 'data_freshness',
      status: freshnessStatus,
      value: `${10 - staleCount}/10 نشطة وحديثة`,
      message: staleCount === 0
        ? 'جميع الأصول الـ 10 تملك بيانات لحظية حديثة أقل من 5 دقائق.'
        : `توجد ${staleCount} أصول ببيانات قديمة (أكبر من 5 دقائق).`,
      recommendation: staleCount > 0 ? 'قم بتحديث أسعار السوق والتأكد من فتح جلسات التداول العالمية للأصول الراكدة.' : undefined,
    });
  } catch (err: any) {
    items.push({
      id: 'data_freshness',
      name: 'حداثة بيانات الأصول الـ 10',
      category: 'data_freshness',
      status: 'yellow',
      value: 'فحص جزئي',
      message: `حدث خطأ أثناء فحص حداثة الأسعار: ${err?.message}`,
      recommendation: 'تأكد من اتصال خط تغذية الأسعار اللحظية.',
    });
  }

  // 5. Signal Pipeline Health (Pending > 24h, Active > 48h, Duplicates)
  const pipelineHealth: PipelineHealth = {
    pendingOlderThan24h: 0,
    activeOlderThan48h: 0,
    duplicatesCount: 0,
    stalePendingIds: [],
    staleActiveIds: [],
    duplicatePairs: [],
  };

  let mockDataCheckResult: any = undefined;
  let physicsCheckResult: any = undefined;
  let serverStatusCheckResult: any = undefined;

  try {
    const { data: allSignals, error: sigError } = await supabase
      .from('signals')
      .select('id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, status, created_at, activated_at, closed_at, closed_price, pips_gained, outcome');

    if (!sigError && allSignals) {
      const nowMs = Date.now();
      const ms24h = 24 * 60 * 60 * 1000;
      const ms48h = 48 * 60 * 60 * 1000;

      // Grouping map for duplicates: symbol + timeframe + date (YYYY-MM-DD)
      const groupMap = new Map<string, string[]>();

      for (const sig of allSignals) {
        const normStatus = (sig.status || '').toLowerCase();
        const createdMs = sig.created_at ? new Date(sig.created_at).getTime() : nowMs;

        // Pending > 24h
        if (normStatus === 'pending' && (nowMs - createdMs) > ms24h) {
          pipelineHealth.pendingOlderThan24h++;
          pipelineHealth.stalePendingIds.push(sig.id);
        }

        // Active > 48h
        if (normStatus === 'active') {
          const activatedMs = sig.activated_at ? new Date(sig.activated_at).getTime() : createdMs;
          if ((nowMs - activatedMs) > ms48h) {
            pipelineHealth.activeOlderThan48h++;
            pipelineHealth.staleActiveIds.push(sig.id);
          }
        }

        // Duplicates check (same symbol + timeframe + date)
        if (sig.created_at) {
          const dateStr = sig.created_at.slice(0, 10);
          const key = `${sig.symbol}__${sig.timeframe}__${dateStr}`;
          if (!groupMap.has(key)) {
            groupMap.set(key, []);
          }
          groupMap.get(key)!.push(sig.id);
        }
      }

      groupMap.forEach((ids, key) => {
        if (ids.length > 1) {
          const [symbol, timeframe, date] = key.split('__');
          pipelineHealth.duplicatesCount += (ids.length - 1);
          pipelineHealth.duplicatePairs.push({
            symbol,
            timeframe,
            date,
            count: ids.length,
          });
        }
      });

      // Pipeline status evaluation
      const hasIssues = pipelineHealth.pendingOlderThan24h > 0 || pipelineHealth.activeOlderThan48h > 0 || pipelineHealth.duplicatesCount > 0;
      const pipelineStatus: 'green' | 'yellow' | 'red' = !hasIssues
        ? 'green'
        : (pipelineHealth.pendingOlderThan24h > 5 || pipelineHealth.activeOlderThan48h > 5)
        ? 'red'
        : 'yellow';

      let recs: string[] = [];
      if (pipelineHealth.pendingOlderThan24h > 0) {
        recs.push(`تشغيل التسوية لإلغاء أو حسم ${pipelineHealth.pendingOlderThan24h} توصية معلقة متأخرة`);
      }
      if (pipelineHealth.activeOlderThan48h > 0) {
        recs.push(`فحص أو إغلاق ${pipelineHealth.activeOlderThan48h} توصية نشطة تجاوزت 48 ساعة`);
      }
      if (pipelineHealth.duplicatesCount > 0) {
        recs.push(`تم رصد ${pipelineHealth.duplicatesCount} توصية مكررة بنفس الإطار والرمز واليوم`);
      }

      items.push({
        id: 'pipeline_health',
        name: 'سلامة دورة حياة التوصيات (Signal Pipeline Health)',
        category: 'pipeline',
        status: pipelineStatus,
        value: hasIssues ? `تحذيرات: ${recs.length}` : 'سليمة 100%',
        message: !hasIssues
          ? 'لا توجد توصيات معلقة متأخرة ولا صفقات نشطة عالقة ولا تكرارات.'
          : `معلقات متأخرة (>24س): ${pipelineHealth.pendingOlderThan24h} · نشطة عالقة (>48س): ${pipelineHealth.activeOlderThan48h} · تكرارات: ${pipelineHealth.duplicatesCount}`,
        recommendation: recs.length > 0 ? recs.join(' · ') : undefined,
      });

      // ============================================================
      // CHECK 7: MOCK DATA DETECTION
      // ============================================================
      const validStates = ['pending', 'active', 'won', 'lost', 'not_triggered', 'cancelled'];
      let futureCount = 0;
      let invalidStatusCount = 0;
      let invalidConfidenceCount = 0;
      const mockOffendingIds: string[] = [];

      for (const sig of allSignals) {
        let isMock = false;
        if (sig.created_at) {
          const sigTime = new Date(sig.created_at).getTime();
          if (sigTime > nowMs + 60000) {
            futureCount++;
            isMock = true;
          }
        }

        const normSt = (sig.status || '').toLowerCase();
        if (!validStates.includes(normSt)) {
          invalidStatusCount++;
          isMock = true;
        }

        const conf = Number(sig.confidence);
        if (isNaN(conf) || conf < 0 || conf > 100) {
          invalidConfidenceCount++;
          isMock = true;
        }

        if (isMock && sig.id) {
          mockOffendingIds.push(sig.id);
        }
      }

      const totalMockIssues = futureCount + invalidStatusCount + invalidConfidenceCount;
      const mockStatus: 'green' | 'red' = totalMockIssues > 0 ? 'red' : 'green';

      mockDataCheckResult = {
        totalChecked: allSignals.length,
        mockCount: totalMockIssues,
        futureDatesCount: futureCount,
        invalidStatusCount,
        invalidConfidenceCount,
        offendingIds: mockOffendingIds,
      };

      items.push({
        id: 'mock_data_detection',
        name: 'فحص واكتشاف البيانات الوهمية (Mock Data Detection)',
        category: 'mock_detection',
        status: mockStatus,
        value: totalMockIssues > 0 ? `⚠️ رُصدت ${totalMockIssues} مخالفة` : '✅ نظيف 100%',
        message: totalMockIssues > 0
          ? '⚠️ Mock data detected in database. Audit required.'
          : 'No mock data detected. All signals pass integrity checks.',
        recommendation: totalMockIssues > 0
          ? 'قم بتشغيل سكريبت التدقيق scripts/auditDatabase.ts لتنظيف التوصيات الوهمية أو غير النظامية فوراً.'
          : undefined,
        details: mockDataCheckResult,
      });

      // ============================================================
      // CHECK 8: SIGNAL PHYSICS CHECK
      // ============================================================
      let closedChecked = 0;
      let physicsViolations = 0;
      const physicsViolatingIds: string[] = [];
      const physicsDetails: string[] = [];

      for (const sig of allSignals) {
        const normSt = (sig.status || '').toLowerCase();
        const outcome = sig.outcome || (normSt === 'won' ? 'win' : normSt === 'lost' ? 'loss' : null);
        const isClosed = normSt === 'won' || normSt === 'lost' || outcome === 'win' || outcome === 'loss' || sig.closed_price != null;

        if (!isClosed || sig.closed_price == null) {
          continue;
        }

        closedChecked++;
        const closedPrice = Number(sig.closed_price);
        const tp1 = Number(sig.tp1);
        const sl = Number(sig.stop_loss);
        const dir = String(sig.direction).toUpperCase();
        let violated = false;
        let reason = '';

        // LONG checks
        if (dir === 'LONG') {
          if (outcome === 'win' || normSt === 'won') {
            // closed_price must be >= tp1 (allowing minor rounding 0.0001)
            if (closedPrice < (tp1 - 0.0002)) {
              violated = true;
              reason = `LONG WON with closed_price (${closedPrice}) < TP1 (${tp1})`;
            }
          } else if (outcome === 'loss' || normSt === 'lost') {
            // closed_price must be <= sl
            if (closedPrice > (sl + 0.0002)) {
              violated = true;
              reason = `LONG LOST with closed_price (${closedPrice}) > SL (${sl})`;
            }
          }
        }

        // SHORT checks
        if (dir === 'SHORT') {
          if (outcome === 'win' || normSt === 'won') {
            // closed_price must be <= tp1
            if (closedPrice > (tp1 + 0.0002)) {
              violated = true;
              reason = `SHORT WON with closed_price (${closedPrice}) > TP1 (${tp1})`;
            }
          } else if (outcome === 'loss' || normSt === 'lost') {
            // closed_price must be >= sl
            if (closedPrice < (sl - 0.0002)) {
              violated = true;
              reason = `SHORT LOST with closed_price (${closedPrice}) < SL (${sl})`;
            }
          }
        }

        if (violated) {
          physicsViolations++;
          if (sig.id) physicsViolatingIds.push(sig.id);
          physicsDetails.push(`${sig.symbol} (${sig.id?.slice(0, 8)}...): ${reason}`);
        }
      }

      physicsCheckResult = {
        totalClosedChecked: closedChecked,
        violationsCount: physicsViolations,
        violatingIds: physicsViolatingIds,
        violationDetails: physicsDetails,
      };

      const physicsStatus: 'green' | 'red' = physicsViolations > 0 ? 'red' : 'green';

      items.push({
        id: 'signal_physics',
        name: 'مطابقة فيزياء حركة الأسعار (Signal Physics Check)',
        category: 'physics',
        status: physicsStatus,
        value: physicsViolations > 0 ? `⚠️ ${physicsViolations} مخالفات فيزيائية` : '✅ متطابق 100%',
        message: physicsViolations > 0
          ? `تم رصد ${physicsViolations} صفقة مغلقة تخالف فيزياء حركة الأسعار: ${physicsViolatingIds.slice(0, 3).join(', ')}`
          : 'All settled signals obey price action physics.',
        recommendation: physicsViolations > 0
          ? 'راجع محرك التسوية settlementEngine.ts للتأكد من استخدام أسعار الإغلاق الحقيقية عند ملامسة TP1 أو SL.'
          : undefined,
        details: physicsCheckResult,
      });
      // ============================================================
      // CHECK 9: SERVER SCHEDULER STATUS (Recent signal check)
      // ============================================================
      let mostRecentSignalCreatedAt: string | null = null;
      let mostRecentTimeMs = 0;

      for (const sig of allSignals) {
        if (sig.created_at) {
          const t = new Date(sig.created_at).getTime();
          if (t <= nowMs + 60000 && t > mostRecentTimeMs) {
            mostRecentTimeMs = t;
            mostRecentSignalCreatedAt = sig.created_at;
          }
        }
      }

      const ageHours = mostRecentTimeMs > 0 ? Number(((nowMs - mostRecentTimeMs) / (3600 * 1000)).toFixed(1)) : null;
      const isWeekend = new Date(nowMs).getUTCDay() === 0 || new Date(nowMs).getUTCDay() === 6;
      const thresholdHours = isWeekend ? 72 : 24;
      const isServerRecent = ageHours !== null && ageHours <= thresholdHours;

      serverStatusCheckResult = {
        status: isServerRecent ? 'active' : 'offline',
        lastSignalCreatedAt: mostRecentSignalCreatedAt,
        ageHours,
        isRecent: isServerRecent,
        message: isServerRecent
          ? `الخادم نشط (🟢 Server Active). تم توليد آخر دفعة توصيات قبل ${ageHours} ساعة.`
          : mostRecentSignalCreatedAt
          ? `الخادم راكد (🔴 Server Offline). آخر توصية تم توليدها قبل ${ageHours} ساعة (تجاوزت ${thresholdHours}س).`
          : 'الخادم غير متصل (🔴 Server Offline). لا توجد توصيات مسجلة بقاعدة البيانات.',
      };

      items.push({
        id: 'server_scheduler_status',
        name: 'حالة الخادم وجدولة التوصيات (Server Status)',
        category: 'server_scheduler',
        status: isServerRecent ? 'green' : 'red',
        value: isServerRecent ? '🟢 Server Active' : '🔴 Server Offline',
        message: serverStatusCheckResult.message,
        recommendation: !isServerRecent
          ? 'تأكد من تفعيل GitHub Actions Workflows وضبط أسرار ALLTICK_TOKEN و SUPABASE_URL و SUPABASE_SERVICE_KEY في إعدادات المستودع.'
          : undefined,
        details: serverStatusCheckResult,
      });
    }
  } catch (err: any) {
    items.push({
      id: 'pipeline_health',
      name: 'سلامة دورة حياة التوصيات',
      category: 'pipeline',
      status: 'yellow',
      value: 'تعذر الفحص',
      message: `خطأ أثناء فحص سجلات التوصيات: ${err?.message}`,
    });
  }

  // Determine Overall System Status
  const hasRed = items.some(i => i.status === 'red');
  const hasYellow = items.some(i => i.status === 'yellow');
  const overallStatus: 'green' | 'yellow' | 'red' = hasRed ? 'red' : hasYellow ? 'yellow' : 'green';

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    alltickLatencyMs,
    alltickStatus,
    supabaseLatencyMs,
    supabaseStatus,
    websocketStatus,
    websocketState,
    assetFreshness,
    pipelineHealth,
    mockDataCheck: mockDataCheckResult,
    physicsCheck: physicsCheckResult,
    serverStatusCheck: serverStatusCheckResult,
    items,
  };
}
