import { useEffect, useState } from "react";

/**
 * Spike 7 — touch helpers for the cell grid. Everything here is geometry or
 * browser plumbing; the grid model (selection, overlay, one input) is unchanged.
 */

export type TouchVariant = "a" | "b";

/** `(pointer: coarse)`: a finger is the main pointer (phone, tablet without trackpad). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const set = () => setCoarse(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);
  return coarse;
}

export type VisualViewportBox = {
  /** Visible area in layout-viewport (client) coordinates. */
  top: number;
  left: number;
  width: number;
  height: number;
  scale: number;
  /** Height of whatever covers the bottom of the layout viewport (the on-screen keyboard). */
  keyboard: number;
};

function readViewport(): VisualViewportBox {
  const vv = window.visualViewport;
  const innerH = window.innerHeight;
  if (!vv) return { top: 0, left: 0, width: window.innerWidth, height: innerH, scale: 1, keyboard: 0 };
  // Only treat the gap as a keyboard when the page is not pinch-zoomed: a zoomed
  // visual viewport is smaller than the layout viewport for a different reason.
  const keyboard = vv.scale > 1.01 ? 0 : Math.max(0, Math.round(innerH - vv.height - vv.offsetTop));
  return { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height, scale: vv.scale, keyboard };
}

/**
 * The visible part of the page. On iOS Safari (and Chrome on Android since 108)
 * the on-screen keyboard shrinks the *visual* viewport and leaves the layout
 * viewport alone, so `position: fixed; bottom: 0` ends up under the keyboard.
 * Anything that must sit above the keyboard positions itself from this box.
 */
export function useVisualViewport(): VisualViewportBox {
  const [box, setBox] = useState<VisualViewportBox>(() =>
    typeof window === "undefined" ? { top: 0, left: 0, width: 0, height: 0, scale: 1, keyboard: 0 } : readViewport(),
  );
  useEffect(() => {
    const vv = window.visualViewport;
    const read = () =>
      setBox((prev) => {
        const next = readViewport();
        return prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height &&
          prev.scale === next.scale &&
          prev.keyboard === next.keyboard
          ? prev
          : next;
      });
    read();
    vv?.addEventListener("resize", read);
    vv?.addEventListener("scroll", read);
    window.addEventListener("resize", read);
    return () => {
      vv?.removeEventListener("resize", read);
      vv?.removeEventListener("scroll", read);
      window.removeEventListener("resize", read);
    };
  }, []);
  return box;
}

/**
 * Speed for edge auto-scroll: 0 outside the edge band, ramping up to `max`
 * px per frame as the finger goes deeper into (or past) the band.
 */
export function edgeSpeed(pos: number, low: number, high: number, band: number, max = 28): number {
  if (pos < low + band) {
    const depth = Math.min(band * 2, low + band - pos);
    return -Math.max(2, Math.round((depth / band) * (max / 2)));
  }
  if (pos > high - band) {
    const depth = Math.min(band * 2, pos - (high - band));
    return Math.max(2, Math.round((depth / band) * (max / 2)));
  }
  return 0;
}

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.8;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

const ZOOM_KEY = "ycsv-grid-zoom";
export function loadZoom(): number {
  try {
    const v = Number(window.localStorage.getItem(ZOOM_KEY));
    return v ? clampZoom(v) : 1;
  } catch {
    return 1;
  }
}
export function saveZoom(z: number): void {
  try {
    window.localStorage.setItem(ZOOM_KEY, String(z));
  } catch {
    /* private mode */
  }
}

/** Symbols that are a layer deep on phone keyboards, shown on a strip above the keyboard. */
export const FORMULA_KEYS = ["=", "(", ")", ":", ",", "+", "-", "*", "/", "$", '"'] as const;
