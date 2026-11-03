/**
 * The STUN server a new install starts with. Nextcloud runs it for self-hosted
 * Talk, which is the same audience. It only ever reaches a browser through the
 * admin setting; nothing falls back to it behind the admin's back.
 */
export const DEFAULT_PUBLIC_STUN_URLS = ["stun:stun.nextcloud.com:443"] as const;

export const DEFAULT_PUBLIC_STUN_URLS_CSV = DEFAULT_PUBLIC_STUN_URLS.join(", ");
