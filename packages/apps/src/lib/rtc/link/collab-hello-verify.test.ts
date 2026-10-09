import { beforeEach, describe, expect, it } from "vitest";
import { verifyCollabHello } from "@/lib/rtc/link/collab-hello-verify";
import type { RoomEndpointState } from "@/lib/rtc/link/link-channel-types";
import {
  clearCollabTicketVerifyCacheForTests,
  createCollabTicketKeyCache,
  type DocsCollabTicketJwk,
} from "@/text-editor-core/docs-collab/docs-collab-ticket";

const ROOM = "f661e76eef72b008dcbbd68ee9d4c220c6134e43";
const NOW = 1_700_000_000;

async function mintTicket(input: {
  room: string;
  user: string;
  peer: string;
  access: "read" | "comment" | "write";
  kid: string;
  privateKey: CryptoKey;
}): Promise<{ ticket: string; jwk: DocsCollabTicketJwk }> {
  const jwkRaw = await crypto.subtle.exportKey("jwk", input.privateKey);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwkRaw.x, y: jwkRaw.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  const publicJwk = (await crypto.subtle.exportKey("jwk", publicKey)) as JsonWebKey;
  const jwk: DocsCollabTicketJwk = {
    kty: "EC",
    crv: "P-256",
    x: publicJwk.x!,
    y: publicJwk.y!,
    kid: input.kid,
    alg: "ES256",
    use: "sig",
  };
  const payload = {
    v: 1,
    kid: input.kid,
    room: input.room,
    user: input.user,
    peer: input.peer,
    access: input.access,
    iat: NOW - 60,
    exp: NOW + 600,
  };
  const encoded = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    input.privateKey,
    new TextEncoder().encode(encoded),
  );
  const bytes = new Uint8Array(signature);
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  const ticket = `${encoded}.${btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  return { ticket, jwk };
}

function room(overrides: Partial<RoomEndpointState> = {}): RoomEndpointState {
  return {
    kind: "collab",
    roomKey: ROOM,
    myPeerId: "local",
    jwk: null,
    roster: [{ id: "peer-a", user: "alice", access: "write" }],
    ...overrides,
  };
}

describe("verifyCollabHello", () => {
  beforeEach(() => {
    clearCollabTicketVerifyCacheForTests();
  });

  it("returns need-roster for an unrostered peer", async () => {
    const verdict = await verifyCollabHello({
      hello: { t: "hello", v: 1, peer: "missing" },
      linkUser: "alice",
      room: room(),
      resolveKey: async () => null,
    });
    expect(verdict).toEqual({ ok: "need-roster" });
  });

  it("rejects when the roster user differs from the link user", async () => {
    const verdict = await verifyCollabHello({
      hello: { t: "hello", v: 1, peer: "peer-a" },
      linkUser: "bob",
      room: room(),
      resolveKey: async () => null,
    });
    expect(verdict).toEqual({ ok: false, reason: "user-mismatch" });
  });

  it("accepts without a key using roster access and ticketAccess write", async () => {
    const verdict = await verifyCollabHello({
      hello: { t: "hello", v: 1, peer: "peer-a" },
      linkUser: "alice",
      room: room({ roster: [{ id: "peer-a", user: "alice", access: "comment" }] }),
      resolveKey: async () => null,
    });
    expect(verdict).toEqual({
      ok: true,
      peer: "peer-a",
      access: "comment",
      ticketAccess: "write",
    });
  });

  it("rejects when a key is published and the hello has no ticket", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const { jwk } = await mintTicket({
      room: ROOM,
      user: "alice",
      peer: "peer-a",
      access: "write",
      kid: "kid1",
      privateKey: pair.privateKey,
    });
    const verdict = await verifyCollabHello({
      hello: { t: "hello", v: 1, peer: "peer-a" },
      linkUser: "alice",
      room: room({ jwk }),
      resolveKey: createCollabTicketKeyCache(async (kid) => (kid === jwk.kid ? jwk : null)),
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "ticket-rejected" });
  });

  it("rejects a ticket minted for another peer", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const { ticket, jwk } = await mintTicket({
      room: ROOM,
      user: "alice",
      peer: "other-peer",
      access: "write",
      kid: "kid1",
      privateKey: pair.privateKey,
    });
    const verdict = await verifyCollabHello({
      hello: { t: "hello", v: 1, peer: "peer-a", ticket },
      linkUser: "alice",
      room: room({ jwk }),
      resolveKey: createCollabTicketKeyCache(async (kid) => (kid === jwk.kid ? jwk : null)),
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({ ok: false, reason: "ticket-rejected" });
  });

  it("takes the tighter of ticket write and roster comment", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const { ticket, jwk } = await mintTicket({
      room: ROOM,
      user: "alice",
      peer: "peer-a",
      access: "write",
      kid: "kid1",
      privateKey: pair.privateKey,
    });
    const verdict = await verifyCollabHello({
      hello: { t: "hello", v: 1, peer: "peer-a", ticket },
      linkUser: "alice",
      room: room({
        jwk,
        roster: [{ id: "peer-a", user: "alice", access: "comment" }],
      }),
      resolveKey: createCollabTicketKeyCache(async (kid) => (kid === jwk.kid ? jwk : null)),
      nowSeconds: NOW,
    });
    expect(verdict).toEqual({
      ok: true,
      peer: "peer-a",
      access: "comment",
      ticketAccess: "write",
    });
  });
});
