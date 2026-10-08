import { applyRtcDebugOverrides } from "@/lib/rtc/force-relay";
import { DEFAULT_RTC_SETTINGS } from "@/lib/rtc/types";
import type { FetchedRtcSettings } from "@/lib/api/wgw/rtc";

export type DocsCollabAuthTokenInput = {
  authToken?: string;
  authTokenUrl?: string;
  authUser?: string;
  authPassword?: string;
};

export type DocsCollabWireOperations = {
  fetchAuthToken: (input: DocsCollabAuthTokenInput) => Promise<string | undefined>;
  fetchRtcSettings: (input: {
    url?: string;
    bearerToken?: string;
    channel: string;
  }) => Promise<FetchedRtcSettings>;
};

/** Offline / local-mesh default — no Laravel auth or RTC config fetch. */
export const DEFAULT_DOCS_COLLAB_WIRE: DocsCollabWireOperations = {
  async fetchAuthToken() {
    return undefined;
  },
  async fetchRtcSettings() {
    return applyRtcDebugOverrides({ ...DEFAULT_RTC_SETTINGS, forceRelay: false });
  },
};
