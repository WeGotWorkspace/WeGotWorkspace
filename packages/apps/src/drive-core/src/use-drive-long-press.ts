import { useRef } from "react";

/** Long press on a touch screen opens the item menu, as a right click does. */
export function useLongPress(handler: () => void) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  return {
    fired,
    start: () => {
      fired.current = false;
      t.current = setTimeout(() => {
        fired.current = true;
        handler();
        if ("vibrate" in navigator) navigator.vibrate?.(15);
      }, 450);
    },
    cancel: () => {
      if (t.current) clearTimeout(t.current);
      t.current = null;
    },
  };
}
