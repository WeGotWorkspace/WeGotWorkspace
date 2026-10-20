import { parseUrlList } from "@/lib/rtc/config";
import { getNetClass, peekNetClass, type NetClass } from "@/lib/rtc/net-probe";
import type { RtcSettings } from "@/lib/rtc/types";

function stunHost(url: string): string {
  return (url.replace(/^stuns?:/i, "").split(":")[0] ?? "").toLowerCase();
}

/** Distinct hosts in a STUN list. The pre-check needs two to see a symmetric NAT. */
export function stunHostCount(urls: readonly string[]): number {
  return new Set(urls.map(stunHost).filter((host) => host !== "")).size;
}

/**
 * The admin's STUN list, or nothing when it names fewer than two hosts. There
 * is no built-in fallback: the browser only ever contacts servers the admin
 * configured.
 */
export function stunUrlsForProbe(configured: readonly string[]): readonly string[] {
  return stunHostCount(configured) >= 2 ? configured : [];
}

export function stunUrlsFromSettings(settings: RtcSettings): readonly string[] {
  return stunUrlsForProbe(parseUrlList(settings.stunUrls, "stun"));
}

/**
 * The class to put on a join body. Starts a probe when nothing is cached yet,
 * and skips it when the settings cannot support one. That skip is not cached,
 * so a second STUN host added mid-session is picked up on the next join.
 */
export async function netClassForJoin(settings: RtcSettings): Promise<NetClass> {
  const cached = peekNetClass();
  if (cached) return cached;
  const stunUrls = stunUrlsFromSettings(settings);
  if (stunUrls.length === 0) return "unknown";
  return getNetClass({ stunUrls });
}
