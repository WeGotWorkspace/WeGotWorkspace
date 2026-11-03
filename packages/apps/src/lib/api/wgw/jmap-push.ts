import {
  wgwApiBaseUrl,
  wgwAwaitSessionRefreshForReconnect,
  wgwFetch,
  wgwIsGuestSession,
  wgwLiveApiEnabled,
} from "@/lib/api/wgw/http";
import { JmapRequestError } from "@/lib/jmap-client/core/errors";
import { EventSourceTransport } from "@/lib/jmap-client/push/event-source-transport";
import { isPushMessage, JmapPushHub, type PushMessage } from "@/lib/jmap-client/push/jmap-push-hub";
import { browserWebLocks } from "@/lib/jmap-client/push/web-locks-leader";
import { getConnectivitySnapshot, subscribeBrowserOnline } from "@/lib/offline/core/browser-online";
import { crossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { readRtcBrowserId } from "@/lib/rtc/signaling/browser-id";

const CHANNEL = "wgw-jmap-push";
/** Header the push rate limiter keys its per-browser bucket on (`JmapPushRateLimiters`). */
const BROWSER_ID_HEADER = "X-WGW-Browser-Id";

/**
 * The advertised `eventSourceUrl` expanded for this client (`types=*`,
 * `closeafter=state`, `ping=0`) and made relative to the API base, because
 * `wgwFetch` adds the base itself.
 */
export function eventSourcePath(template: string, origin: string): string {
  const expanded = template
    .replace("{types}", "*")
    .replace("{closeafter}", "state")
    .replace("{ping}", "0");
  const url = new URL(expanded, origin);
  const path = url.pathname + url.search;
  // The base is a path (`/api/v1`) or an absolute URL; compare its path part.
  const base = new URL(wgwApiBaseUrl(), origin).pathname.replace(/\/$/, "");
  return path.startsWith(`${base}/`) ? path.slice(base.length) : path;
}

/**
 * Reads `eventSourceUrl` from the JMAP session. Null means no push for this
 * session (a guest share, or a server that advertises none); a failed request
 * throws, so the transport backs off and asks again.
 */
export async function resolveEventSourcePath(origin: string): Promise<string | null> {
  if (wgwIsGuestSession()) return null;
  const response = await wgwFetch("/jmap/session", { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new JmapRequestError(`Failed to fetch JMAP session (${response.status})`, {
      status: response.status,
    });
  }
  const session = (await response.json()) as { eventSourceUrl?: unknown };
  return typeof session.eventSourceUrl === "string"
    ? eventSourcePath(session.eventSourceUrl, origin)
    : null;
}

function documentVisibility() {
  return {
    visible: () => document.visibilityState === "visible",
    subscribe: (listener: () => void) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

function randomTabId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createHub(): JmapPushHub {
  let path: Promise<string | null> | null = null;
  const resolvePath = () => {
    path ??= resolveEventSourcePath(window.location.origin).catch((error: unknown) => {
      path = null;
      throw error;
    });
    return path;
  };
  return new JmapPushHub({
    tabId: randomTabId(),
    topic: crossTabTopic<PushMessage>(CHANNEL, isPushMessage),
    locks: browserWebLocks(),
    visibility: documentVisibility(),
    onPageHide: (listener) => {
      window.addEventListener("pagehide", listener);
      return () => window.removeEventListener("pagehide", listener);
    },
    createEventSource: (ctx) =>
      new EventSourceTransport({
        url: resolvePath,
        fetch: (url, init) => wgwFetch(url, init),
        lastEventId: ctx.lastEventId,
        everyTabHidden: ctx.everyTabHidden,
        onStatus: ctx.onStatus,
        connectivity: {
          online: getConnectivitySnapshot,
          subscribe: (listener) =>
            subscribeBrowserOnline(() => listener(getConnectivitySnapshot())),
        },
        refreshAuth: wgwAwaitSessionRefreshForReconnect,
        headers: (): Record<string, string> => {
          const browserId = readRtcBrowserId();
          return browserId ? { [BROWSER_ID_HEADER]: browserId } : {};
        },
      }),
  });
}

let hub: JmapPushHub | null | undefined;

/**
 * This tab's JMAP push hub, or null with mock data (Storybook, tests) or
 * outside a browser. It opens no stream until an app subscribes.
 */
export function defaultJmapPushHub(): JmapPushHub | null {
  if (hub !== undefined) return hub;
  hub = typeof window !== "undefined" && wgwLiveApiEnabled() ? createHub() : null;
  return hub;
}
