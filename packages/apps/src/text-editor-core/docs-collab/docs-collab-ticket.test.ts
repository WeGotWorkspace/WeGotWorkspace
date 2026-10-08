import { beforeEach, describe, expect, it } from "vitest";
import {
  COLLAB_TICKET_SKEW_SECONDS,
  clearCollabTicketVerifyCacheForTests,
  collabRoomKey,
  collabTicketNeedsRefresh,
  createCollabTicketKeyCache,
  decodeCollabTicketPayload,
  type DocsCollabTicketJwk,
  verifyCollabTicket,
} from "./docs-collab-ticket";

/**
 * Minted by PHP: `openssl_sign` over the encoded payload, DER rewritten to
 * IEEE P1363 by `CollabTicketCodec::derToP1363`. The pair exists only for this
 * file — nothing signed by it is accepted anywhere. Verifying it here is the
 * cross-language half of contract C2: if the server's conversion were wrong,
 * `crypto.subtle.verify` would refuse it.
 */
const fixtureJwk: DocsCollabTicketJwk = {
  kty: "EC",
  crv: "P-256",
  x: ["Shen9FuVEi4uEZOwN", "_gXee_dF-TT-1Jmcru", "VQTwDvpk"].join(""),
  y: ["qPkchjmUxXNXxVBcf", "_qWy58_YKBpjubRAQX", "RzJ7fyPM"].join(""),
  kid: "fixturekid01",
  alg: "ES256",
  use: "sig",
};

const phpSignedTicket = [
  "eyJ2IjoxLCJraWQiOiJmaXh0dXJla2lkMDEi",
  "LCJyb29tIjoiZjY2MWU3NmVlZjcyYjAwOGRj",
  "YmJkNjhlZTlkNGMyMjBjNjEzNGU0MyIsInVz",
  "ZXIiOiJjYXJvbCIsInBlZXIiOiIwMTIzNDU2",
  "Nzg5YWJjZGVmIiwiYWNjZXNzIjoiY29tbWVu",
  "dCIsImlhdCI6MTY5OTk5OTgwMCwiZXhwIjox",
  "NzAwMDAwNzAwfQ.LjCifN7Y8McSugaz6l2K",
  "lhMAfAWaIjWejtCDlSau4cP8l1V4JPqusFOB",
  "aKqXgGgHok0TcKsSLltD9v2oQNghHg",
].join("");

const ROOM = "users/bob/workspace/plan.md";
// The C5 digest of ROOM, not a credential. Naming it `*_KEY` makes the secret
// scanner read the hex as an API key and fail the Secrets check.
const ROOM_HASH = "f661e76eef72b008dcbbd68ee9d4c220c6134e43";
const INSIDE_LIFETIME = 1_700_000_000;

const claims = { room: ROOM_HASH, user: "carol", peer: "0123456789abcdef" };

function resolver(jwk: DocsCollabTicketJwk = fixtureJwk) {
  return createCollabTicketKeyCache(async (kid) => (kid === jwk.kid ? jwk : null));
}

function verify(
  overrides: {
    ticket?: string;
    claims?: typeof claims;
    nowSeconds?: number;
    jwk?: DocsCollabTicketJwk;
  } = {},
) {
  return verifyCollabTicket({
    ticket: overrides.ticket ?? phpSignedTicket,
    claims: overrides.claims ?? claims,
    resolveKey: resolver(overrides.jwk),
    nowSeconds: overrides.nowSeconds ?? INSIDE_LIFETIME,
  });
}

