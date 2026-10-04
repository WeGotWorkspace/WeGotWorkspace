import { rtcLog } from "@/lib/rtc/log";
import type { NetClass } from "@/lib/rtc/net-probe";
import { resolveRoomId } from "@/lib/rtc/room-id";
import type { RelayReason } from "@/lib/rtc/session/relay-request";
import type {
  RtcPeerCap,
  RtcPeerDescriptor,
  SignalingChannel,
  TurnCredentials,
} from "@/lib/rtc/types";

export type HttpSignalingAuth = {
  bearerToken?: string;
  sessionKey?: string;
};

export type HttpSignalingJoinInput = {
  room: string;
  name: string;
  peerId?: string;
  /** Guest re-join (admit rename) must keep the same owner marker. */
  sessionKey?: string;
  /** Network class from the pre-check. Only the class, never an address. */
  net?: NetClass;
};

export type HttpSignalingVideoLimits = {
  maxPeers?: number;
  maxVideoProfile?: string;
  maxVideoProfileRelay?: string;
};

export type HttpSignalingJoinResult = {
  peerId?: string;
  sessionKey?: string | null;
  peers: RtcPeerDescriptor[];
  rtc?: { limits?: HttpSignalingVideoLimits };
  /** Signed collaboration ticket for this peer. Collaboration rooms only. */
  ticket?: string;
};

export type HttpSignalingPollInput = {
  room: string;
  peerId: string;
  since?: number;
  /** Roster signature from a previous poll; lets the server answer 204 when nothing changed. */
  sig?: string;
  sessionKey?: string;
};

export type HttpSignalingPollMessage = {
  id?: number;
  from: string;
  type: string;
  payload: unknown;
};

export type HttpSignalingPollResult = {
  peers: RtcPeerDescriptor[];
  messages: HttpSignalingPollMessage[];
  /** Echo via `sig` on the next poll to opt into 204 "nothing new" responses. */
  rosterSig?: string;
  /** Fresh collaboration ticket when the server refreshed it. */
  ticket?: string;
};

/** 204 "nothing new" poll response: roster unchanged and no pending messages. */
export type HttpSignalingPollUnchanged = {
  unchanged: true;
};

export type HttpSignalingPollResponse = HttpSignalingPollResult | HttpSignalingPollUnchanged;

export function isUnchangedPollResponse(
  response: HttpSignalingPollResponse,
): response is HttpSignalingPollUnchanged {
  return "unchanged" in response && response.unchanged === true;
}

export type HttpSignalingSendInput = {
  room: string;
  from: string;
  to: string;
  type: string;
  payload: unknown;
  sessionKey?: string;
};

export type HttpSignalingLeaveInput = {
  room: string;
  peerId: string;
  sessionKey?: string;
};

export type HttpSignalingFetch = (url: string, init: RequestInit) => Promise<Response>;

export type HttpSignalingClientOptions = {
  channel: SignalingChannel;
  apiBase: string;
  fetchImpl?: HttpSignalingFetch;
  getAuth?: () => HttpSignalingAuth;
  /** Collab API uses `peerId` instead of `from` on send. */
  sendFromField?: "from" | "peerId";
  /** Meet: stable per-browser token so a reload evicts the leftover peer. */
  getBrowserId?: () => string | undefined;
  /** Wire capabilities advertised at join (contract C8); the server gates behavior on them. */
  caps?: RtcPeerCap[];
};

/**
 * One hung request used to wedge the poll loop forever: `pollInFlight` stayed
 * true and nothing rescheduled. Ten seconds is well above the slowest healthy
 * poll and well below the peer timeout, so an aborted poll costs one cycle.
 */
const POLL_TIMEOUT_MS = 10_000;

/** jsdom and older runtimes may not implement it; a missing timeout is not worth a crash. */
function pollTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(POLL_TIMEOUT_MS)
    : undefined;
}

export class HttpSignalingClient {
  private readonly channel: SignalingChannel;

  private readonly apiBase: string;

  private readonly fetchImpl: HttpSignalingFetch;

  private readonly getAuth: () => HttpSignalingAuth;

  private readonly sendFromField: "from" | "peerId";

  private readonly getBrowserId: (() => string | undefined) | undefined;

  private readonly caps: RtcPeerCap[];

  constructor(options: HttpSignalingClientOptions) {
    this.channel = options.channel;
    this.apiBase = options.apiBase.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.getAuth = options.getAuth ?? (() => ({}));
    this.sendFromField = options.sendFromField ?? "from";
    this.getBrowserId = options.getBrowserId;
    this.caps = options.caps ?? [];
  }

  private roomUrl(room: string, suffix: string): string {
    const roomId = resolveRoomId(this.channel, room);
    return `${this.apiBase}/${encodeURIComponent(roomId)}${suffix}`;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    const { bearerToken } = this.getAuth();
    if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
    return headers;
  }

  private withSessionKey<T extends Record<string, unknown>>(body: T): T {
    const { sessionKey } = this.getAuth();
    if (!sessionKey) return body;
    return { ...body, sessionKey };
  }

