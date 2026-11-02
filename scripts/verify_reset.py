"""
v11 — reset isolation proof (Python / Playwright).

Drives the built preview in a real Chromium and measures, at each stage:
  - how many signals the app holds in localStorage
  - how many signal cards the DOM actually renders
  - whether the reset lock is held

Stages: before -> after reset -> after a full scheduler tick -> after reload.
Every stage is screenshotted.
"""
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("PREVIEW_URL", "http://127.0.0.1:8099/index.html")
OUT = os.environ.get("SHOT_DIR", "shots_v11")
os.makedirs(OUT, exist_ok=True)

READ_STATE = """
() => {
  const raw = localStorage.getItem('alphafx_today_signals');
  let count = 0, cleared = false;
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.cleared) cleared = true;
    else if (Array.isArray(parsed)) count = parsed.length;
  } catch (e) {}
  const lockRaw = localStorage.getItem('alphafx_reset_lock');
  let locked = false;
  try { locked = Boolean(lockRaw && JSON.parse(lockRaw).locked === true); } catch (e) {}
  const cards = document.querySelectorAll('[data-testid="signal-card"]').length;
  const bodyText = document.body.innerText || '';
  const emptyState = /لا توجد فرص|لا توجد توصيات|لم يتم العثور/.test(bodyText);
  return { count, cleared, locked, cards, emptyState };
}
"""


def main():
    log = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(2500)

        # The app defaults to the "forex-major" filter, which hides most seed
        # signals. Switch to "عرض الكل" so the card count reflects the real list.
        try:
            page.get_by_role("button", name=re.compile("عرض الكل")).first.click()
            page.wait_for_timeout(1200)
        except Exception as exc:  # noqa: BLE001
            print("filter click skipped:", exc)

        before = page.evaluate(READ_STATE)
        page.screenshot(path=os.path.join(OUT, "01-before-reset.png"))
        log.append({"stage": "before", **before})

        page.locator('button[aria-label="تصفير وإعادة فحص"]').first.click()
        page.wait_for_timeout(2500)

        after_reset = page.evaluate(READ_STATE)
        page.screenshot(path=os.path.join(OUT, "02-after-reset.png"))
        log.append({"stage": "after_reset", **after_reset})

        # Past a full scheduler tick (5s initial + 30s interval).
        page.wait_for_timeout(40000)
        after_tick = page.evaluate(READ_STATE)
        page.screenshot(path=os.path.join(OUT, "03-after-scheduler-tick.png"))
        log.append({"stage": "after_scheduler_tick", **after_tick})

        page.reload(wait_until="networkidle")
        page.wait_for_timeout(3000)
        after_reload = page.evaluate(READ_STATE)
        page.screenshot(path=os.path.join(OUT, "04-after-reload.png"))
        log.append({"stage": "after_reload", **after_reload})

        page.set_viewport_size({"width": 390, "height": 844})
        page.wait_for_timeout(1200)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth > window.innerWidth + 1"
        )
        page.screenshot(path=os.path.join(OUT, "05-mobile-after-reset.png"))
        log.append({"stage": "mobile", "overflow": overflow})

        browser.close()

    passed = (
        after_reset["count"] == 0
        and after_reset["cards"] == 0
        and after_tick["count"] == 0
        and after_tick["cards"] == 0
        and after_reload["count"] == 0
        and after_reload["cards"] == 0
        and after_reset["locked"] is True
        and after_reload["locked"] is True
        and overflow is False
    )

    print(json.dumps({"pass": passed, "log": log}, ensure_ascii=False, indent=2))
    with open(os.path.join(OUT, "result.json"), "w", encoding="utf-8") as f:
        json.dump({"pass": passed, "log": log}, f, ensure_ascii=False, indent=2)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
