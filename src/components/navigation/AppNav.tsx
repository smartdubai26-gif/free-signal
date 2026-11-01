import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CheckCircle2,
  Clock,
  Cpu,
  FileArchive,
  Gauge,
  LayoutGrid,
  LineChart,
  Menu,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Signal,
  TrendingUp,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type TabId =
  | 'today'
  | 'pending'
  | 'results'
  | 'performance'
  | 'analytics'
  | 'diagnostics'
  | 'production_test'
  | 'scanner'
  | 'archive'
  | 'settings'
  | 'msi';

type TabDef = {
  id: TabId;
  /** Long label, used on desktop and in the drawer. */
  label: string;
  /** Short label, used in the phone drawer grid. */
  short: string;
  icon: LucideIcon;
};

/**
 * One source of truth for the eleven tabs.
 *
 * Before this file existed the tab list was written out twice — once for the
 * desktop <nav> and once for the phone strip — so the two drifted apart in
 * wording and the phone copy rendered eleven 24px-tall buttons in a row that
 * was 769px wide inside a 337px container.
 */
export const TABS: TabDef[] = [
  { id: 'today', label: 'توصيات اليوم', short: 'توصيات اليوم', icon: Zap },
  { id: 'pending', label: 'الفرص المعلقة', short: 'الفرص المعلقة', icon: Clock },
  { id: 'results', label: 'تقرير النتائج', short: 'النتائج', icon: CheckCircle2 },
  { id: 'performance', label: 'لوحة الأداء (Win Rate)', short: 'الأداء', icon: Gauge },
  { id: 'analytics', label: 'التحليلات الشاملة', short: 'التحليلات', icon: BarChart3 },
  { id: 'diagnostics', label: 'الفحص والتشخيص', short: 'التشخيص', icon: ShieldCheck },
  { id: 'production_test', label: 'اختبار الإنتاج (5 أيام)', short: 'اختبار الإنتاج', icon: TrendingUp },
  { id: 'scanner', label: 'محرك التحليل والمؤشرات', short: 'المحرك', icon: LineChart },
  { id: 'archive', label: 'الأرشيف', short: 'الأرشيف', icon: FileArchive },
  { id: 'settings', label: 'الإعدادات', short: 'الإعدادات', icon: Settings },
  { id: 'msi', label: 'MSI Intelligence', short: 'MSI', icon: Cpu },
];

interface MobileNavProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

/**
 * Phone navigation.
 *
 * Design decisions, each one from a measurement:
 *  - A horizontal pill strip, not eleven compressed buttons. Each pill is
 *    44px tall (was 24px) and scrolls with snap points, so the active tab is
 *    always reachable with one swipe instead of a 700px drag.
 *  - A "all sections" drawer holds the full list with icons and long labels,
 *    because eleven Arabic labels never fit a 375px strip comfortably and a
 *    user should not have to hunt by scrolling blind.
 *  - The strip auto-scrolls the active pill into view when the tab changes.
 */
export function MobileNav({ activeTab, onChange }: MobileNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const active = strip.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) return;
    // Keep the active pill visible without yanking the page itself.
    const left = active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2;
    strip.scrollTo({ left, behavior: 'smooth' });
  }, [activeTab]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const activeLabel = useMemo(
    () => TABS.find((t) => t.id === activeTab)?.short ?? '',
    [activeTab],
  );

  return (
    <div className="md:hidden">
      {/* Row 1: current section + open the full list */}
      <div className="flex items-center gap-2 pt-2.5 border-t border-slate-800/60 mt-2.5">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="tap flex items-center gap-2 px-3 rounded-xl bg-slate-800/80 border border-slate-700 text-slate-100 text-xs font-bold active:scale-95 transition-transform"
          aria-label="كل الأقسام"
        >
          <Menu className="w-4 h-4 text-amber-400" />
          <span className="max-w-[9rem] truncate">{activeLabel}</span>
        </button>

        <div
          ref={stripRef}
          className="mobile-tabs no-scrollbar scroll-hint flex-1 py-0.5"
          role="tablist"
          aria-label="أقسام التطبيق"
        >
          {TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-active={active}
                onClick={() => onChange(tab.id)}
                className={
                  active
                    ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-400/40'
                    : 'text-slate-400 border border-transparent active:bg-slate-800'
                }
              >
                {tab.short}
              </button>
            );
          })}
        </div>
      </div>

      {/* Drawer: the full list, in a 2-column grid */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end"
          role="dialog"
          aria-modal="true"
          aria-label="كل الأقسام"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="w-full bg-slate-900 border-t border-slate-700 rounded-t-2xl p-4 pb-safe max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white">كل الأقسام</h3>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="tap flex items-center justify-center rounded-xl bg-slate-800 text-slate-300"
                aria-label="إغلاق"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const active = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      onChange(tab.id);
                      setDrawerOpen(false);
                    }}
                    className={`tap-h flex items-center gap-2 px-3 py-3 rounded-xl text-start text-xs font-semibold border transition-colors ${
                      active
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-slate-800/70 text-slate-300 border-slate-700/70 active:bg-slate-800'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-amber-400' : 'text-slate-400'}`} />
                    <span className="leading-tight">{tab.short}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface HeaderActionsProps {
  isRunning: boolean;
  onRun: () => void;
  onReset: () => void;
}