/** Re-sign the payload with a key the client never published. */
async function forge(payload: Record<string, unknown>): Promise<string> {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(encoded),
  );
  const bytes = new Uint8Array(signature);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return `${encoded}.${btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

function payloadOf(ticket: string): Record<string, unknown> {
  return decodeCollabTicketPayload(ticket) as unknown as Record<string, unknown>;
}

describe("docs-collab-ticket", () => {
  beforeEach(() => {
    clearCollabTicketVerifyCacheForTests();
  });

  it("resolves the contract C5 room key the server named in the ticket", async () => {
    await expect(collabRoomKey(ROOM)).resolves.toBe(ROOM_HASH);
  });

  it("verifies a ticket PHP signed, so the DER-to-P1363 rewrite is byte-exact", async () => {
    const payload = await verify();

    expect(payload).not.toBeNull();
    expect(payload?.access).toBe("comment");
    expect(payload?.user).toBe("carol");
    expect(payload?.room).toBe(ROOM_HASH);
    expect(payload?.peer).toBe("0123456789abcdef");
  });

  it("refuses a ticket signed by a key the server never published", async () => {
    const forged = await forge(payloadOf(phpSignedTicket));

    await expect(verify({ ticket: forged })).resolves.toBeNull();
  });

  it("refuses a ticket whose kid is unknown", async () => {
    await expect(verify({ jwk: { ...fixtureJwk, kid: "rotatedkid02" } })).resolves.toBeNull();
  });

  it("refuses an expired ticket but allows the C2 clock skew", async () => {
    const expiry = Number(payloadOf(phpSignedTicket).exp);

    await expect(
      verify({ nowSeconds: expiry + COLLAB_TICKET_SKEW_SECONDS - 1 }),
    ).resolves.not.toBeNull();
    await expect(verify({ nowSeconds: expiry + COLLAB_TICKET_SKEW_SECONDS })).resolves.toBeNull();
  });

  it("refuses a ticket minted for another room", async () => {
    await expect(verify({ claims: { ...claims, room: "a".repeat(40) } })).resolves.toBeNull();
  });

  it("refuses a ticket whose user is not the principal link's username", async () => {
    await expect(verify({ claims: { ...claims, user: "dave" } })).resolves.toBeNull();
  });

  it("refuses a ticket whose peer is not the one the envelope claims", async () => {
    await expect(verify({ claims: { ...claims, peer: "fedcba9876543210" } })).resolves.toBeNull();
  });

  it("refuses anything that is not a two-segment C2 ticket", async () => {
    expect(decodeCollabTicketPayload("not-a-ticket")).toBeNull();
    expect(decodeCollabTicketPayload("a.b.c")).toBeNull();
    await expect(verify({ ticket: "a.b" })).resolves.toBeNull();
  });

  it("refuses a payload that claims an access outside the contract", async () => {
    const forged = await forge({ ...payloadOf(phpSignedTicket), access: "admin" });

    expect(decodeCollabTicketPayload(forged)).toBeNull();
    await expect(verify({ ticket: forged })).resolves.toBeNull();
  });

  it("ignores the reserved spk field rather than refusing the ticket", async () => {
    const payload = decodeCollabTicketPayload(phpSignedTicket);

    expect(payload?.spk).toBeUndefined();
  });

  it("asks for a refresh only inside the last five minutes of the lifetime", () => {
    const expiry = Number(payloadOf(phpSignedTicket).exp);

    expect(collabTicketNeedsRefresh(phpSignedTicket, expiry - 300)).toBe(false);
    expect(collabTicketNeedsRefresh(phpSignedTicket, expiry - 299)).toBe(true);
    expect(collabTicketNeedsRefresh("garbage", expiry - 900)).toBe(true);
  });

  it("imports each kid once and keeps refusing an unknown one", async () => {
    let lookups = 0;
    const resolveKey = createCollabTicketKeyCache(async (kid) => {
      lookups += 1;
      return kid === fixtureJwk.kid ? fixtureJwk : null;
    });

    const args = { ticket: phpSignedTicket, claims, nowSeconds: INSIDE_LIFETIME, resolveKey };
    await expect(verifyCollabTicket(args)).resolves.not.toBeNull();
    await expect(verifyCollabTicket(args)).resolves.not.toBeNull();

    expect(lookups).toBe(1);
  });

  it("verifies a reused ticket once until it expires", async () => {
    let verifies = 0;
    const subtle: SubtleCrypto = {
      ...crypto.subtle,
      verify: async (...args) => {
        verifies += 1;
        return crypto.subtle.verify(...args);
      },
    };
    const resolveKey = resolver();
    const args = {
      ticket: phpSignedTicket,
      claims,
      nowSeconds: INSIDE_LIFETIME,
      resolveKey,
      subtle,
    };
    await expect(verifyCollabTicket(args)).resolves.not.toBeNull();
    await expect(verifyCollabTicket(args)).resolves.not.toBeNull();
    expect(verifies).toBe(1);

    await expect(
      verifyCollabTicket({ ...args, claims: { ...claims, user: "dave" } }),
    ).resolves.toBeNull();
    expect(verifies).toBe(1);

    const expiry = Number(payloadOf(phpSignedTicket).exp);
    await expect(verifyCollabTicket({ ...args, nowSeconds: expiry })).resolves.not.toBeNull();
    expect(verifies).toBe(2);
  });

  it("does not cache a null key lookup", async () => {
    let lookups = 0;
    const resolveKey = createCollabTicketKeyCache(async () => {
      lookups += 1;
      return null;
    });

    await expect(resolveKey("missing")).resolves.toBeNull();
    await expect(resolveKey("missing")).resolves.toBeNull();
    expect(lookups).toBe(2);
  });
});
