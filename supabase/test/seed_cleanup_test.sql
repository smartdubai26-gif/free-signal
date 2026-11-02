-- Seed data for testing cleanup-old-signals.sql
-- Covers every category the cleanup script targets, plus rows that MUST survive.

TRUNCATE public.signals;

-- ── A) Clean, legitimate rows that must SURVIVE ─────────────────────────────
-- A1: normal Monday signal, active, activated Monday 10:00 Cairo
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('11111111-0000-0000-0000-000000000001','EUR/USD','H4','LONG',88,1.0850,1.0800,1.0950,1.1000,1.1050,2.0,'["ok"]','active','2026-10-26 06:00:00+00','2026-10-26 08:00:00+00');

-- A2: Friday signal (NEW rule = trading day) — must survive
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('11111111-0000-0000-0000-000000000002','GBP/USD','H4','SHORT',80,1.2700,1.2750,1.2600,1.2550,1.2500,2.0,'["ok"]','active','2026-10-30 06:00:00+00','2026-10-30 08:00:00+00');

-- A3: Sunday signal (NEW rule = trading day) — must survive
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('11111111-0000-0000-0000-000000000003','USD/JPY','H4','LONG',75,150.00,149.50,151.00,151.50,152.00,2.0,'["ok"]','active','2026-11-01 06:00:00+00','2026-11-01 08:00:00+00');

-- A4: old but CLOSED and within retention (20 days) — must survive
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at, closed_at, outcome)
VALUES ('11111111-0000-0000-0000-000000000004','AUD/USD','H1','LONG',70,0.6500,0.6450,0.6600,0.6650,0.6700,2.0,'["ok"]','won','2026-10-12 06:00:00+00','2026-10-12 07:00:00+00','2026-10-12 12:00:00+00','win');

-- A5: pending, old (60 days) — pending is NOT deleted by retention alone
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at)
VALUES ('11111111-0000-0000-0000-000000000005','NZD/USD','D1','LONG',65,0.6000,0.5900,0.6200,0.6300,0.6400,2.0,'["ok"]','pending','2026-09-01 06:00:00+00');

-- ── B) FUTURE timestamps — must be DELETED ──────────────────────────────────
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at)
VALUES ('22222222-0000-0000-0000-000000000001','EUR/JPY','H4','LONG',90,160.00,159.00,162.00,163.00,164.00,2.0,'["future"]','pending','2027-06-01 10:00:00+00');

INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('22222222-0000-0000-0000-000000000002','EUR/CHF','H4','LONG',90,0.9500,0.9450,0.9600,0.9650,0.9700,2.0,'["future"]','active','2026-10-20 10:00:00+00','2027-01-15 10:00:00+00');

-- ── C) SATURDAY activations — must be DELETED ───────────────────────────────
-- C1: Saturday 2026-10-31 10:00 Cairo (= 08:00 UTC)
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('33333333-0000-0000-0000-000000000001','XAU/USD','H4','LONG',92,2000.00,1990.00,2020.00,2030.00,2040.00,2.0,'["sat"]','active','2026-10-31 06:00:00+00','2026-10-31 08:00:00+00');

-- C2: Saturday 00:30 Cairo (= Friday 22:30 UTC) — the Cairo-calendar edge case
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('33333333-0000-0000-0000-000000000002','XAU/USD','H1','SHORT',85,2000.00,2010.00,1980.00,1970.00,1960.00,2.0,'["sat-edge"]','active','2026-10-30 20:00:00+00','2026-10-30 22:30:00+00');

-- ── D) LEGACY holiday window (Friday 21:00+ UTC / Sunday <21:00 UTC) ────────
-- D1: Friday 2026-10-23 22:00 UTC — legacy closed window, created BEFORE rule change
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('44444444-0000-0000-0000-000000000001','USD/CAD','H4','LONG',78,1.3600,1.3550,1.3700,1.3750,1.3800,2.0,'["legacy"]','active','2026-10-23 20:00:00+00','2026-10-23 22:00:00+00');

-- D2: Sunday 2026-10-25 10:00 UTC — legacy closed window, created BEFORE rule change
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('44444444-0000-0000-0000-000000000002','USD/CHF','H4','SHORT',76,0.8900,0.8950,0.8800,0.8750,0.8700,2.0,'["legacy"]','active','2026-10-25 06:00:00+00','2026-10-25 10:00:00+00');

-- ── E) DUPLICATES: same symbol+timeframe+same H4 candle ─────────────────────
-- E1: the keeper (highest confidence)
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at)
VALUES ('55555555-0000-0000-0000-000000000001','EUR/USD','H4','LONG',95,1.0900,1.0850,1.1000,1.1050,1.1100,2.0,'["dup-keeper"]','pending','2026-10-28 08:00:00+00');
-- E2: duplicate, lower confidence
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at)
VALUES ('55555555-0000-0000-0000-000000000002','EUR/USD','H4','LONG',70,1.0901,1.0851,1.1001,1.1051,1.1101,2.0,'["dup"]','pending','2026-10-28 09:30:00+00');
-- E3: duplicate, same confidence as E1 but later
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at)
VALUES ('55555555-0000-0000-0000-000000000003','EUR/USD','H4','LONG',95,1.0902,1.0852,1.1002,1.1052,1.1102,2.0,'["dup"]','pending','2026-10-28 10:45:00+00');

-- ── F) OLDER THAN RETENTION (closed) — must be DELETED ──────────────────────
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at, closed_at, outcome)
VALUES ('66666666-0000-0000-0000-000000000001','EUR/GBP','H1','LONG',72,0.8600,0.8550,0.8700,0.8750,0.8800,2.0,'["old"]','lost','2026-08-01 06:00:00+00','2026-08-01 07:00:00+00','2026-08-01 09:00:00+00','loss');

-- ── G) PHANTOM ACTIVE — must be DELETED ─────────────────────────────────────
-- G1: active with NULL activated_at
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at)
VALUES ('77777777-0000-0000-0000-000000000001','GBP/JPY','H4','LONG',81,188.00,187.00,190.00,191.00,192.00,2.0,'["phantom"]','active','2026-10-27 06:00:00+00');

-- G2: active, activated in the future
INSERT INTO signals (id, symbol, timeframe, direction, confidence, entry, stop_loss, tp1, tp2, tp3, risk_reward, reasons, status, created_at, activated_at)
VALUES ('77777777-0000-0000-0000-000000000002','GBP/CHF','H4','SHORT',79,1.1000,1.1050,1.0900,1.0850,1.0800,2.0,'["phantom"]','active','2026-10-27 06:00:00+00','2027-03-01 10:00:00+00');

SELECT count(*) AS seeded_rows FROM signals;