/**
 * The two primary actions.
 *
 * On a phone they were 269px of buttons inside a 337px row that also held the
 * wordmark and the tab strip — which is what pushed the header 140px wider
 * than the screen. They now collapse to icon buttons (44×44) on phones and
 * expand to labelled buttons from `sm` upward.
 */
export function HeaderActions({ isRunning, onRun, onReset }: HeaderActionsProps) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
      <button
        type="button"
        onClick={onReset}
        title="تصفير وإعادة فحص"
        aria-label="تصفير وإعادة فحص"
        className="tap flex items-center justify-center gap-1.5 rounded-lg text-rose-100 bg-rose-900/50 border border-rose-800 font-bold text-xs hover:bg-rose-900 active:scale-95 transition-all sm:px-3 sm:py-2"
      >
        <RotateCcw className="w-4 h-4" />
        <span className="hidden sm:inline whitespace-nowrap">تصفير وإعادة فحص</span>
      </button>

      <button
        type="button"
        onClick={onRun}
        disabled={isRunning}
        title="تشغيل التحليل"
        aria-label="تشغيل التحليل"
        className="tap flex items-center justify-center gap-1.5 rounded-lg text-slate-950 bg-gradient-to-r from-amber-400 to-amber-500 font-bold text-xs shadow-md hover:from-amber-300 hover:to-amber-400 active:scale-95 transition-all disabled:opacity-50 sm:px-3.5 sm:py-2"
      >
        {isRunning ? (
          <RefreshCw className="w-4 h-4 animate-spin" />
        ) : (
          <Zap className="w-4 h-4 fill-slate-950" />
        )}
        <span className="hidden sm:inline whitespace-nowrap">
          {isRunning ? 'فحص السوق...' : 'تشغيل التحليل'}
        </span>
      </button>
    </div>
  );
}

interface DesktopNavProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

/**
 * Desktop navigation. Eleven labels do not fit beside the wordmark at 1024px
 * either, so the middle block scrolls silently rather than widening the page.
 */
export function DesktopNav({ activeTab, onChange }: DesktopNavProps) {
  return (
    <nav
      className="hidden md:flex flex-1 min-w-0 items-center gap-5 text-sm font-medium text-slate-300 overflow-x-auto no-scrollbar px-1"
      aria-label="أقسام التطبيق"
    >
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        const isMsi = tab.id === 'msi';
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors hover:text-amber-400 ${
              active ? 'text-amber-400 font-bold border-b-2 border-amber-400' : ''
            } ${
              isMsi
                ? `flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 ${
                    active ? 'text-amber-300 bg-amber-500/20 border-amber-400' : 'text-amber-400/90'
                  }`
                : ''
            }`}
          >
            {isMsi && <Cpu className="w-3.5 h-3.5" />}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** Small helper used by the ticker bar and elsewhere. */
export function MarketClosedChip({ reason }: { reason: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[11px] font-semibold">
      <AlertTriangle className="w-3 h-3" />
      <span>{reason}</span>
    </span>
  );
}

export const NAV_ICONS = { Calculator, LayoutGrid, Signal };
