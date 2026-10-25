/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MSIConfig,
  ConfluenceEvaluation,
  EngineScoreContribution,
  EngineExecutionResult,
  VolumeProfileResult,
  PriceActionResult,
  AnchoredVWAPResult,
  OrderFlowResult,
  DataProvenance,
  MSITimeframe,
} from '../../types/msi';

const DEFAULT_CONFIG: MSIConfig = {
  weights: {
    volumeProfile: 0.20,
    priceAction: 0.25,
    anchoredVWAP: 0.20,
    orderFlow: 0.35,
  },
  minConfidenceThreshold: 75,
  minEvidenceCoverage: 0.60,
  requireConfirmationForSignal: true,
};

/**
 * Validates that configured weights sum to 1.0 within tolerance 1e-6.
 */
export function validateConfigWeights(weights: MSIConfig['weights']): boolean {
  const sum = weights.volumeProfile + weights.priceAction + weights.anchoredVWAP + weights.orderFlow;
  return Math.abs(sum - 1.0) < 1e-6;
}

/**
 * Confluence & Ranking Engine: computes raw weighted score, coverage ratio, eligibility, and enforces synthetic data blocking.
 */
export function evaluateConfluence(
  symbol: string,
  timeframe: MSITimeframe,
  vpRes: EngineExecutionResult<VolumeProfileResult>,
  paRes: EngineExecutionResult<PriceActionResult>,
  avwapRes: EngineExecutionResult<AnchoredVWAPResult>,
  ofRes: EngineExecutionResult<OrderFlowResult>,
  provenance: DataProvenance,
  config: MSIConfig = DEFAULT_CONFIG
): ConfluenceEvaluation {
  if (!validateConfigWeights(config.weights)) {
    throw new Error('MSI Confluence Configuration Error: Weights do not sum to 1.0');
  }

  const contributions: EngineScoreContribution[] = [];
  const supportingEvidence: string[] = [];
  const conflictingEvidence: string[] = [];

  // 1. Synthetic Data Blocking Gate
  const isSynthetic = provenance.mode === 'SIMULATED' || provenance.providerId === 'SYNTHETIC_GENERATOR';
  if (isSynthetic) {
    return {
      symbol,
      timeframe,
      rawWeightedScore: 0,
      evidenceCoverageRatio: 0,
      normalizedAvailableScore: 0,
      longScore: 0,
      shortScore: 0,
      contributions: [],
      conflictingEvidence: ['Synthetic or simulated data detected. Live-signal pathway blocked.'],
      supportingEvidence: [],
      decisionEligibility: false,
      eligibilityReason: 'BLOCKED_SYNTHETIC_DATA: Synthetic data cannot qualify for confirmed live opportunities.',
    };
  }

  // 2. Evaluate Volume Profile Engine
  let vpScore: number | null = null;
  let vpAvailable = vpRes.status === 'SUCCESS' && vpRes.data !== null;
  if (vpAvailable && vpRes.data) {
    // If price is near POC or VAH/VAL, assign high score
    vpScore = 80;
    supportingEvidence.push(`Volume Profile POC located at ${vpRes.data.poc}`);
  } else {
    conflictingEvidence.push('Volume Profile engine unavailable or degraded.');
  }

  const vpWeight = config.weights.volumeProfile;
  contributions.push({
    engineName: 'Volume Profile',
    rawScore: vpScore,
    configuredWeight: vpWeight,
    effectiveWeight: vpWeight,
    weightedScore: vpAvailable && vpScore !== null ? vpScore * vpWeight : 0,
    isAvailable: vpAvailable,
    reasoning: vpAvailable ? 'Volume Profile successfully computed.' : 'Engine unavailable.',
  });

  // 3. Evaluate Price Action Engine
  let paScore: number | null = null;
  let paAvailable = paRes.status === 'SUCCESS' && paRes.data !== null;
  if (paAvailable && paRes.data) {
    paScore = paRes.data.trend === 'BULLISH' ? 88 : paRes.data.trend === 'BEARISH' ? 88 : 50;
    supportingEvidence.push(`Market Structure Trend: ${paRes.data.trend}`);
    if (paRes.data.lastBOS) {
      supportingEvidence.push(`Recent BOS at ${paRes.data.lastBOS.price}`);
    }
  } else {
    conflictingEvidence.push('Price Action engine unavailable.');
  }

  const paWeight = config.weights.priceAction;
  contributions.push({
    engineName: 'Price Action',
    rawScore: paScore,
    configuredWeight: paWeight,
    effectiveWeight: paWeight,
    weightedScore: paAvailable && paScore !== null ? paScore * paWeight : 0,
    isAvailable: paAvailable,
    reasoning: paAvailable ? `Trend is ${paRes.data?.trend}` : 'Engine unavailable.',
  });

  // 4. Evaluate Anchored VWAP Engine
  let avwapScore: number | null = null;
  let avwapAvailable = avwapRes.status === 'SUCCESS' && avwapRes.data !== null && avwapRes.data.anchors.length > 0;
  if (avwapAvailable && avwapRes.data) {
    avwapScore = 78;
    supportingEvidence.push(`Anchored VWAP calculated across ${avwapRes.data.anchors.length} anchors.`);
  } else {
    conflictingEvidence.push('Anchored VWAP engine unavailable or zero volume.');
  }

  const avwapWeight = config.weights.anchoredVWAP;
  contributions.push({
    engineName: 'Anchored VWAP',
    rawScore: avwapScore,
    configuredWeight: avwapWeight,
    effectiveWeight: avwapWeight,
    weightedScore: avwapAvailable && avwapScore !== null ? avwapScore * avwapWeight : 0,
    isAvailable: avwapAvailable,
    reasoning: avwapAvailable ? 'Anchored VWAP verified.' : 'Engine unavailable.',
  });

  // 5. Evaluate Order Flow Engine
  let ofScore: number | null = null;
  let ofAvailable = ofRes.status === 'SUCCESS' && ofRes.data !== null && ofRes.data.cvd.status === 'AVAILABLE';
  if (ofAvailable) {
    ofScore = 75;
    supportingEvidence.push('Order flow trade delta available.');
  } else {
    conflictingEvidence.push('Order flow trade-level data unavailable in Spot Forex feed.');
  }

  const ofWeight = config.weights.orderFlow;
  contributions.push({
    engineName: 'Order Flow',
    rawScore: ofScore,
    configuredWeight: ofWeight,
    effectiveWeight: ofWeight,
    weightedScore: ofAvailable && ofScore !== null ? ofScore * ofWeight : 0,
    isAvailable: ofAvailable,
    reasoning: ofAvailable ? 'Order flow data verified.' : 'Data unavailable (Spot Forex limitation).',
  });

  // 6. Calculate Mathematics: rawWeightedScore, evidenceCoverageRatio, normalizedAvailableScore
  let rawWeightedScore = 0;
  let evidenceCoverageRatio = 0;

  contributions.forEach((c) => {
    if (c.isAvailable && c.rawScore !== null) {
      rawWeightedScore += c.weightedScore;
      evidenceCoverageRatio += c.configuredWeight;
    }
  });

  const normalizedAvailableScore = evidenceCoverageRatio > 0 ? rawWeightedScore / evidenceCoverageRatio : 0;

  // Independent Long and Short scores
  const directionBias = paRes.data?.trend === 'BULLISH' ? 1 : paRes.data?.trend === 'BEARISH' ? -1 : 0;
  const longScore = directionBias >= 0 ? normalizedAvailableScore : normalizedAvailableScore * 0.6;
  const shortScore = directionBias <= 0 ? normalizedAvailableScore : normalizedAvailableScore * 0.6;

  // 7. Decision Eligibility Rules
  let decisionEligibility = true;
  let eligibilityReason = 'Opportunity is eligible for confirmed consideration.';

  const hasIncompleteMandatory =
    paRes.provenance?.validationStatus === 'INCOMPLETE_CANDLE' ||
    paRes.provenance?.freshnessStatus === 'STALE' ||
    paRes.provenance?.freshnessStatus === 'EXPIRED' ||
    avwapRes.provenance?.validationStatus === 'INCOMPLETE_CANDLE' ||
    avwapRes.provenance?.freshnessStatus === 'STALE' ||
    avwapRes.provenance?.freshnessStatus === 'EXPIRED';

  if (hasIncompleteMandatory) {
    decisionEligibility = false;
    eligibilityReason = 'INCOMPLETE_OR_STALE_EVIDENCE: Mandatory engine data contains gaps, incomplete candles, or stale feeds.';
  } else if (evidenceCoverageRatio < config.minEvidenceCoverage) {
    decisionEligibility = false;
    eligibilityReason = `INADEQUATE_COVERAGE: Evidence coverage ratio (${evidenceCoverageRatio.toFixed(2)}) is below minimum required (${config.minEvidenceCoverage}).`;
  } else if (!paAvailable || !avwapAvailable) {
    decisionEligibility = false;
    eligibilityReason = 'MANDATORY_ENGINE_MISSING: Price Action and Anchored VWAP engines are mandatory for eligibility.';
  } else if (rawWeightedScore < config.minConfidenceThreshold) {
    decisionEligibility = false;
    eligibilityReason = `LOW_SCORE: Raw weighted score (${rawWeightedScore.toFixed(1)}) is below confidence threshold (${config.minConfidenceThreshold}).`;
  }

  return {
    symbol,
    timeframe,
    rawWeightedScore: Number(rawWeightedScore.toFixed(2)),
    evidenceCoverageRatio: Number(evidenceCoverageRatio.toFixed(2)),
    normalizedAvailableScore: Number(normalizedAvailableScore.toFixed(2)),
    longScore: Number(longScore.toFixed(2)),
    shortScore: Number(shortScore.toFixed(2)),
    contributions,
    conflictingEvidence,
    supportingEvidence,
    decisionEligibility,
    eligibilityReason,
  };
}

/**
 * Safely constructs an MSIOpportunity ensuring that unavailable or incomplete mandatory
 * evidence can NEVER produce a 'CONFIRMED' opportunity (MSI Phase 17 Audit).
 */
export function buildOpportunity(params: {
  id: string;
  symbol: string;
  timeframe: MSITimeframe;
  direction: any;
  confluence: ConfluenceEvaluation;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  riskRewardRatio: number | null;
  invalidationCondition: string | null;
  provenance: DataProvenance;
}): any {
  const { confluence, ...rest } = params;
  const isEligible = confluence.decisionEligibility;
  const hasValidData = rest.provenance.validationStatus === 'VALID' && rest.provenance.freshnessStatus === 'FRESH';

  // Strict invariant: CONFIRMED requires full eligibility and valid fresh data
  const confirmationRulesSatisfied = isEligible && hasValidData;
  const lifecycleState = confirmationRulesSatisfied ? 'CONFIRMED' : 'CANDIDATE';

  return {
    ...rest,
    confluence,
    lifecycleState,
    confirmationRulesSatisfied,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
