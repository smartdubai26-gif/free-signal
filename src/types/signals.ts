export type AssetClass = 'forex-major' | 'forex-minor' | 'metals' | 'energy';
export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';
export type SignalStatus = 
  | 'pending'
  | 'active'
  | 'won'
  | 'lost'
  | 'not_triggered'
  | 'cancelled'
  | 'OPEN' 
  | 'TP1_HIT' 
  | 'TP2_HIT' 
  | 'SL_HIT' 
  | 'CLOSED_IN_PROFIT' 
  | 'EXPIRED';
export type Timeframe = 'M15' | 'H1' | 'H4' | 'D1';

export interface MarketSession {
  id: string;
  nameAr: string;
  nameEn: string;
  city: string;
  openGmt: string;
  closeGmt: string;
  isOpen: boolean;
  nextEvent?: string;
}

export interface Candle {
  time: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20?: number;
  ema50?: number;
  rsi?: number;
}

export interface TechnicalIndicators {
  rsi: number;
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  ema20: number;
  ema50: number;
  ema200: number;
  atr: number;
  adx: number;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  };
  support: number[];
  resistance: number[];
  pivotPoints: {
    pp: number;
    r1: number;
    r2: number;
    s1: number;
    s2: number;
  };
}

export interface Signal {
  id: string;
  symbol: string;
  nameAr: string;
  nameEn: string;
  assetClass: AssetClass;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3?: number;
  confidence: number; // 0 to 100
  timeframe: Timeframe;
  reasoningAr: string;
  reasoningEn: string;
  indicators: TechnicalIndicators;
  candles: Candle[];
  timestamp: string; // ISO String
  sessionTarget: string;
  status: SignalStatus;
  currentPrice: number;
  resultPips: number;
  pipValueDecimals: number;
  riskRewardRatio: string;
  riskReward?: number;
  highSinceEntry: number;
  lowSinceEntry: number;
  isTopOpportunity: boolean;
  isLiveFeed: boolean;
  isLocked: boolean;
  reasons?: string[];
  dataQuality?: 'live' | 'stale' | 'incomplete';
  exitPrice?: number;
  exitReasonAr?: string;
  exitTime?: string;
  activated_at?: string;
  closed_at?: string;
  closed_price?: number;
  pips_gained?: number;
  outcome?: 'win' | 'loss' | 'not_triggered' | 'cancelled';
}

export interface DailySummary {
  date: string;
  total_signals: number;
  active_signals: number;
  won_signals: number;
  lost_signals: number;
  not_triggered_signals: number;
  win_rate: number;
  total_pips: number;
  best_trade_pips: number;
  worst_trade_pips: number;
  updated_at?: string;
}

export interface PerformanceStats {
  totalSignals?: number;
  winRate: number;
  totalPips: number;
  profitFactor: number;
  averageRiskReward?: string;
  bestTradePips: number;
  maxDrawdownPips?: number;
  monthlyWinRate?: number[];
  winningTrades?: number;
  totalTrades?: number;
  losingTrades?: number;
  openTrades?: number;
  avgRiskReward?: string;
  consecutiveWins?: number;
  worstTradePips?: number;
}

export interface DiagnosticItem {
  id: string;
  name: string;
  category: 'alltick' | 'supabase' | 'websocket' | 'data_freshness' | 'pipeline' | 'mock_detection' | 'physics' | 'server_scheduler';
  status: 'green' | 'yellow' | 'red';
  value: string;
  latencyMs?: number;
  message: string;
  recommendation?: string;
  details?: Record<string, any>;
}

export interface AssetFreshness {
  symbol: string;
  lastUpdated: number;
  ageMinutes: number;
  status: 'live' | 'stale';
  price?: number;
  source?: string;
}

export interface PipelineHealth {
  pendingOlderThan24h: number;
  activeOlderThan48h: number;
  duplicatesCount: number;
  stalePendingIds: string[];
  staleActiveIds: string[];
  duplicatePairs: { symbol: string; timeframe: string; date: string; count: number }[];
}

export interface MockDataCheck {
  totalChecked: number;
  mockCount: number;
  futureDatesCount: number;
  invalidStatusCount: number;
  invalidConfidenceCount: number;
  offendingIds: string[];
}

export interface PhysicsCheck {
  totalClosedChecked: number;
  violationsCount: number;
  violatingIds: string[];
  violationDetails: string[];
}

export interface ServerStatusCheck {
  status: 'active' | 'offline';
  lastSignalCreatedAt: string | null;
  ageHours: number | null;
  isRecent: boolean;
  message: string;
}

export interface DiagnosticReport {
  timestamp: string;
  overallStatus: 'green' | 'yellow' | 'red';
  alltickLatencyMs: number;
  alltickStatus: 'green' | 'yellow' | 'red';
  supabaseLatencyMs: number;
  supabaseStatus: 'green' | 'yellow' | 'red';
  websocketStatus: 'green' | 'red';
  websocketState: string;
  assetFreshness: AssetFreshness[];
  pipelineHealth: PipelineHealth;
  mockDataCheck?: MockDataCheck;
  physicsCheck?: PhysicsCheck;
  serverStatusCheck?: ServerStatusCheck;
  items: DiagnosticItem[];
}

