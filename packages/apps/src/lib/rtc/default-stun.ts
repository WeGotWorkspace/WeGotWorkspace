/**
 * Exactly two servers, on two different hosts. The network pre-check compares
 * the mapped port each host reports back: one host cannot reveal a symmetric
 * NAT, and a third would cost a round of gathering without changing the
 * verdict. Port 443 first, because it survives the stricter outbound filters.
 */
export const DEFAULT_PUBLIC_STUN_URLS = [
  "stun:stun.nextcloud.com:443",
  "stun:stun.sipgate.net:3478",
] as const;

export const DEFAULT_PUBLIC_STUN_URLS_CSV = DEFAULT_PUBLIC_STUN_URLS.join(", ");
