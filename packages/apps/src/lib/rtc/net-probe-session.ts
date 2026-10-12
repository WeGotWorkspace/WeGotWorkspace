import { parseUrlList } from "@/lib/rtc/config";
import { DEFAULT_PUBLIC_STUN_URLS } from "@/lib/rtc/default-stun";
import { getNetClass, peekNetClass, resetNetClass, type NetClass } from "@/lib/rtc/net-probe";
import type { RtcSettings } from "@/lib/rtc/types";

type NetworkInformation = EventTarget & { type?: string };

function connectionOf(nav: Navigator): NetworkInformation | null {
  const candidate = (nav as Navigator & { connection?: NetworkInformation }).connection;
  return candidate && typeof candidate.addEventListener === "function" ? candidate : null;
}

function stunHost(url: string): string {
  return (url.replace(/^stuns?:/i, "").split(":")[0] ?? "").toLowerCase();
}

/**
 * Two different hosts, or the built-in pair. One host cannot show a symmetric
 * NAT, which is the only thing the pre-check is for.
 */
export function stunUrlsForProbe(configured: readonly string[]): readonly string[] {
  const hosts = new Set(configured.map(stunHost).filter((host) => host !== ""));
  return hosts.size >= 2 ? configured : DEFAULT_PUBLIC_STUN_URLS;
}

export function stunUrlsFromSettings(settings: RtcSettings): readonly string[] {
  return stunUrlsForProbe(parseUrlList(settings.stunUrls, "stun"));
}

let installedKey = "";
let uninstall: (() => void) | null = null;

/**
 * Probe once per session and again when the network changes. Meet and collab
 * both read the cached class; this installer does not import either of them.
 */
export function installNetProbe(configured: readonly string[] = []): () => void {
  const urls = stunUrlsForProbe(configured);
  const key = urls.join("|");
  if (uninstall && key === installedKey) return uninstall;

  uninstall?.();
  installedKey = key;
  resetNetClass();
  void getNetClass({ stunUrls: urls });

  const onChange = () => {
    resetNetClass();
    void getNetClass({ stunUrls: urls });
  };

  const target = typeof window === "undefined" ? null : window;
  const connection = typeof navigator === "undefined" ? null : connectionOf(navigator);
  target?.addEventListener("online", onChange);
  connection?.addEventListener("change", onChange);

  uninstall = () => {
    target?.removeEventListener("online", onChange);
    connection?.removeEventListener("change", onChange);
    if (installedKey === key) {
      installedKey = "";
      uninstall = null;
    }
  };
  return uninstall;
}

/** The class to put on a join body. Starts a probe when nothing is cached yet. */
export async function netClassForJoin(settings: RtcSettings): Promise<NetClass> {
  const cached = peekNetClass();
  if (cached) return cached;
  return getNetClass({ stunUrls: stunUrlsFromSettings(settings) });
}
