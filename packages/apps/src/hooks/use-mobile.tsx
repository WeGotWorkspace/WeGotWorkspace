import * as React from "react";

/**
 * Tailwind `md` (768px). Mobile is strictly below this so portrait iPad (768px)
 * is not treated as mobile — keep in sync with `(max-width: 767px)` / `max-md`.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/** `matchMedia` query for viewports that should use mobile chrome (dialog, sheet, …). */
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
