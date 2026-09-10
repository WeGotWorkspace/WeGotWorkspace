import { useEffect, useRef, useState } from "react";
import { REFRESH_SPIN_CYCLE_MS, msUntilRefreshSpinComplete } from "@/refresh-spin/src/refresh-spin";

/**
 * Keeps a refresh icon spinning while `active` is true, and until at least one
 * full 360° cycle has finished (never stops mid-rotation).
 *
 * Cycle timing is anchored to when the spin class is applied so removal lines up
 * with the CSS `animation-duration` (see `refresh-spin.css`).
 */
export function useRefreshSpin(active: boolean): boolean {
  const [spinning, setSpinning] = useState(active);
  const startedAtRef = useRef<number | null>(active ? Date.now() : null);

  useEffect(() => {
    if (active) {
      if (!spinning) {
        startedAtRef.current = Date.now();
        setSpinning(true);
      }
      return;
    }

    if (!spinning) {
      startedAtRef.current = null;
      return;
    }

    const startedAt = startedAtRef.current ?? Date.now();
    const remaining = msUntilRefreshSpinComplete(startedAt, Date.now(), REFRESH_SPIN_CYCLE_MS);

    if (remaining === 0) {
      startedAtRef.current = null;
      setSpinning(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      startedAtRef.current = null;
      setSpinning(false);
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [active, spinning]);

  return spinning;
}
