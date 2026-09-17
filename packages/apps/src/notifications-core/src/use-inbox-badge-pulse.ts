import { useEffect, useRef, useState } from "react";

/**
 * Restartable `data-pulse` token for unread badge ::after animations.
 * Returns undefined until the first post-seed arrival, then a string that
 * changes whenever `unreadArrivalNonce` increments so CSS can re-fire.
 */
export function useInboxBadgePulseAttr(unreadArrivalNonce: number | undefined): string | undefined {
  const [attr, setAttr] = useState<string | undefined>(undefined);
  const prevNonceRef = useRef(0);

  useEffect(() => {
    const nonce = unreadArrivalNonce ?? 0;
    if (nonce <= 0 || nonce === prevNonceRef.current) return;
    prevNonceRef.current = nonce;
    setAttr(undefined);
    const frame = requestAnimationFrame(() => {
      setAttr(String(nonce));
    });
    return () => cancelAnimationFrame(frame);
  }, [unreadArrivalNonce]);

  return attr;
}
