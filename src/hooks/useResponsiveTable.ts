import { useEffect, useRef } from 'react';

/**
 * Turns a wide <table> into readable cards on phones.
 *
 * The table keeps its real semantic markup — screen readers and desktop still
 * see a table. On a phone the CSS in index.css (`.rtable`) re-flows each row
 * into a card, and every cell needs its column heading next to the value,
 * because the <thead> is hidden. That heading is copied from the matching
 * <th> into `data-label` here, so the markup never has to be duplicated.
 *
 * Measured problem this solves: the Archive / Performance / Scanner /
 * Diagnostics tables are 6–10 columns wide. At 375px they squashed into an
 * unusable 320px of horizontally-scrolling chip text — four of the nine
 * horizontal scrollers measured on the page.
 *
 * Usage:
 *   const tableRef = useResponsiveTable<HTMLTableElement>();
 *   <table ref={tableRef} className="rtable w-full ...">
 */
export function useResponsiveTable<T extends HTMLTableElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const table = ref.current;
    if (!table) return;

    const labelCells = () => {
      const headRow = table.querySelector('thead tr');
      if (!headRow) return;

      const headings = Array.from(headRow.querySelectorAll('th')).map((th) =>
        (th.textContent || '').replace(/\s+/g, ' ').trim(),
      );

      table.querySelectorAll('tbody tr').forEach((row) => {
        Array.from(row.querySelectorAll('td')).forEach((cell, index) => {
          const td = cell as HTMLTableCellElement;
          // A row-wide "no data" cell has nothing to label.
          if (td.hasAttribute('colspan')) {
            td.removeAttribute('data-label');
            return;
          }
          const label = headings[index];
          if (label) td.setAttribute('data-label', label);
          else td.removeAttribute('data-label');
        });
      });
    };

    labelCells();

    // Rows are re-rendered whenever filters change, so keep labels in sync.
    const observer = new MutationObserver(labelCells);
    const tbody = table.querySelector('tbody');
    if (tbody) {
      observer.observe(tbody, { childList: true, subtree: true });
    }

    return () => observer.disconnect();
  }, []);

  return ref;
}
