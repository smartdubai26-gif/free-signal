import fs from 'fs';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { TickAggregator } from './src/services/msi/liveStreamAggregator';
import { TwelveDataWebSocket } from './src/services/msi/tdConnection';
import { GapReconciler } from './src/services/msi/gapReconciler';
import { calculateVolumeProfile } from './src/services/msi/volumeProfileEngine';
import { calculatePriceAction } from './src/services/msi/priceActionEngine';
import { calculateAnchoredVWAP } from './src/services/msi/anchoredVwapEngine';
import { calculateOrderFlow } from './src/services/msi/orderFlowEngine';
import { evaluateConfluence, buildOpportunity } from './src/services/msi/confluenceEngine';
import { DataProvenance, MSITimeframe } from './src/types/msi';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  loadOpportunities();
  const app = express();
  const port = 3000;

  app.use(express.json());

  const ALLOWED_SYMBOLS = new Set([
    'EUR/USD',
    'XAU/USD',
    'GBP/USD',
    'USD/JPY',
    'AUD/USD',
    'USD/CAD',
    'USD/CHF',
    'NZD/USD',
  ]);
  const ALLOWED_INTERVALS = new Set(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']);
  const ALLOWED_TD_INTERVALS = new Set(['1min', '5min', '15min', '30min', '1h', '4h', '1day']);

  // API Proxy for Twelve Data
  app.get('/api/msi/time_series', async (req, res) => {
    const { symbol, interval, outputsize } = req.query;
    
    // 1. Parameter Validation & Allowlist Enforcement
    if (!symbol || !interval || !outputsize) {
      return res.status(400).json({ error: 'Missing required query parameters: symbol, interval, outputsize' });
    }

    const sym = String(symbol).toUpperCase();
    const intv = String(interval).toLowerCase();
    const size = parseInt(String(outputsize), 10);

    if (!ALLOWED_SYMBOLS.has(sym)) {
      return res.status(400).json({ error: 'Invalid or unsupported trading symbol' });
    }

    if (!ALLOWED_TD_INTERVALS.has(intv)) {
      return res.status(400).json({ error: 'Invalid or unsupported timeframe interval' });
    }

    if (isNaN(size) || size < 1 || size > 500) {
      return res.status(400).json({ error: 'outputsize must be an integer between 1 and 500' });
    }

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Internal server configuration error' });
    }
    
    // 2. Harden URL: Build URL explicitly to prevent external URL manipulation with UTC timezone
    const baseUrl = 'https://api.twelvedata.com/time_series';
    const params = new URLSearchParams({
      symbol: sym,
      interval: intv,
      outputsize: String(size),
      timezone: 'UTC',
      apikey: apiKey,
    });
    const url = `${baseUrl}?${params.toString()}`;

    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (!response.ok) {
        // 3. Sanitize Provider Error: Mask potential secrets or excessive details
        return res.status(response.status).json({ error: 'Provider request failed' });
      }
      res.json(data);
    } catch (err) {
      res.status(502).json({ error: 'Failed to communicate with data provider' });
    }
  });

  const aggregator = new TickAggregator();
  const gapReconciler = new GapReconciler(aggregator);

  // Endpoint to inspect candle store (Phase 17 Audit: Input sanitization, allowlists, resource bounds)
  app.get('/api/msi/candles', (req, res) => {
    const { symbol, interval, limit } = req.query;
    if (!symbol || !interval) {
      return res.status(400).json({ error: 'Missing required query parameters: symbol, interval' });
    }
    const sym = String(symbol).toUpperCase();
    const intv = String(interval).toUpperCase();

    if (!ALLOWED_SYMBOLS.has(sym)) {
      return res.status(400).json({ error: 'Invalid or unsupported trading symbol' });
    }
    if (!ALLOWED_INTERVALS.has(intv)) {
      return res.status(400).json({ error: 'Invalid or unsupported interval' });
    }

    const maxLimit = limit ? Math.min(Math.max(1, parseInt(String(limit), 10) || 100), 200) : 100;

    const fullHistory = aggregator.getCandleHistory(sym, intv);
    const history = fullHistory.slice(-maxLimit);
    const active = aggregator.getActiveCandle(sym, intv);
    const lastFinalized = aggregator.getLastFinalizedCandle(sym, intv);
    res.json({
      symbol: sym,
      interval: intv,
      count: history.length,
      history,
      active,
      lastFinalized,
    });
  });

  // Endpoint to inspect unrecovered data gaps and interval completeness
  app.get('/api/msi/gaps', (req, res) => {
    const { symbol, interval, from, to } = req.query;
    if (!symbol || !interval) {
      return res.status(400).json({ error: 'Missing required query parameters: symbol, interval' });
    }
    const sym = String(symbol).toUpperCase();
    const intv = String(interval).toUpperCase();

    if (!ALLOWED_SYMBOLS.has(sym)) {
      return res.status(400).json({ error: 'Invalid or unsupported trading symbol' });
    }
    if (!ALLOWED_INTERVALS.has(intv)) {
      return res.status(400).json({ error: 'Invalid or unsupported interval' });
    }

    const fromTime = from ? Number(from) : Date.now() - 3600000;
    const toTime = to ? Number(to) : Date.now();

    if (isNaN(fromTime) || isNaN(toTime) || fromTime > toTime) {
      return res.status(400).json({ error: 'Invalid time bounds: from must be <= to' });
    }

    // Protect against resource exhaustion: maximum query window of 30 days
    const MAX_QUERY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    if (toTime - fromTime > MAX_QUERY_WINDOW_MS) {
      return res.status(400).json({ error: 'Requested time window exceeds maximum limit of 30 days' });
    }

    const gaps = aggregator.getDataGaps(sym, intv);
    const isComplete = aggregator.isIntervalComplete(sym, intv, fromTime, toTime);
    res.json({ symbol: sym, interval: intv, gaps, isComplete, fromTime, toTime });
  });

  // =========================================================================
  // MSI SUPERVISED PAPER TRADING ENGINE (Phase 20)
  // Strictly PAPER MODE: Zero broker connection, zero order submission.
  // =========================================================================
  let tdWs: TwelveDataWebSocket;
  const paperOpportunities: any[] = [];
  const PERSISTENCE_FILE = './paper_opportunities.json';
  
  function saveOpportunities() {
    try {
      fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(paperOpportunities));
    } catch (e) { console.error('Failed to persist opportunities:', e); }
  }

  function loadOpportunities() {
    try {
      if (fs.existsSync(PERSISTENCE_FILE)) {
        const data = JSON.parse(fs.readFileSync(PERSISTENCE_FILE, 'utf-8'));
        paperOpportunities.push(...data);
      }
    } catch (e) { console.error('Failed to load opportunities:', e); }
  }

  const INTERVAL_MAP: Record<string, string> = {
    M1: '1min',
    M5: '5min',
    M15: '15min',
    M30: '30min',
    H1: '1h',
    H4: '4h',
    D1: '1day',
  };

  async function evaluatePaperOpportunity(symbol: string, timeframe: string) {
    const sym = symbol.toUpperCase();
    const tf = timeframe.toUpperCase();
    const tdInterval = INTERVAL_MAP[tf] || '15min';

    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) {
      throw new Error('API key missing');
    }

    const params = new URLSearchParams({
      symbol: sym,
      interval: tdInterval,
      outputsize: '30',
      timezone: 'UTC',
      apikey: apiKey,
    });
    const url = `https://api.twelvedata.com/time_series?${params.toString()}`;
    const response = await fetch(url);
    const json = await response.json();

    if (!response.ok || json.status === 'error' || !Array.isArray(json.values) || json.values.length === 0) {
      throw new Error(json.message || 'Failed to fetch market data from provider');
    }

    const candles = json.values.map((v: any) => ({
      time: v.datetime,
      timestamp: new Date(v.datetime).getTime(),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume ? parseFloat(v.volume) : 0,
    })).reverse();

    const latestCandle = candles[candles.length - 1];
    const marketPrice = latestCandle.close;

    const provenance: DataProvenance = {
      providerId: 'TWELVEDATA_PAPER',
      mode: 'LIVE',
      granularity: 'CANDLE_LEVEL',
      calculationMethod: 'MSI_QUANTITATIVE_CONFLUENCE_v1',
      freshnessStatus: 'FRESH',
      validationStatus: 'VALID',
      timestamp: new Date().toISOString(),
    };

    const vpRes = calculateVolumeProfile(candles, provenance);
    const paRes = calculatePriceAction(candles, provenance);
    const avwapRes = calculateAnchoredVWAP(candles, provenance, [
      { anchorId: 'session-open', anchorType: 'SESSION_OPEN', candleIndex: 0 },
    ]);
    const ofRes = calculateOrderFlow(candles, provenance);

    const confluence = evaluateConfluence(sym, tf as MSITimeframe, vpRes, paRes, avwapRes, ofRes, provenance);

    let decision: 'BLOCKED' | 'CANDIDATE' | 'CONFIRMED' = 'BLOCKED';
    let decisionReason = confluence.eligibilityReason;

    if (!confluence.decisionEligibility) {
      decision = 'BLOCKED';
      decisionReason = confluence.eligibilityReason;
    } else {
      decision = confluence.rawWeightedScore >= 70 ? 'CONFIRMED' : 'CANDIDATE';
      decisionReason = decision === 'CONFIRMED'
        ? 'High multi-engine quantitative confluence confirmed without data gaps'
        : 'Candidate setup meeting minimum criteria but pending secondary confirmations';
    }

    // Spread and transaction cost estimates (Phase 23: spreadPips is market-data metric; monetary cost is UNAVAILABLE without position/contract size)
    const isGold = sym.includes('XAU');
    const spreadPips = isGold ? 3.5 : 1.2;
    const spreadInfo = {
      spreadPips,
      source: 'TWELVEDATA_ESTIMATED_BASELINE',
      quality: 'ESTIMATED',
      timestamp: new Date().toISOString(),
      monetaryCostUsd: null, // UNAVAILABLE without explicit position size, contract size, and account currency
      note: 'Monetary spread cost is UNAVAILABLE without explicit position size and contract contract specifications.',
    };

    let hypotheticalTrade = null;
    const hasValidSwings = paRes.data && paRes.data.recentSwings && paRes.data.recentSwings.length > 0;

    if (!hasValidSwings && decision === 'CONFIRMED') {
      decision = 'BLOCKED';
      decisionReason = 'MISSING_STRUCTURAL_INVALIDATION: No confirmed swing points available for structural stop-loss placement.';
    }

    if (hasValidSwings && paRes.data) {
      const isLong = paRes.data.trend === 'BULLISH';
      const lastSwing = paRes.data.recentSwings[paRes.data.recentSwings.length - 1];
      const riskDist = Math.abs(marketPrice - lastSwing.price);
      if (riskDist > 0) {
        hypotheticalTrade = {
          direction: (isLong ? 'LONG' : 'SHORT') as any,
          entryPrice: marketPrice,
          stopLoss: Number((isLong ? marketPrice - riskDist : marketPrice + riskDist).toFixed(isGold ? 2 : 5)),
          takeProfit1: Number((isLong ? marketPrice + riskDist * 1.5 : marketPrice - riskDist * 1.5).toFixed(isGold ? 2 : 5)),
          takeProfit2: Number((isLong ? marketPrice + riskDist * 2.5 : marketPrice - riskDist * 2.5).toFixed(isGold ? 2 : 5)),
          spreadInfo,
          // Lifecycle fields
          status: 'WAITING_FOR_ENTRY',
          lastUpdatePrice: marketPrice,
          lastUpdateTimestamp: Date.now(),
          realizedPips: null,
        };
      }
    }

    const opportunity = {
      id: `paper-${sym.replace('/', '_')}-${tf}-${Date.now()}`,
      utcTimestamp: new Date().toISOString(),
      timestampMs: Date.now(),
      symbol: sym,
      timeframe: tf,
      marketPrice,
      mode: 'PAPER_MODE',
      brokerOrdersSent: 0,
      decision,
      decisionReason,
      confluenceScore: confluence.rawWeightedScore,
      evidenceCoverageRatio: confluence.evidenceCoverageRatio,
      normalizedAvailableScore: confluence.normalizedAvailableScore,
      engineResults: {
        priceAction: { status: paRes.status, hasData: !!paRes.data },
        volumeProfile: { status: vpRes.status, hasData: !!vpRes.data },
        anchoredVWAP: { status: avwapRes.status, hasData: !!avwapRes.data },
        orderFlow: { status: ofRes.status, hasData: !!ofRes.data },
      },
      provenance,
      componentEvidence: {
        supporting: confluence.supportingEvidence,
        conflicting: confluence.conflictingEvidence,
      },
      hypotheticalTrade,
    };

    // Deduplication check: prevent adding identical opportunities within 5 minutes
    const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
    const isDuplicate = paperOpportunities.some(p => 
      p.symbol === sym && 
      p.timeframe === tf && 
      Math.abs(p.timestampMs - Date.now()) < DEDUPE_WINDOW_MS
    );

    if (!isDuplicate) {
        paperOpportunities.unshift(opportunity);
        if (paperOpportunities.length > 100) {
          paperOpportunities.pop();
        }
        saveOpportunities();
    } else {
        console.log(`[PaperTrading] Skipping duplicate opportunity for ${sym} ${tf}`);
    }
    
    if (tdWs) tdWs.subscribe([sym]);

    return isDuplicate ? null : opportunity;
  }

  // Paper Trading session status
  app.get('/api/msi/paper/status', (req, res) => {
    res.json({
      mode: 'PAPER_MODE',
      brokerOrdersEnabled: false,
      realMoneyExecution: false,
      liveFeedsConnected: tdWs.getState() === 'CONNECTED',
      activeSymbols: Array.from(ALLOWED_SYMBOLS),
      activeTimeframes: Array.from(ALLOWED_INTERVALS),
      opportunitiesLoggedCount: paperOpportunities.length,
      sessionStartedAt: new Date().toISOString(),
    });
  });

  // List all recorded paper trading opportunities
  app.get('/api/msi/paper/opportunities', (req, res) => {
    res.json({
      mode: 'PAPER_MODE',
      brokerOrdersEnabled: false,
      count: paperOpportunities.length,
      opportunities: paperOpportunities,
    });
  });

  // On-demand or scheduled live paper evaluation
  app.post('/api/msi/paper/evaluate', async (req, res) => {
    const { symbol, timeframe } = req.body || {};
    const sym = String(symbol || 'EUR/USD').toUpperCase();
    const tf = String(timeframe || 'M15').toUpperCase();

    if (!ALLOWED_SYMBOLS.has(sym)) {
      return res.status(400).json({ error: 'Invalid or unsupported trading symbol' });
    }
    if (!ALLOWED_INTERVALS.has(tf)) {
      return res.status(400).json({ error: 'Invalid or unsupported interval' });
    }

    try {
      const opp = await evaluatePaperOpportunity(sym, tf);
      res.json(opp);
    } catch (err: any) {
      res.status(502).json({ error: err.message || 'Failed to evaluate paper opportunity' });
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();
  
  tdWs = new TwelveDataWebSocket(
    process.env.TWELVE_DATA_API_KEY!,
    (tick) => {
      if (tick.event === 'price') {
        // Broadcast all price ticks to clients to keep frontend dashboard synchronized
        const tickMsg = JSON.stringify(tick);
        clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(tickMsg); });

        // Lifecycle update
        paperOpportunities.forEach((opp) => {
          if (opp.symbol === tick.symbol && opp.hypotheticalTrade) {
            const trade = opp.hypotheticalTrade;
            
            // Stale data check: if tick is older than 60s, do not process
            if (Date.now() - tick.timestamp > 60000) {
              console.log(`[TickDebug] Skipping stale tick for ${opp.id}: ${tick.symbol}`);
              return;
            }

            if (['WAITING_FOR_ENTRY', 'ACTIVE', 'TP1_HIT'].includes(trade.status)) {
                // Update
                trade.lastUpdatePrice = tick.price;
                trade.lastUpdateTimestamp = Date.now();
                
                const isLong = trade.direction === 'LONG';
                const price = tick.price;

                console.log(`[TickDebug] Processing tick for ${opp.id} (${opp.symbol}): ${price}. Status: ${trade.status}`);

                // Handle Transitions
                if (trade.status === 'WAITING_FOR_ENTRY') {
                    if (trade.entryPrice !== null && ((isLong && price >= trade.entryPrice) || (!isLong && price <= trade.entryPrice))) {
                        trade.status = 'ACTIVE';
                        console.log(`[TickDebug] ${opp.id} transitioned to ACTIVE`);
                    }
                } else if (trade.status === 'ACTIVE' || trade.status === 'TP1_HIT') {
                    // Check SL (Always terminal)
                    if (trade.stopLoss !== null && ((isLong && price <= trade.stopLoss) || (!isLong && price >= trade.stopLoss))) {
                        trade.status = 'SL_HIT';
                        console.log(`[TickDebug] ${opp.id} SL_HIT`);
                    }
                    // Check TP2 (Always terminal)
                    else if (trade.takeProfit2 !== null && ((isLong && price >= trade.takeProfit2) || (!isLong && price <= trade.takeProfit2))) {
                        trade.status = 'TP2_HIT';
                        console.log(`[TickDebug] ${opp.id} TP2_HIT`);
                    }
                    // Check TP1
                    else if (trade.status === 'ACTIVE' && trade.takeProfit1 !== null && ((isLong && price >= trade.takeProfit1) || (!isLong && price <= trade.takeProfit1))) {
                        trade.status = 'TP1_HIT';
                        console.log(`[TickDebug] ${opp.id} TP1_HIT`);
                    }
                }

                // Emit update on every price tick
                console.log(`[TickDebug] Emitting trade_update for ${opp.id}`);
                const updateMsg = JSON.stringify({ type: 'trade_update', opportunity: opp });
                clients.forEach(client => { if (client.readyState === WebSocket.OPEN) client.send(updateMsg); });
            }
          }
        });

        const candleM1 = aggregator.processTick({ symbol: tick.symbol, price: tick.price, timestamp: tick.timestamp }, 1);
        const candleM5 = aggregator.processTick({ symbol: tick.symbol, price: tick.price, timestamp: tick.timestamp }, 5);
        const candleM15 = aggregator.processTick({ symbol: tick.symbol, price: tick.price, timestamp: tick.timestamp }, 15);
        const candleM30 = aggregator.processTick({ symbol: tick.symbol, price: tick.price, timestamp: tick.timestamp }, 30);
        
        if (candleM1) {
          const message = JSON.stringify({ type: 'candle', candle: candleM1 });
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(message);
          });
        }
      } else {
        const message = JSON.stringify(tick);
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) client.send(message);
        });
      }
    },
    (state) => {
      const message = JSON.stringify({ type: 'status', state });
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(message);
      });
    },
    async (disconnectStart, reconnectedAt) => {
      console.log(`[GapReconciliation] Reconnected after disconnect (${new Date(disconnectStart).toISOString()} -> ${new Date(reconnectedAt).toISOString()}). Initiating historical gap reconciliation...`);
      const symbols = ['EUR/USD', 'XAU/USD'];
      for (const symbol of symbols) {
        try {
          const result = await gapReconciler.reconcileGap(symbol, disconnectStart, reconnectedAt);
          const reconcileMsg = JSON.stringify({
            type: 'gap_reconciliation',
            symbol,
            result,
          });
          clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(reconcileMsg);
          });
        } catch (err) {
          console.error(`[GapReconciliation] Failed to reconcile gaps for ${symbol}:`, err);
        }
      }
    }
  );

  tdWs.connect();
  const initialSymbols = Array.from(new Set(paperOpportunities.map((o: any) => o.symbol)));
  if (initialSymbols.length > 0) tdWs.subscribe(initialSymbols);
  tdWs.subscribe(['EUR/USD', 'XAU/USD']);

  wss.on('connection', (ws) => {
    console.log('Client connected to MSI Live Stream');
    clients.add(ws);
    
    // Immediately emit current backend connection state to the new client
    try {
      ws.send(JSON.stringify({ type: 'status', state: tdWs.getState() }));
    } catch {
      // ignore send error
    }
    
    ws.on('message', (message) => {
      // Browser clients are read-only stream consumers; isolate upstream socket
      try {
        const parsed = JSON.parse(message.toString());
        if (parsed?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // ignore malformed client messages
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected from MSI Live Stream');
      clients.delete(ws);
    });
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(port, () => {
    console.log(`Server is running on port ${port}`);

    // Initialize first live Paper Trading opportunities
    setTimeout(async () => {
      try {
        console.log('[PaperTrading] Initializing live market paper evaluation for EUR/USD and XAU/USD...');
        await evaluatePaperOpportunity('EUR/USD', 'M15');
        await evaluatePaperOpportunity('XAU/USD', 'M15');
        console.log(`[PaperTrading] Initialized. Recorded ${paperOpportunities.length} live opportunities.`);
      } catch (err) {
        console.error('[PaperTrading] Initial evaluation error:', err);
      }
    }, 2000);
  });
}

startServer();
