/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MSI — Market Structure Intelligence / Smart Confluence Engine
 * Strongly Typed Data Contracts & Provenance Definitions (Approved Version)
 */

export type MSITimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';
export type MSIDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export type MSIDataMode = 'LIVE' | 'HISTORICAL' | 'ESTIMATED' | 'SIMULATED' | 'UNAVAILABLE';
export type GranularityType = 'TRADE_LEVEL' | 'CANDLE_LEVEL' | 'TICK_PROXY' | 'NONE';
export type FreshnessStatus = 'FRESH' | 'STALE' | 'EXPIRED' | 'UNKNOWN';
export type ValidationStatus = 'VALID' | 'INVALID_TIMESTAMP' | 'INCOMPLETE_CANDLE' | 'ANOMALOUS_PRICE' | 'MISSING_REQUIRED_FIELDS';

export interface DataProvenance {
  providerId: string;
  mode: MSIDataMode;
  granularity: GranularityType;
  calculationMethod: string;
  freshnessStatus: FreshnessStatus;
  validationStatus: ValidationStatus;
  validationReason?: string;
  timestamp: string; // ISO 8601 UTC
}

export type EngineStatus = 'SUCCESS' | 'UNAVAILABLE' | 'DEGRADED' | 'ERROR';

export interface EngineExecutionResult<T> {
  engineName: 'VOLUME_PROFILE' | 'PRICE_ACTION' | 'ANCHORED_VWAP' | 'ORDER_FLOW';
  status: EngineStatus;
  provenance: DataProvenance;
  data: T | null;
  error?: string;
}

// --- ENGINE 1: VOLUME PROFILE ---
export interface VolumeProfileBin {
  price: number;
  volume: number;
  isPOC: boolean;
  isVAH: boolean;
  isVAL: boolean;
  nodeType: 'POC' | 'HVN' | 'LVN' | 'STANDARD';
}

export interface VolumeProfileResult {
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  allocationMethod: 'CANDLE_RANGE_TRIANGULAR_DISTRIBUTION' | 'TICK_TRADE_DATA' | 'UNAVAILABLE';
  valueAreaPercentage: number;
  bins: VolumeProfileBin[];
}

// --- ENGINE 2: PRICE ACTION ---
export type MarketStructureTrend = 'BULLISH' | 'BEARISH' | 'RANGING';
export type StructureEventType = 'BOS' | 'CHoCH' | 'SWING_HIGH' | 'SWING_LOW' | 'LIQUIDITY_SWEEP';

export interface StructureEvent {
  id: string;
  type: StructureEventType;
  price: number;
  timestamp: string;
  candleIndex: number;
  isConfirmed: boolean;
  invalidationLevel: number;
}

export interface PriceActionResult {
  trend: MarketStructureTrend;
  lastBOS: StructureEvent | null;
  lastCHoCH: StructureEvent | null;
  recentSwings: StructureEvent[];
  liquiditySweeps: StructureEvent[];
  supportZones: number[];
  resistanceZones: number[];
}

// --- ENGINE 3: ANCHORED VWAP ---
export type AnchorType = 'SESSION_OPEN' | 'CONFIRMED_SWING_HIGH' | 'CONFIRMED_SWING_LOW' | 'BREAKOUT_EVENT' | 'CUSTOM_TIMESTAMP';

export interface AnchoredVWAPPoint {
  anchorId: string;
  anchorType: AnchorType;
  anchorTimestamp: string;
  anchorIndex: number;
  anchorPrice: number;
  weightingType: 'ACTUAL_VOLUME' | 'TICK_VOLUME' | 'UNAVAILABLE';
  currentVWAP: number;
  upperBand1: number | null;
  lowerBand1: number | null;
  priceRelativeToVWAP: 'ABOVE' | 'BELOW' | 'TESTING' | 'UNAVAILABLE';
  distancePips: number | null;
}

export interface AnchoredVWAPResult {
  anchors: AnchoredVWAPPoint[];
}

// --- ENGINE 4: ORDER FLOW ---
export type MetricAvailabilityStatus = 'AVAILABLE' | 'ESTIMATED' | 'UNAVAILABLE' | 'INVALID_INPUT' | 'INSUFFICIENT_DATA';

export interface OrderFlowMetric<T> {
  status: MetricAvailabilityStatus;
  value: T | null;
  calculationMethod: string;
  reason?: string;
}

export interface OrderFlowResult {
  cvd: OrderFlowMetric<number>;
  buyingPressureRatio: OrderFlowMetric<number>;
  orderBookImbalance: OrderFlowMetric<'BUY_IMBALANCE' | 'SELL_IMBALANCE' | 'NONE'>;
  absorption: OrderFlowMetric<boolean>;
}

// --- ENGINE 5: CONFLUENCE & RANKING ---
export interface EngineScoreContribution {
  engineName: string;
  rawScore: number | null;
  configuredWeight: number;
  effectiveWeight: number;
  weightedScore: number;
  isAvailable: boolean;
  reasoning: string;
}

export interface ConfluenceEvaluation {
  symbol: string;
  timeframe: MSITimeframe;
  rawWeightedScore: number;
  evidenceCoverageRatio: number;
  normalizedAvailableScore: number;
  longScore: number;
  shortScore: number;
  contributions: EngineScoreContribution[];
  conflictingEvidence: string[];
  supportingEvidence: string[];
  decisionEligibility: boolean;
  eligibilityReason: string;
}

export type OpportunityLifecycleState = 
  | 'CANDIDATE' 
  | 'AWAITING_CONFIRMATION' 
  | 'CONFIRMED' 
  | 'INVALIDATED' 
  | 'EXPIRED';

export interface MSIOpportunity {
  id: string;
  symbol: string;
  timeframe: MSITimeframe;
  direction: MSIDirection;
  lifecycleState: OpportunityLifecycleState;
  confluence: ConfluenceEvaluation;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskRewardRatio: number | null;
  invalidationCondition: string | null;
  confirmationRulesSatisfied: boolean;
  provenance: DataProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface MSIConfig {
  weights: {
    volumeProfile: number; // default 0.20
    priceAction: number;   // default 0.25
    anchoredVWAP: number;  // default 0.20
    orderFlow: number;     // default 0.35
  };
  minConfidenceThreshold: number; // default 75
  minEvidenceCoverage: number;    // default 0.60
  requireConfirmationForSignal: boolean;
}
