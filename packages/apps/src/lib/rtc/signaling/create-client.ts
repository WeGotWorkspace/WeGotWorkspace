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
  Record<SignalingChannel, Pick<HttpSignalingClientOptions, "sendFromField">>
> = {
  collab: { sendFromField: "peerId" },
  meet: { sendFromField: "from" },
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
    getBrowserId: options.channel === "meet" ? readRtcBrowserId : undefined,
  });
}