  private async parseJsonResponse<T>(res: Response, action: string, text: string): Promise<T> {
    rtcLog({ channel: this.channel }, "signal-response", {
      action,
      status: res.status,
      ok: res.ok,
      bytes: text.length,
    });
    if (text.startsWith("<?php") || text.trimStart().startsWith("<!")) {
      throw new Error("Signaling endpoint returned HTML instead of JSON.");
    }
    let data: { error?: string; message?: string };
    try {
      data = JSON.parse(text) as { error?: string; message?: string };
    } catch {
      throw new Error(`Invalid signaling response (${res.status}): ${text.slice(0, 80)}`);
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `${res.status} ${res.statusText}`);
    }
    return data as T;
  }

  private async post<T>(action: string, url: string, body: Record<string, unknown>): Promise<T> {
    rtcLog({ channel: this.channel }, "signal-request", { action, requestUrl: url });
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return this.parseJsonResponse<T>(res, action, text);
  }

  private async del<T>(action: string, url: string, body?: Record<string, unknown>): Promise<T> {
    rtcLog({ channel: this.channel }, "signal-request", { action, requestUrl: url });
    const res = await this.fetchImpl(url, {
      method: "DELETE",
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
      keepalive: true,
    });
    const text = await res.text();
    return this.parseJsonResponse<T>(res, action, text);
  }

  join(input: HttpSignalingJoinInput): Promise<HttpSignalingJoinResult> {
    const body: Record<string, unknown> = {
      room: input.room,
      name: input.name,
    };
    if (input.peerId) body.peerId = input.peerId;
    if (input.net) body.net = input.net;
    if (this.caps.length > 0) body.caps = this.caps;
    const browserId = this.getBrowserId?.();
    if (browserId) body.browserId = browserId;
    const sessionKey = input.sessionKey ?? this.getAuth().sessionKey;
    if (sessionKey) body.sessionKey = sessionKey;
    return this.post<HttpSignalingJoinResult>(
      "join",
      this.roomUrl(input.room, "/participants"),
      body,
    );
  }

  async poll(input: HttpSignalingPollInput): Promise<HttpSignalingPollResponse> {
    const params = new URLSearchParams();
    params.set("peerId", input.peerId);
    if (input.since !== undefined) params.set("since", String(input.since));
    if (input.sig) params.set("sig", input.sig);
    const sessionKey = input.sessionKey ?? this.getAuth().sessionKey;
    if (sessionKey) params.set("sessionKey", sessionKey);

    const url = `${this.roomUrl(input.room, "/events")}?${params.toString()}`;
    rtcLog({ channel: this.channel }, "signal-request", { action: "poll", requestUrl: url });
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: this.headers(),
      signal: pollTimeoutSignal(),
    });
    if (res.status === 204) {
      rtcLog({ channel: this.channel }, "signal-response", {
        action: "poll",
        status: res.status,
        ok: true,
        bytes: 0,
      });
      return { unchanged: true };
    }
    const text = await res.text();
    return this.parseJsonResponse<HttpSignalingPollResult>(res, "poll", text);
  }

  /**
   * `POST /rooms/{roomId}/relay`. Always sent when the caller needs a relay,
   * including when the server will answer 503, so the need is recorded.
   */
  relay(input: {
    room: string;
    peerId: string;
    target: string;
    reason: RelayReason;
    net?: NetClass;
    sessionKey?: string;
  }): Promise<{ turn: TurnCredentials }> {
    const body: Record<string, unknown> = {
      peerId: input.peerId,
      target: input.target,
      reason: input.reason,
    };
    if (input.net) body.net = input.net;
    if (input.sessionKey) body.sessionKey = input.sessionKey;
    return this.post("relay", this.roomUrl(input.room, "/relay"), this.withSessionKey(body));
  }

  send(input: HttpSignalingSendInput): Promise<unknown> {
    const body: Record<string, unknown> = {
      room: input.room,
      [this.sendFromField]: input.from,
      to: input.to,
      type: input.type,
      payload: input.payload,
    };
    if (input.sessionKey) body.sessionKey = input.sessionKey;
    return this.post("send", this.roomUrl(input.room, "/events"), this.withSessionKey(body));
  }

  /**
   * `POST /rtc/metrics`. The sample is the contract allow-list. The room id
   * stays in the signaling URLs and is not copied onto this request.
   */
  async reportSessionMetric(
    sample: Record<string, unknown>,
    sessionKey?: string | null,
  ): Promise<void> {
    const params = new URLSearchParams();
    const key = sessionKey ?? this.getAuth().sessionKey;
    if (key) params.set("sessionKey", key);
    const query = params.toString();
    const root = this.apiBase.replace(/\/[^/]+$/, "");
    const url = `${root}/rtc/metrics${query ? `?${query}` : ""}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(sample),
      keepalive: true,
    });
    await res.text().catch(() => "");
  }

  leave(input: HttpSignalingLeaveInput): Promise<unknown> {
    const body: Record<string, unknown> = { room: input.room };
    if (input.sessionKey) body.sessionKey = input.sessionKey;
    return this.del(
      "leave",
      this.roomUrl(input.room, `/participants/${encodeURIComponent(input.peerId)}`),
      this.withSessionKey(body),
    );
  }
}
