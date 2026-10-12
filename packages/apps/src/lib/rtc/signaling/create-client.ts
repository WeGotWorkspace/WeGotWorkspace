import { wgwApiBaseUrl, wgwFetch } from "@/lib/api/wgw/http";
import {
  HttpSignalingClient,
  type HttpSignalingClientOptions,
  type HttpSignalingFetch,
} from "@/lib/rtc/signaling/http-client";
import type { SignalingChannel } from "@/lib/rtc/types";
import { readRtcBrowserId } from "@/lib/rtc/signaling/browser-id";
import { signalingApiSegment } from "@/lib/rtc/types";

export type RtcSignalingAuth = {
  bearerToken?: string;
  sessionKey?: string;
};

export type CreateRtcSignalingClientOptions = {
  channel: SignalingChannel;
  apiBase?: string;
  fetchImpl?: HttpSignalingFetch;
  getAuth?: () => RtcSignalingAuth;
  sendFromField?: "from" | "peerId";
};

function channelApiBase(channel: SignalingChannel, apiBase?: string): string {
  if (apiBase) return apiBase.replace(/\/$/, "");
  return `${wgwApiBaseUrl()}/${signalingApiSegment(channel)}`;
}

export function createWgwSignalingFetch(): HttpSignalingFetch {
  return (url, init) => {
    const base = wgwApiBaseUrl();
    const path = url.startsWith(base) ? url.slice(base.length) : url;
    return wgwFetch(path.startsWith("/") ? path : `/${path}`, init);
  };
}

const CHANNEL_DEFAULTS: Partial<
  Record<SignalingChannel, Pick<HttpSignalingClientOptions, "sendFromField" | "caps">>
> = {
  // `bin` opts this client into chunked binary data-channel frames (#1093).
  collab: { sendFromField: "peerId", caps: ["bin", "yjs-http", "relay-jit"] },
  principal: { caps: ["bin"] },
  // `since-ack` opts this client into the acked meet mailbox: the server stops
  // deleting rows on read, so a lost poll response is redelivered (#1086).
  meet: { sendFromField: "from", caps: ["since-ack", "ice-batch", "relay-jit", "meet-dc"] },
};

/** Shared HTTP signaling client for meet, docs, and future RTC apps. */
export function createRtcSignalingClient(
  options: CreateRtcSignalingClientOptions,
): HttpSignalingClient {
  const channelDefaults = CHANNEL_DEFAULTS[options.channel] ?? {};
  return new HttpSignalingClient({
    channel: options.channel,
    apiBase: channelApiBase(options.channel, options.apiBase),
    fetchImpl: options.fetchImpl ?? createWgwSignalingFetch(),
    getAuth: options.getAuth ?? (() => ({})),
    sendFromField: options.sendFromField ?? channelDefaults.sendFromField ?? "from",
    caps: channelDefaults.caps,
    getBrowserId:
      options.channel === "meet" || options.channel === "collab" || options.channel === "principal"
        ? readRtcBrowserId
        : undefined,
  });
}
