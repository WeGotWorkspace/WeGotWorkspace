/**
 * Contract C2 collaboration ticket, receiving half.
 *
 * The server mints `base64url(JSON payload) . "." . base64url(signature)` and
 * signs the first segment with ECDSA P-256 / SHA-256. The signature is IEEE
 * P1363 (r‖s, 64 bytes) because that is the only encoding
 * `crypto.subtle.verify` accepts.
 *
 * A ticket is the only thing that makes a peer on the principal mesh
 * trustworthy, so every field is checked against what this client already
 * knows: the room it is in, the username the principal link authenticated and
 * the collab peer id the envelope claims. `access` is read from the verified
 * payload and never from the envelope.
 */

import type { DocsCollabAccess } from "./docs-collab-access";

/** Clock skew C2 allows between the signing server and this browser. */
export const COLLAB_TICKET_SKEW_SECONDS = 60;

/** Below this much remaining lifetime the poll response carries a fresh ticket. */
export const COLLAB_TICKET_REFRESH_SECONDS = 300;

export type DocsCollabTicketPayload = {
  v: 1;
  kid: string;
  room: string;
  user: string;
  peer: string;
  access: DocsCollabAccess;
  iat: number;
  exp: number;
  /** Reserved for Adaptive Mesh (#580) sender public keys. Ignored in v1. */
  spk?: unknown;
};

/** Public half of the signing pair, as the server publishes it. */
export type DocsCollabTicketJwk = {
  kty: string;
  crv: string;
  x: string;
  y: string;
  kid: string;
  alg?: string;
  use?: string;
};

export type DocsCollabTicketClaims = {
  /** C5 room key this client resolved for its own room. */
  room: string;
  /** Username the principal link authenticated for the sender. */
  user: string;
  /** Collab peer id the envelope claims. */
  peer: string;
};

const ACCESS_VALUES = new Set<string>(["read", "comment", "write"]);

/** Successful ECDSA results, keyed by the ticket string, dropped at `exp`. */
const verifiedTicketPayloads = new Map<string, DocsCollabTicketPayload>();

/** Tests isolate tickets that would otherwise stay verified until `exp`. */
export function clearCollabTicketVerifyCacheForTests(): void {
  verifiedTicketPayloads.clear();
}

function cachedVerifiedPayload(ticket: string, nowSeconds: number): DocsCollabTicketPayload | null {
  const cached = verifiedTicketPayloads.get(ticket);
  if (!cached) return null;
  if (cached.exp <= nowSeconds) {
    verifiedTicketPayloads.delete(ticket);
    return null;
  }
  return cached;
}

export function base64UrlToBytes(encoded: string): Uint8Array | null {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  if (remainder === 1) return null;
  try {
    const raw = atob(remainder === 0 ? padded : padded + "=".repeat(4 - remainder));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Read the payload without checking the signature. Only ever safe for logging
 * a refresh decision about a ticket this client was handed by the server — an
 * inbound ticket has to go through {@link verifyCollabTicket}.
 */
export function decodeCollabTicketPayload(ticket: string): DocsCollabTicketPayload | null {
  const segments = ticket.split(".");
  if (segments.length !== 2) return null;
  const bytes = base64UrlToBytes(segments[0]!);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const payload = parsed as Record<string, unknown>;
  if (payload.v !== 1) return null;
  for (const field of ["kid", "room", "user", "peer", "access"] as const) {
    if (typeof payload[field] !== "string" || payload[field] === "") return null;
  }
  if (!ACCESS_VALUES.has(payload.access as string)) return null;
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
  return payload as unknown as DocsCollabTicketPayload;
}

/** True once the ticket this client holds is inside the C2 refresh window. */
export function collabTicketNeedsRefresh(ticket: string, nowSeconds: number): boolean {
  const payload = decodeCollabTicketPayload(ticket);
  if (!payload) return true;
  return payload.exp - nowSeconds < COLLAB_TICKET_REFRESH_SECONDS;
}

/**
 * Contract C5 room key: the sha1 of the canonical room, the same digest the
 * server stores on the signaling rows and names in the ticket.
 */
export async function collabRoomKey(
  canonicalRoom: string,
  subtle = crypto.subtle,
): Promise<string> {
  const digest = await subtle.digest("SHA-1", new TextEncoder().encode(canonicalRoom));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Verify a ticket and return its payload, or null when anything fails. A null
 * means the caller drops the envelope silently and falls back to a fresh collab
 * ICE dial — it never means "accept with reduced rights".
 */
export async function verifyCollabTicket(input: {
  ticket: string;
  claims: DocsCollabTicketClaims;
  /** Resolves the published key for a `kid`; unknown ids return null. */
  resolveKey: (kid: string) => Promise<CryptoKey | null>;
  nowSeconds?: number;
  subtle?: SubtleCrypto;
}): Promise<DocsCollabTicketPayload | null> {
  const payload = decodeCollabTicketPayload(input.ticket);
  if (!payload) return null;

  const { room, user, peer } = input.claims;
  if (payload.room !== room || payload.user !== user || payload.peer !== peer) return null;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.exp + COLLAB_TICKET_SKEW_SECONDS <= now) return null;
  if (payload.iat - COLLAB_TICKET_SKEW_SECONDS > now) return null;

  const key = await input.resolveKey(payload.kid);
  if (!key) return null;

  const cached = cachedVerifiedPayload(input.ticket, now);
  if (cached) return cached;

  const signature = base64UrlToBytes(input.ticket.split(".")[1]!);
  if (!signature || signature.length !== 64) return null;

  const subtle = input.subtle ?? crypto.subtle;
  const signingInput = new TextEncoder().encode(input.ticket.split(".")[0]!);
  let valid = false;
  try {
    valid = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature as unknown as BufferSource,
      signingInput as unknown as BufferSource,
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  verifiedTicketPayloads.set(input.ticket, payload);
  return payload;
}

/**
 * Caches the imported public key per `kid`, the way C2 asks clients to. A
 * rotation publishes a new id, so a new entry appears and the old tickets
 * expire on their own rather than being revoked. A null result is dropped
 * from the cache so a key that shows up later can still be imported.
 */
export function createCollabTicketKeyCache(
  fetchJwk: (kid: string) => Promise<DocsCollabTicketJwk | null>,
  subtle = crypto.subtle,
): (kid: string) => Promise<CryptoKey | null> {
  const keys = new Map<string, Promise<CryptoKey | null>>();
  return (kid: string): Promise<CryptoKey | null> => {
    const cached = keys.get(kid);
    if (cached) return cached;
    const pending = (async (): Promise<CryptoKey | null> => {
      const jwk = await fetchJwk(kid);
      if (!jwk || jwk.kid !== kid || jwk.kty !== "EC" || jwk.crv !== "P-256") return null;
      try {
        return await subtle.importKey(
          "jwk",
          { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["verify"],
        );
      } catch {
        return null;
      }
    })();
    keys.set(kid, pending);
    void pending.then(
      (key) => {
        if (key === null) keys.delete(kid);
      },
      () => {
        keys.delete(kid);
      },
    );
    return pending;
  };
}
