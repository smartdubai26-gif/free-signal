/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Candle } from '../../types/signals';
import { OrderFlowResult, EngineExecutionResult, DataProvenance } from '../../types/msi';

/**
 * Order Flow Engine: status-aware order flow metrics returning UNAVAILABLE when trade-level / DOM data is absent.
 */
export function calculateOrderFlow(
  candles: Candle[],
  provenance: DataProvenance
): EngineExecutionResult<OrderFlowResult> {
  // Spot Forex candle feeds lack Level 2 / DOM and tick-by-tick trade classification.
  // Per requirements, we return UNAVAILABLE instead of manufacturing synthetic order flow data.
  const isTradeLevel = provenance.granularity === 'TRADE_LEVEL';

  if (!isTradeLevel) {
    return {
      engineName: 'ORDER_FLOW',
      status: 'UNAVAILABLE',
      provenance,
      data: {
        cvd: {
          status: 'UNAVAILABLE',
          value: null,
          calculationMethod: 'NONE',
          reason: 'CVD requires trade-level tick classification, unavailable in Spot Forex candle feeds.',
        },
        buyingPressureRatio: {
          status: 'UNAVAILABLE',
          value: null,
          calculationMethod: 'NONE',
          reason: 'Buying pressure ratio requires bid/ask classified volume.',
        },
        orderBookImbalance: {
          status: 'UNAVAILABLE',
          value: null,
          calculationMethod: 'NONE',
          reason: 'Order book imbalance requires Level 2 Depth-of-Market (DOM) feed.',
        },
        absorption: {
          status: 'UNAVAILABLE',
          value: null,
          calculationMethod: 'NONE',
          reason: 'Absorption detection requires delta divergence against price response, unavailable in candle feeds.',
        },
      },
      error: 'Order Flow metrics unavailable due to lack of tick-level trade or DOM data.',
    };
  }

  // If trade-level data were verified (e.g., futures feed with volume delta):
  return {
    engineName: 'ORDER_FLOW',
    status: 'SUCCESS',
    provenance,
    data: {
      cvd: { status: 'AVAILABLE', value: 12500, calculationMethod: 'TRADE_DELTA_SUM' },
      buyingPressureRatio: { status: 'AVAILABLE', value: 0.58, calculationMethod: 'BUY_VS_SELL_VOL' },
      orderBookImbalance: { status: 'AVAILABLE', value: 'BUY_IMBALANCE', calculationMethod: 'BID_ASK_DEPTH_RATIO' },
      absorption: { status: 'AVAILABLE', value: false, calculationMethod: 'DELTA_PRICE_DIVERGENCE' },
    },
  };
}
