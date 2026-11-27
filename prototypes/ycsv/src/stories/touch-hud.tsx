import { useEffect, useState } from "react";

/**
 * Spike 7 frame meter for real devices (iOS Simulator, a phone): while the grid
 * scrolls it records rAF frame gaps and whether the rendered rows still cover
 * the viewport. Results stay on screen for a screenshot and on
 * `window.__touchHud` for scripts.
 */
export type HudStats = {
  frames: number;
  fps: number;
  p95: number;
  worst: number;
  over20: number;
  /** Frames where the DOM rows did not cover what scrollTop says is visible. */
  gaps: number;
  rows: string;
};

declare global {
  interface Window {
    __touchHud?: HudStats & { reset: () => void; log: number[] };
  }
}

export function TouchHud() {
  const [stats, setStats] = useState<HudStats | null>(null);
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="grid"]');
    if (!scroller) return;
    let gaps: number[] = [];
    let missing = 0;
    let last = 0;
    let lastScroll = 0;
    let raf = 0;
    const publish = () => {
      if (gaps.length < 2) return;
      const sorted = [...gaps].sort((a, b) => a - b);
      const total = gaps.reduce((a, b) => a + b, 0);
      const body = document.querySelector<HTMLElement>('[data-testid="body"]');
      const s: HudStats = {
        frames: gaps.length,
        fps: Math.round((gaps.length / total) * 1000),
        p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
        worst: Math.round(sorted[sorted.length - 1] ?? 0),
        over20: gaps.filter((g) => g > 20).length,
        gaps: missing,
        rows: body?.dataset.rows ?? "",
      };
      setStats(s);
      window.__touchHud = { ...s, reset, log: gaps };
    };
    const reset = () => {
      gaps = [];
      missing = 0;
      last = 0;
    };
    const tick = (t: number) => {
      raf = 0;
      if (t - lastScroll > 250) {
        publish();
        last = 0;
        return;
      }
      if (last) gaps.push(t - last);
      last = t;
      const body = document.querySelector<HTMLElement>('[data-testid="body"]');
      const [first, lastRow] = (body?.dataset.rows ?? "0-0").split("-").map(Number);
      const rowH = Number(body?.dataset.rowH ?? 36);
      const top = scroller.scrollTop;
      const visFirst = Math.floor(top / rowH);
      const visLast = Math.floor((top + scroller.clientHeight) / rowH);
      if ((first ?? 0) > visFirst || (lastRow ?? 0) < Math.min(visLast, Number(scroller.getAttribute("aria-rowcount")) - 2)) missing += 1;
      raf = requestAnimationFrame(tick);
    };
    const onScroll = () => {
      lastScroll = performance.now();
      if (!raf) {
        reset();
        raf = requestAnimationFrame(tick);
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.__touchHud = { frames: 0, fps: 0, p95: 0, worst: 0, over20: 0, gaps: 0, rows: "", reset, log: [] };
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <div
      data-testid="hud"
      style={{
        position: "fixed",
        right: 6,
        bottom: 30,
        zIndex: 100,
        font: "11px/1.35 ui-monospace, Menlo, monospace",
        background: "rgb(0 0 0 / 0.75)",
        color: "#fff",
        padding: "4px 6px",
        borderRadius: 4,
        pointerEvents: "none",
        whiteSpace: "pre",
      }}
    >
      {stats
        ? `${stats.fps} fps · ${stats.frames} frames\np95 ${stats.p95} ms · worst ${stats.worst} ms\n>20 ms: ${stats.over20} · blank: ${stats.gaps}\nrows ${stats.rows}`
        : "scroll to measure"}
    </div>
  );
}
