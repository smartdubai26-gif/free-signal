-- Supabase SQL Script to create and update the signals and daily_summary tables

-- 1. Create signals table if it does not exist
CREATE TABLE IF NOT EXISTS signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol TEXT NOT NULL,
    timeframe TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'NEUTRAL')),
    confidence INT NOT NULL,
    entry NUMERIC NOT NULL,
    stop_loss NUMERIC NOT NULL,
    tp1 NUMERIC NOT NULL,
    tp2 NUMERIC NOT NULL,
    tp3 NUMERIC NOT NULL,
    risk_reward NUMERIC NOT NULL,
    reasons JSONB NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Settlement engine columns for lifecycle tracking
ALTER TABLE signals 
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_price NUMERIC,
  ADD COLUMN IF NOT EXISTS pips_gained NUMERIC,
  ADD COLUMN IF NOT EXISTS outcome TEXT 
    CHECK (outcome IN ('win', 'loss', 'not_triggered', 'cancelled'));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_signals_symbol_timeframe_created 
  ON signals (symbol, timeframe, created_at);
CREATE INDEX IF NOT EXISTS idx_signals_status 
  ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_activated_at 
  ON signals(activated_at);

-- 3. Daily summary performance table
CREATE TABLE IF NOT EXISTS daily_summary (
  date DATE PRIMARY KEY,
  total_signals INT DEFAULT 0,
  active_signals INT DEFAULT 0,
  won_signals INT DEFAULT 0,
  lost_signals INT DEFAULT 0,
  not_triggered_signals INT DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  total_pips NUMERIC DEFAULT 0,
  best_trade_pips NUMERIC DEFAULT 0,
  worst_trade_pips NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on date for fast historical queries
CREATE INDEX IF NOT EXISTS idx_daily_summary_date 
  ON daily_summary(date DESC);
