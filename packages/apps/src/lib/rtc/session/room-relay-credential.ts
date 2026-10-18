import type { TurnCredentials } from "@/lib/rtc/types";

/** Re-mint this long before the server-supplied `ttl` elapses. */
const REFRESH_LEAD_MS = 60_000;

export function refreshLeadMs(ttlMs: number): number {
  return Math.min(REFRESH_LEAD_MS, Math.floor(ttlMs / 2));
}

export type IssuedTurn = { turn: TurnCredentials; issuedAtMs: number };

/** `ttl` is seconds from the relay response, not a client constant. */
export function credentialIsStale(issued: IssuedTurn, now: number): boolean {
  const ttlMs = issued.turn.ttl * 1000;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return true;
  return now >= issued.issuedAtMs + Math.max(0, ttlMs - refreshLeadMs(ttlMs));
}

/** The same credential, with `ttl` counted from `now` instead of from the mint. */
function remaining(issued: IssuedTurn, now: number): TurnCredentials {
  const left = Math.floor((issued.issuedAtMs + issued.turn.ttl * 1000 - now) / 1000);
  return { ...issued.turn, ttl: Math.max(0, left) };
}

type RelayPost = () => Promise<{ turn: TurnCredentials }>;

export type RoomRelayCredentialPorts = {
  /** A credential minted elsewhere in this room, such as the mesh precheck. */
  shared?: () => IssuedTurn | null;
  /** Test clock. Production uses `Date.now`. */
  now?: () => number;
};

/**
 * One TURN credential per room. The server mints it for the account, not for
 * a room, peer or target (`RtcTurnCredentialService::mint`), so every peer can
 * share it until its refresh window. The relay limit is six per account per
 * minute across tabs, so a mint per peer runs out with two tabs open.
 *
 * Concurrent asks share one POST. A failure is not kept: the next ask posts.
 * A reused credential sends no `relay-hint`, which only kicks the other
 * side's poll; that side still asks for its own relay on its next poll.
 */
export class RoomRelayCredential {
  private issued: IssuedTurn | null = null;

  private inflight: Promise<{ turn: TurnCredentials }> | null = null;

  constructor(private readonly ports: RoomRelayCredentialPorts = {}) {}

  request(post: RelayPost): Promise<{ turn: TurnCredentials }> {
    const now = this.now();
    const live = [this.ports.shared?.() ?? null, this.issued].find(
      (issued): issued is IssuedTurn => issued !== null && !credentialIsStale(issued, now),
    );
    if (live) return Promise.resolve({ turn: remaining(live, now) });
    if (this.inflight) return this.inflight;
    const pending = post()
      .then((response) => {
        this.issued = { turn: response.turn, issuedAtMs: this.now() };
        return response;
      })
      .finally(() => {
        if (this.inflight === pending) this.inflight = null;
      });
    this.inflight = pending;
    return pending;
  }

  private now(): number {
    return this.ports.now?.() ?? Date.now();
  }
}
