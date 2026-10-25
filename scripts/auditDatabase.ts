import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://placeholder-project.supabase.co';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const APPROVED_10_ASSETS = [
  'EUR/USD',
  'GBP/USD',
  'USD/JPY',
  'USD/CHF',
  'AUD/USD',
  'NZD/USD',
  'USD/CAD',
  'XAU/USD',
  'XAG/USD',
  'WTI',
];

const VALID_STATUSES = ['pending', 'active', 'won', 'lost', 'not_triggered'];

export interface AuditReport {
  totalSignals: number;
  futureDateCount: number;
  invalidStatusCount: number;
  invalidSymbolCount: number;
  invalidConfidenceCount: number;
  mockDataDetected: boolean;
  offendingIds: string[];
}

export async function runDatabaseAudit(autoClean = false): Promise<AuditReport> {
  console.log('=====================================================');
  console.log('🔍 RUNNING DATABASE AUDIT FOR MOCK / SEEDED DATA');
  console.log('Connecting to:', supabaseUrl);
  console.log('=====================================================');

  const report: AuditReport = {
    totalSignals: 0,
    futureDateCount: 0,
    invalidStatusCount: 0,
    invalidSymbolCount: 0,
    invalidConfidenceCount: 0,
    mockDataDetected: false,
    offendingIds: [],
  };

  try {
    // 1. Fetch all signals with timeout
    const fetchPromise = supabase.from('signals').select('*');
    const timeoutPromise = new Promise<{ data: any; error: any }>((_, reject) =>
      setTimeout(() => reject(new Error('Supabase request timed out after 5 seconds (verify VITE_SUPABASE_URL)')), 5000)
    );

    const { data: signals, error } = (await Promise.race([fetchPromise, timeoutPromise])) as any;

    if (error) {
      console.error('❌ Failed to fetch signals from Supabase:', error.message);
      console.log('\n⚠️ If using Supabase directly, run this SQL script in the Supabase SQL Editor:');
      console.log('----------------------------------------------------');
      console.log('DELETE FROM signals WHERE created_at > NOW();');
      console.log("DELETE FROM signals WHERE status NOT IN ('pending','active','won','lost','not_triggered');");
      console.log('DELETE FROM signals WHERE confidence > 100 OR confidence < 0;');
      console.log('DELETE FROM daily_summary;');
      console.log('----------------------------------------------------\n');
      return report;
    }

    if (!signals || signals.length === 0) {
      console.log('ℹ️ Table `signals` is currently empty. 0 rows found.');
      return report;
    }

    report.totalSignals = signals.length;
    const now = new Date();

    const futureSignals: any[] = [];
    const invalidStatusSignals: any[] = [];
    const invalidSymbolSignals: any[] = [];
    const invalidConfidenceSignals: any[] = [];
    const allOffendingIds = new Set<string>();

    for (const sig of signals) {
      let isOffending = false;

      // Check 2: Future dates (created_at > NOW)
      if (sig.created_at) {
        const sigTime = new Date(sig.created_at).getTime();
        // Allow 60 seconds tolerance for clock skew
        if (sigTime > now.getTime() + 60000) {
          report.futureDateCount++;
          futureSignals.push(sig);
          isOffending = true;
        }
      }

      // Check 3: Status not in ('pending', 'active', 'won', 'lost', 'not_triggered')
      const normStatus = (sig.status || '').toLowerCase();
      if (!VALID_STATUSES.includes(normStatus)) {
        report.invalidStatusCount++;
        invalidStatusSignals.push(sig);
        isOffending = true;
      }

      // Check 4: Symbol not in 10 approved assets (allow standard aliases like WTI Oil or no-slash)
      const sym = sig.symbol;
      const isApproved = APPROVED_10_ASSETS.some(
        a => a === sym || a.replace('/', '') === sym || (a === 'WTI' && sym.includes('WTI'))
      );
      if (!isApproved) {
        report.invalidSymbolCount++;
        invalidSymbolSignals.push(sig);
        isOffending = true;
      }

      // Check 5: Confidence > 100 or < 0
      const conf = Number(sig.confidence);
      if (isNaN(conf) || conf < 0 || conf > 100) {
        report.invalidConfidenceCount++;
        invalidConfidenceSignals.push(sig);
        isOffending = true;
      }

      if (isOffending && sig.id) {
        allOffendingIds.add(sig.id);
      }
    }

    report.offendingIds = Array.from(allOffendingIds);
    report.mockDataDetected =
      report.futureDateCount > 0 ||
      report.invalidStatusCount > 0 ||
      report.invalidSymbolCount > 0 ||
      report.invalidConfidenceCount > 0;

    // Report in clear table
    console.table([
      { Metric: '1. Total Signals in DB', Count: report.totalSignals, Status: 'INFO' },
      { Metric: '2. Signals with Future Dates (created_at > NOW())', Count: report.futureDateCount, Status: report.futureDateCount > 0 ? '❌ MOCK' : '✅ CLEAN' },
      { Metric: '3. Signals with Invalid Status', Count: report.invalidStatusCount, Status: report.invalidStatusCount > 0 ? '❌ INVALID' : '✅ CLEAN' },
      { Metric: '4. Signals with Unexpected Symbols', Count: report.invalidSymbolCount, Status: report.invalidSymbolCount > 0 ? '❌ INVALID' : '✅ CLEAN' },
      { Metric: '5. Signals with Out-of-Bound Confidence (<0 or >100)', Count: report.invalidConfidenceCount, Status: report.invalidConfidenceCount > 0 ? '❌ INVALID' : '✅ CLEAN' },
    ]);

    if (report.mockDataDetected) {
      console.log('\n⚠️ MOCK/SEEDED DATA DETECTED. Please delete these rows:');
      console.log('Execute the following SQL commands in Supabase SQL Editor:');
      console.log('----------------------------------------------------');
      console.log('DELETE FROM signals WHERE created_at > NOW();');
      console.log("DELETE FROM signals WHERE status NOT IN ('pending','active','won','lost','not_triggered');");
      console.log('DELETE FROM signals WHERE confidence > 100 OR confidence < 0;');
      console.log('DELETE FROM daily_summary;');
      console.log('----------------------------------------------------\n');

      if (autoClean && report.offendingIds.length > 0) {
        console.log(`🧹 Auto-clean enabled: Deleting ${report.offendingIds.length} offending mock rows...`);
        const { error: delError } = await supabase
          .from('signals')
          .delete()
          .in('id', report.offendingIds);

        if (delError) {
          console.error('Failed to auto-clean signals:', delError.message);
        } else {
          console.log(`✅ Successfully deleted ${report.offendingIds.length} mock signals.`);
          // Also clear daily summary
          const { error: summaryDelError } = await supabase
            .from('daily_summary')
            .delete()
            .neq('date', '1970-01-01'); // deletes all rows
          if (summaryDelError) {
            console.warn('daily_summary cleanup note:', summaryDelError.message);
          } else {
            console.log('✅ Successfully reset daily_summary built on mock data.');
          }
        }
      }
    } else {
      console.log('\n✅ NO MOCK DATA DETECTED. All database signals conform to production integrity standards.');
    }

    return report;
  } catch (err: any) {
    console.error('Audit exception:', err.message);
    return report;
  }
}

// Auto-run if executed directly via tsx
if (process.argv[1]?.includes('auditDatabase')) {
  const shouldClean = process.argv.includes('--clean');
  runDatabaseAudit(shouldClean).then(() => {
    process.exit(0);
  });
}
