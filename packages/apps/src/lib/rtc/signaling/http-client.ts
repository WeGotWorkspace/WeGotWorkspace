import { resolveRoomId } from "@/lib/rtc/room-id";
import type { SignalingChannel } from "@/lib/rtc/types";
import { rtcLog } from "@/lib/rtc/log";

export type HttpSignalingAuth = {
  bearerToken?: string;
  sessionKey?: string;
};

export type HttpSignalingJoinInput = {
  room: string;
  name: string;
  peerId?: string;
};

export type HttpSignalingJoinResult = {
  peerId?: string;
  sessionKey?: string | null;
  peers: Array<{ id: string; name: string; user?: string }>;
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
  peers: Array<{ id: string; name: string; user?: string }>;
  messages: HttpSignalingPollMessage[];
  /** Echo via `sig` on the next poll to opt into 204 "nothing new" responses. */
  rosterSig?: string;
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
};

export class HttpSignalingClient {
  private readonly channel: SignalingChannel;

  private readonly apiBase: string;

  private readonly fetchImpl: HttpSignalingFetch;

  private readonly getAuth: () => HttpSignalingAuth;

  private readonly sendFromField: "from" | "peerId";

  constructor(options: HttpSignalingClientOptions) {
    this.channel = options.channel;
    this.apiBase = options.apiBase.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.getAuth = options.getAuth ?? (() => ({}));
    this.sendFromField = options.sendFromField ?? "from";
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
    return this.post<HttpSignalingJoinResult>(
      "join",
      this.roomUrl(input.room, "/participants"),
      this.withSessionKey(body),
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
    const res = await this.fetchImpl(url, { method: "GET", headers: this.headers() });
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
