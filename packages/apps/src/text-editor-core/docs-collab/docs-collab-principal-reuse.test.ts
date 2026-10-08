import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { rtcLog } from "@/lib/rtc/log";
import { PrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import type { CollabReuseEnvelope } from "@/lib/rtc/session/collab-reuse-envelope";
import {
  collabRoomKey,
  createCollabTicketKeyCache,
  type DocsCollabTicketJwk,
} from "@/text-editor-core/docs-collab/docs-collab-ticket";
import type { DocsCollabAccess } from "@/text-editor-core/docs-collab/docs-collab-access";
import {
  COLLAB_REUSE_ACK_TIMEOUT_MS,
  COLLAB_REUSE_PRINCIPAL_CONNECT_DEFER_MS,
  COLLAB_REUSE_ROSTER_WAIT_MS,
  DocsCollabPrincipalReuse,
} from "@/text-editor-core/docs-collab/docs-collab-principal-reuse";
import {
  encodeUpdateBroadcast,
  handleSyncMessage,
} from "@/text-editor-core/docs-collab/docs-collab-mesh-sync";
import type { DocsCollabMeshMessage } from "@/text-editor-core/docs-collab/docs-collab-types";

vi.mock("@/lib/rtc/log", () => ({
  rtcLog: vi.fn(),
}));

const ROOM = "/groups/administrators/team-notes.md";
const TICKET_KID = "envelopekid01";

async function ticketKit() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk: DocsCollabTicketJwk = {
    kty: "EC",
    crv: "P-256",
    x: exported.x ?? "",
    y: exported.y ?? "",
    kid: TICKET_KID,
    alg: "ES256",
    use: "sig",
  };
  const resolveTicketKey = createCollabTicketKeyCache(async (kid) =>
    kid === jwk.kid ? jwk : null,
  );
  await resolveTicketKey(jwk.kid);
  const roomDigest = await collabRoomKey(ROOM);
  const now = Math.floor(Date.now() / 1000);

  async function sign(input: {
    user: string;
    peer: string;
    access: DocsCollabAccess;
  }): Promise<string> {
    const encoded = btoa(
      JSON.stringify({
        v: 1,
        kid: TICKET_KID,
        room: roomDigest,
        user: input.user,
        peer: input.peer,
        access: input.access,
        iat: now - 10,
        exp: now + 600,
      }),
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
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

  return { resolveTicketKey, sign };
}

function createHarness(options?: {
  ackTimeoutMs?: number;
  onReuseFallback?: (collabPeerId?: string) => void;
  onReuseAttached?: (collabPeerId: string) => void;
  resolveTicketKey?: (kid: string) => Promise<CryptoKey | null>;
  getOwnTicket?: () => string | undefined;
  requestRosterRefresh?: () => void;
}) {
  const registry = new PrincipalLinkRegistry();
  const sent: unknown[] = [];
  const opened: string[] = [];
  const messages: DocsCollabMeshMessage[] = [];
  let myId: string | null = "aaaaaaaaaaaaaaaa";
  const timers: Array<{ delay: number; fn: () => void }> = [];

  const reuse = new DocsCollabPrincipalReuse({
    room: "/groups/administrators/team-notes.md",
    registry,
    getMyCollabPeerId: () => myId,
    getMyName: () => "Admin",
    onDcOpen: (id) => opened.push(id),
    onLinkChange: () => undefined,
    onReuseFallback: options?.onReuseFallback,
    onReuseAttached: options?.onReuseAttached,
    onMessage: (msg) => messages.push(msg),
    resolveTicketKey: options?.resolveTicketKey,
    getOwnTicket: options?.getOwnTicket,
    requestRosterRefresh: options?.requestRosterRefresh,
    ackTimeoutMs: options?.ackTimeoutMs ?? COLLAB_REUSE_ACK_TIMEOUT_MS,
    setTimeoutFn: ((fn: () => void, delay?: number) => {
      timers.push({ delay: delay ?? 0, fn });
      return timers.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeoutFn: ((handle: ReturnType<typeof setTimeout>) => {
      const index = (handle as unknown as number) - 1;
      if (index >= 0 && index < timers.length) timers[index]!.fn = () => undefined;
    }) as typeof clearTimeout,
  });

  return {
    registry,
    sent,
    opened,
    messages,
    timers,
    reuse,
    setMyId: (id: string | null) => {
      myId = id;
    },
    registerAdminToWouter: () => {
      registry.registerLink({
        username: "wouter",
        principalPeerId: "prin-wouter",
        send: (payload) => sent.push(payload),
      });
    },
  };
}

describe("DocsCollabPrincipalReuse", () => {
  it("skips ICE and sends open when a principal DC exists for the collab peer's user", () => {
    const { reuse, registerAdminToWouter, sent } = createHarness();
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    expect(reuse.shouldSkipIce(peer)).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({
        kind: "collab-reuse",
        op: "open",
        room: "/groups/administrators/team-notes.md",
        collabPeerId: "aaaaaaaaaaaaaaaa",
      }),
    ]);
  });

  it("does not skip ICE when no principal DC exists (guest / offline / 3a miss)", () => {
    const { reuse } = createHarness();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    expect(reuse.shouldSkipIce(peer)).toBe(false);
  });

  it("does not skip ICE when the collab roster has no user field", () => {
    const { reuse, registerAdminToWouter } = createHarness();
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    expect(reuse.shouldSkipIce(peer)).toBe(false);
  });

  it("logs dc-open once when open and ack both attach the same peer", () => {
    vi.mocked(rtcLog).mockClear();
    const { reuse, registry, registerAdminToWouter, opened } = createHarness();
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    const dcOpens = vi.mocked(rtcLog).mock.calls.filter((call) => call[1] === "dc-open");
    expect(dcOpens).toHaveLength(1);
    expect(opened).toEqual(["bbbbbbbbbbbbbbbb"]);
  });

  it("emits dc-open on ack and routes data over the principal link", () => {
    const { reuse, registry, registerAdminToWouter, opened, messages, sent } = createHarness();
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    expect(opened).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(reuse.reusedLinkCount()).toBe(1);
    expect(reuse.sendTo("bbbbbbbbbbbbbbbb", { type: "sync", u: [9] })).toBe(true);
    expect(sent.at(-1)).toEqual(
      expect.objectContaining({
        op: "data",
        collabPeerId: "aaaaaaaaaaaaaaaa",
        payload: { type: "sync", u: [9] },
      }),
    );

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "data",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      payload: { type: "awareness", u: [1] },
    });
    expect(messages).toEqual([
      {
        type: "awareness",
        u: [1],
        from: "bbbbbbbbbbbbbbbb",
        trust: { user: "wouter", access: "read" },
      },
    ]);
  });

  /**
   * The principal `workspace` room holds every signed-in account, so an `open`
   * arriving on it proves nothing about document access. Acking one would hand
   * the sender a `dc-open`, and the mesh answers that with the whole Y.Doc.
   */
  it("ignores an open from a user the collab roster does not list and sends no ack", () => {
    const { reuse, registry, registerAdminToWouter, opened, sent } = createHarness();
    registerAdminToWouter();

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    expect(opened).toEqual([]);
    expect(sent).not.toContainEqual(expect.objectContaining({ op: "ack" }));
    expect(reuse.reusedLinkCount()).toBe(0);
    expect(reuse.shouldSkipIce({ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" })).toBe(
      false,
    );
  });

  it("acks an open once the collab roster lists the sender", () => {
    const { reuse, registry, registerAdminToWouter, opened, sent } = createHarness();
    registerAdminToWouter();
    reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" }],
      "aaaaaaaaaaaaaaaa",
    );

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    expect(opened).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(sent).toContainEqual(
      expect.objectContaining({ op: "ack", collabPeerId: "aaaaaaaaaaaaaaaa" }),
    );
  });

  it("ignores data from a rostered user under a collab peer id somebody else owns", () => {
    const { reuse, registry, registerAdminToWouter, messages } = createHarness();
    registerAdminToWouter();
    reuse.considerRoster(
      [
        { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" },
        { id: "dddddddddddddddd", name: "Dave", user: "dave" },
      ],
      "aaaaaaaaaaaaaaaa",
    );
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "data",
      collabPeerId: "dddddddddddddddd",
      payload: { type: "awareness", u: [3] },
    });

    expect(messages.filter((msg) => msg.type === "awareness")).toEqual([]);
  });

  it("drops the reuse link when a revoked share takes the peer off the roster", () => {
    const { reuse, registry, registerAdminToWouter } = createHarness();
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    expect(reuse.reusedLinkCount()).toBe(1);

    reuse.considerRoster([], "aaaaaaaaaaaaaaaa");

    expect(reuse.reusedLinkCount()).toBe(0);
    expect(reuse.sendTo("bbbbbbbbbbbbbbbb", { type: "sync", u: [1] })).toBe(false);
  });

  it("carries the roster access along with a forwarded update", () => {
    const { reuse, registry, registerAdminToWouter, messages } = createHarness();
    registerAdminToWouter();
    reuse.considerRoster(
      [
        {
          id: "bbbbbbbbbbbbbbbb",
          name: "Wouter",
          user: "wouter",
          access: "comment",
        },
      ],
      "aaaaaaaaaaaaaaaa",
    );
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "data",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      payload: { type: "sync", u: [2] },
    });

    expect(messages.at(-1)).toEqual({
      type: "sync",
      u: [2],
      from: "bbbbbbbbbbbbbbbb",
      trust: { user: "wouter", access: "comment" },
    });
  });

  it("falls back to ICE after ack timeout", () => {
    const onReuseFallback = vi.fn();
    const { reuse, registerAdminToWouter, timers, sent } = createHarness({ onReuseFallback });
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    expect(reuse.shouldSkipIce(peer)).toBe(true);

    expect(timers).toHaveLength(1);
    expect(timers[0]!.delay).toBe(COLLAB_REUSE_ACK_TIMEOUT_MS);
    timers[0]!.fn();

    expect(reuse.shouldSkipIce(peer)).toBe(false);
    expect(onReuseFallback).toHaveBeenCalledWith(peer.id);
    expect(sent).toContainEqual(
      expect.objectContaining({
        kind: "collab-reuse",
        op: "close",
        collabPeerId: "aaaaaaaaaaaaaaaa",
      }),
    );
  });

  it("remaps a reused peer when the collab roster assigns a new id for the same user", () => {
    const { reuse, registry, registerAdminToWouter, messages } = createHarness();
    registerAdminToWouter();
    reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" }],
      "aaaaaaaaaaaaaaaa",
    );
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    reuse.considerRoster(
      [{ id: "cccccccccccccccc", name: "Wouter", user: "wouter" }],
      "aaaaaaaaaaaaaaaa",
    );

    expect(reuse.shouldSkipIce({ id: "cccccccccccccccc", name: "Wouter", user: "wouter" })).toBe(
      true,
    );
    expect(reuse.sendTo("cccccccccccccccc", { type: "sync", u: [1] })).toBe(true);
    expect(reuse.sendTo("bbbbbbbbbbbbbbbb", { type: "sync", u: [1] })).toBe(false);

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "data",
      collabPeerId: "cccccccccccccccc",
      payload: { type: "awareness", u: [2] },
    });
    expect(messages.at(-1)).toEqual({
      type: "awareness",
      u: [2],
      from: "cccccccccccccccc",
      trust: { user: "wouter", access: "read" },
    });
  });

  it("does not reuse a username that maps to two collab peers", () => {
    const { reuse, registerAdminToWouter, sent } = createHarness();
    registerAdminToWouter();
    const laptop = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    const tablet = { id: "cccccccccccccccc", name: "Wouter", user: "wouter" };

    reuse.considerRoster([laptop, tablet], "aaaaaaaaaaaaaaaa");

    for (const peer of [laptop, tablet]) {
      expect(vi.mocked(rtcLog)).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "collab" }),
        "reuse-miss",
        expect.objectContaining({
          remoteId: peer.id,
          reason: "multi-peer-user",
          username: "wouter",
        }),
      );
      expect(reuse.shouldSkipIce(peer)).toBe(false);
      expect(reuse.shouldIgnoreOffer(peer.id)).toBe(false);
    }
    expect(sent.filter((payload) => (payload as { op?: string }).op === "open")).toEqual([]);
  });

  it("drops reuse when a reused user gains a second collab peer", () => {
    const onReuseFallback = vi.fn();
    const { reuse, registry, registerAdminToWouter, sent } = createHarness({ onReuseFallback });
    registerAdminToWouter();
    const laptop = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    const tablet = { id: "cccccccccccccccc", name: "Wouter", user: "wouter" };
    reuse.considerRoster([laptop], "aaaaaaaaaaaaaaaa");
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: laptop.id,
      name: "Wouter",
    });
    sent.length = 0;
    onReuseFallback.mockClear();

    reuse.considerRoster([laptop, tablet], "aaaaaaaaaaaaaaaa");

    expect(sent).toContainEqual(
      expect.objectContaining({
        kind: "collab-reuse",
        op: "close",
        collabPeerId: "aaaaaaaaaaaaaaaa",
      }),
    );
    expect(onReuseFallback).toHaveBeenCalledWith(laptop.id);
    expect(reuse.sendTo(laptop.id, { type: "sync", u: [1] })).toBe(false);
    expect(reuse.shouldSkipIce(laptop)).toBe(false);
    expect(reuse.shouldSkipIce(tablet)).toBe(false);
    expect(reuse.shouldIgnoreOffer(laptop.id)).toBe(false);
    expect(reuse.shouldIgnoreOffer(tablet.id)).toBe(false);
  });

  it("falls back to fresh ICE silently when a reused principal link disappears", () => {
    const { reuse, registry, registerAdminToWouter } = createHarness();
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    expect(reuse.shouldSkipIce(peer)).toBe(true);
    expect(reuse.sendTo(peer.id, { type: "sync", u: [1] })).toBe(true);

    expect(() => {
      registry.unregisterLink("prin-wouter");
    }).not.toThrow();
    expect(reuse.shouldSkipIce(peer)).toBe(false);

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    expect(reuse.shouldSkipIce(peer)).toBe(false);
    expect(reuse.reusedLinkCount()).toBe(0);
    expect(reuse.sendTo(peer.id, { type: "sync", u: [2] })).toBe(false);
    expect(reuse.overlayStatuses([{ ...peer, link: "connecting" }])).toEqual([
      { ...peer, link: "connecting" },
    ]);
    expect(vi.mocked(rtcLog)).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "collab" }),
      "reuse-miss",
      expect.objectContaining({ reason: "principal-link-gone", username: "wouter" }),
    );
  });

  it("ignores reuse envelopes for other rooms", () => {
    const { reuse, registry, registerAdminToWouter, opened } = createHarness();
    registerAdminToWouter();
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/other.md",
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    } satisfies CollabReuseEnvelope);
    expect(opened).toEqual([]);
    expect(reuse.reusedLinkCount()).toBe(0);
  });

  it("defers fresh ICE while the principal mesh is still connecting", () => {
    const { reuse, registry, timers } = createHarness();
    registry.setConnectingUsernames(new Set(["wouter"]));
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");

    expect(reuse.shouldSkipIce(peer)).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.delay).toBe(COLLAB_REUSE_PRINCIPAL_CONNECT_DEFER_MS);
    expect(vi.mocked(rtcLog)).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "collab" }),
      "reuse-defer",
      expect.objectContaining({ reason: "principal-connecting", username: "wouter" }),
    );
  });

  it("retries reuse on principal link-open without waiting for poll-changed", () => {
    const { reuse, registry, sent } = createHarness();
    registry.setConnectingUsernames(new Set(["wouter"]));
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    expect(sent).toEqual([]);

    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: (payload) => sent.push(payload),
    });

    expect(sent).toContainEqual(
      expect.objectContaining({
        kind: "collab-reuse",
        op: "open",
        collabPeerId: "aaaaaaaaaaaaaaaa",
      }),
    );
    expect(reuse.shouldSkipIce(peer)).toBe(true);
  });

  it("falls back to fresh ICE after the principal-connect defer window expires", () => {
    const onReuseFallback = vi.fn();
    const { reuse, registry, timers } = createHarness({ onReuseFallback });
    registry.setConnectingUsernames(new Set(["wouter"]));
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    expect(reuse.shouldSkipIce(peer)).toBe(true);

    registry.setConnectingUsernames(new Set());
    timers[0]!.fn();

    expect(reuse.shouldSkipIce(peer)).toBe(false);
    expect(onReuseFallback).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rtcLog)).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "collab" }),
      "reuse-miss",
      expect.objectContaining({ reason: "no-principal-pc", username: "wouter" }),
    );
  });

  it("extends defer while principal mesh is still connecting after each tick", () => {
    const onReuseFallback = vi.fn();
    const { reuse, registry, timers } = createHarness({ onReuseFallback });
    registry.setConnectingUsernames(new Set(["wouter"]));
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    expect(timers).toHaveLength(1);
    expect(reuse.shouldSkipIce(peer)).toBe(true);

    timers[0]!.fn();
    expect(onReuseFallback).not.toHaveBeenCalled();
    expect(reuse.shouldSkipIce(peer)).toBe(true);
    expect(timers).toHaveLength(2);

    timers[1]!.fn();
    expect(onReuseFallback).not.toHaveBeenCalled();
    expect(reuse.shouldSkipIce(peer)).toBe(true);

    registry.setConnectingUsernames(new Set());
    timers[2]!.fn();
    expect(onReuseFallback).toHaveBeenCalledTimes(1);
    expect(reuse.shouldSkipIce(peer)).toBe(false);
  });

  it("aborts in-flight fresh ICE when reuse attaches", () => {
    const onReuseAttached = vi.fn();
    const { reuse, registry, registerAdminToWouter } = createHarness({ onReuseAttached });
    registerAdminToWouter();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };

    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    expect(onReuseAttached).not.toHaveBeenCalled();

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    expect(onReuseAttached).toHaveBeenCalledWith(peer.id);
  });

  it("ignores stale collab offers once principal reuse is active for that user", () => {
    const { reuse, registry, registerAdminToWouter } = createHarness();
    registerAdminToWouter();
    const stalePeer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    const freshPeer = { id: "cccccccccccccccc", name: "Wouter", user: "wouter" };

    reuse.considerRoster([stalePeer], "aaaaaaaaaaaaaaaa");
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: "/groups/administrators/team-notes.md",
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });
    expect(reuse.shouldIgnoreOffer("bbbbbbbbbbbbbbbb")).toBe(true);

    reuse.considerRoster([freshPeer], "aaaaaaaaaaaaaaaa");
    expect(reuse.shouldIgnoreOffer("bbbbbbbbbbbbbbbb")).toBe(true);
    expect(reuse.shouldIgnoreOffer("cccccccccccccccc")).toBe(true);
  });

  it("accepts collab offers when reuse is not active for the peer", () => {
    const { reuse } = createHarness();
    const peer = { id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" };
    reuse.considerRoster([peer], "aaaaaaaaaaaaaaaa");
    expect(reuse.shouldIgnoreOffer("bbbbbbbbbbbbbbbb")).toBe(false);
  });
});

describe("DocsCollabPrincipalReuse bidirectional Yjs over reused DC", () => {
  const ADMIN = "aaaaaaaaaaaaaaaa";
  const WOUTER = "bbbbbbbbbbbbbbbb";
  const ROOM = "/groups/administrators/team-notes.md";

  function pairSessions() {
    const registry = new PrincipalLinkRegistry();
    const adminMsgs: DocsCollabMeshMessage[] = [];
    const wouterMsgs: DocsCollabMeshMessage[] = [];
    const ports = {
      room: ROOM,
      registry,
      onDcOpen: () => undefined,
      onLinkChange: () => undefined,
      setTimeoutFn: ((_fn: () => void) => {
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => undefined) as typeof clearTimeout,
    };
    const admin = new DocsCollabPrincipalReuse({
      ...ports,
      getMyCollabPeerId: () => ADMIN,
      getMyName: () => "Admin",
      onMessage: (msg) => adminMsgs.push(msg),
    });
    const wouter = new DocsCollabPrincipalReuse({
      ...ports,
      getMyCollabPeerId: () => WOUTER,
      getMyName: () => "Wouter",
      onMessage: (msg) => wouterMsgs.push(msg),
    });
    registry.registerLink({
      username: "wouter",
      principalPeerId: "prin-wouter",
      send: (payload) => {
        registry.receive("admin", "prin-admin", payload as CollabReuseEnvelope);
      },
    });
    registry.registerLink({
      username: "admin",
      principalPeerId: "prin-admin",
      send: (payload) => {
        registry.receive("wouter", "prin-wouter", payload as CollabReuseEnvelope);
      },
    });
    // Both sides poll the same room, so both rosters list the other peer —
    // without that neither accepts a reuse envelope from the other.
    admin.considerRoster([{ id: WOUTER, name: "Wouter", user: "wouter" }], ADMIN);
    wouter.considerRoster([{ id: ADMIN, name: "Admin", user: "admin" }], WOUTER);
    return { admin, wouter, adminMsgs, wouterMsgs };
  }

  it("delivers A→B and B→A Yjs updates on the reused channel without echoing to the sender", () => {
    const { admin, wouter, adminMsgs, wouterMsgs } = pairSessions();
    expect(admin.shouldSkipIce({ id: WOUTER, name: "Wouter", user: "wouter" })).toBe(true);
    expect(wouter.shouldSkipIce({ id: ADMIN, name: "Admin", user: "admin" })).toBe(true);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    docA.getText("body").insert(0, "hello-from-admin");
    expect(
      admin.sendTo(WOUTER, { type: "sync", u: encodeUpdateBroadcast(Y.encodeStateAsUpdate(docA)) }),
    ).toBe(true);

    const inboundB = wouterMsgs.filter((msg) => msg.type === "sync");
    expect(inboundB).toHaveLength(1);
    expect(inboundB[0]?.from).toBe(ADMIN);
    expect(adminMsgs.filter((msg) => msg.type === "sync")).toEqual([]);
    handleSyncMessage(inboundB[0]!.u, docB);
    expect(docB.getText("body").toString()).toContain("hello-from-admin");

    docB.getText("body").insert(docB.getText("body").length, "+wouter");
    expect(
      wouter.sendTo(ADMIN, { type: "sync", u: encodeUpdateBroadcast(Y.encodeStateAsUpdate(docB)) }),
    ).toBe(true);
    const inboundA = adminMsgs.filter((msg) => msg.type === "sync");
    expect(inboundA).toHaveLength(1);
    expect(inboundA[0]?.from).toBe(WOUTER);
    expect(wouterMsgs.filter((msg) => msg.type === "sync")).toHaveLength(1);
    handleSyncMessage(inboundA[0]!.u, docA);
    expect(docA.getText("body").toString()).toContain("+wouter");
  });
});

describe("DocsCollabPrincipalReuse ticket", () => {
  it("puts the local ticket on open when one is available and omits it otherwise", () => {
    const without = createHarness();
    without.registerAdminToWouter();
    without.reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" }],
      "aaaaaaaaaaaaaaaa",
    );
    expect(without.sent[0]).not.toHaveProperty("ticket");

    const withTicket = createHarness({ getOwnTicket: () => "local.ticket" });
    withTicket.registerAdminToWouter();
    withTicket.reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" }],
      "aaaaaaaaaaaaaaaa",
    );
    expect(withTicket.sent[0]).toEqual(
      expect.objectContaining({ op: "open", ticket: "local.ticket" }),
    );
  });

  it("applies a write ticket as read when the roster says read", async () => {
    const kit = await ticketKit();
    const { reuse, registry, registerAdminToWouter, messages } = createHarness({
      resolveTicketKey: kit.resolveTicketKey,
    });
    registerAdminToWouter();
    reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter", access: "read" }],
      "aaaaaaaaaaaaaaaa",
    );
    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "ack",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    await registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "data",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      ticket: await kit.sign({ user: "wouter", peer: "bbbbbbbbbbbbbbbb", access: "write" }),
      payload: { type: "sync", u: [7] },
    });

    expect(messages.at(-1)).toEqual({
      type: "sync",
      u: [7],
      from: "bbbbbbbbbbbbbbbb",
      trust: { user: "wouter", access: "read" },
    });
  });

  it("rejects a ticket whose user or peer does not match the envelope", async () => {
    const kit = await ticketKit();
    const { reuse, registry, registerAdminToWouter, opened, sent } = createHarness({
      resolveTicketKey: kit.resolveTicketKey,
    });
    registerAdminToWouter();
    reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter", access: "write" }],
      "aaaaaaaaaaaaaaaa",
    );
    sent.length = 0;

    await registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
      ticket: await kit.sign({ user: "carol", peer: "bbbbbbbbbbbbbbbb", access: "write" }),
    });
    expect(opened).toEqual([]);
    expect(sent).not.toContainEqual(expect.objectContaining({ op: "ack" }));

    await registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
      ticket: await kit.sign({ user: "wouter", peer: "cccccccccccccccc", access: "write" }),
    });
    expect(opened).toEqual([]);
    expect(reuse.reusedLinkCount()).toBe(0);
  });

  it("still accepts an envelope with no ticket through the roster check", () => {
    const { reuse, registry, registerAdminToWouter, opened, sent } = createHarness();
    registerAdminToWouter();
    reuse.considerRoster(
      [{ id: "bbbbbbbbbbbbbbbb", name: "Wouter", user: "wouter" }],
      "aaaaaaaaaaaaaaaa",
    );
    sent.length = 0;

    registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
    });

    expect(opened).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(sent).toContainEqual(expect.objectContaining({ op: "ack" }));
    expect(sent[0]).not.toHaveProperty("ticket");
  });

  it("holds a ticket until the peer appears on the roster", async () => {
    const kit = await ticketKit();
    const requestRosterRefresh = vi.fn();
    const { reuse, registry, opened, messages } = createHarness({
      resolveTicketKey: kit.resolveTicketKey,
      requestRosterRefresh,
    });
    const peer = "bbbbbbbbbbbbbbbb";
    const pending = registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: peer,
      name: "Wouter",
      ticket: await kit.sign({ user: "wouter", peer, access: "write" }),
    });
    await vi.waitFor(() => expect(requestRosterRefresh).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
    });
    expect(opened).toEqual([]);

    reuse.considerRoster(
      [{ id: peer, name: "Wouter", user: "wouter", access: "read" }],
      "aaaaaaaaaaaaaaaa",
    );
    await pending;

    expect(opened).toEqual([peer]);
    await registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "data",
      collabPeerId: peer,
      ticket: await kit.sign({ user: "wouter", peer, access: "write" }),
      payload: { type: "sync", u: [7] },
    });
    expect(messages.at(-1)).toMatchObject({ trust: { user: "wouter", access: "read" } });
  });

  it("drops a ticket after the roster wait when the peer never appears", async () => {
    const kit = await ticketKit();
    const { reuse, registry, timers, opened } = createHarness({
      resolveTicketKey: kit.resolveTicketKey,
    });
    const pending = registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
      ticket: await kit.sign({ user: "wouter", peer: "bbbbbbbbbbbbbbbb", access: "write" }),
    });
    await vi.waitFor(
      () => expect(timers.some((timer) => timer.delay === COLLAB_REUSE_ROSTER_WAIT_MS)).toBe(true),
      { timeout: 5_000 },
    );
    timers.find((timer) => timer.delay === COLLAB_REUSE_ROSTER_WAIT_MS)?.fn();
    await pending;

    expect(opened).toEqual([]);
    expect(reuse.reusedLinkCount()).toBe(0);
    expect(vi.mocked(rtcLog)).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "collab" }),
      "reuse-miss",
      expect.objectContaining({
        reason: "ticket-peer-not-rostered",
        remoteId: "bbbbbbbbbbbbbbbb",
      }),
    );
  });

  it("drops the ninth unknown ticket immediately", async () => {
    const kit = await ticketKit();
    const requestRosterRefresh = vi.fn();
    const { reuse, registry, opened } = createHarness({
      resolveTicketKey: kit.resolveTicketKey,
      requestRosterRefresh,
    });
    const ids = Array.from({ length: 9 }, (_, index) => index.toString(16).padStart(16, "b"));
    for (let index = 0; index < 8; index += 1) {
      const peer = ids[index] ?? "";
      void registry.receive("wouter", "prin-wouter", {
        v: 1,
        kind: "collab-reuse",
        room: ROOM,
        op: "open",
        collabPeerId: peer,
        name: "Wouter",
        ticket: await kit.sign({ user: "wouter", peer, access: "write" }),
      });
      await vi.waitFor(() => expect(requestRosterRefresh).toHaveBeenCalledTimes(index + 1), {
        timeout: 5_000,
      });
    }
    const ninth = ids[8] ?? "";
    await registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: ninth,
      name: "Wouter",
      ticket: await kit.sign({ user: "wouter", peer: ninth, access: "write" }),
    });

    expect(opened).toEqual([]);
    expect(requestRosterRefresh).toHaveBeenCalledTimes(8);
    expect(vi.mocked(rtcLog)).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "collab" }),
      "reuse-miss",
      expect.objectContaining({ reason: "ticket-peer-not-rostered", remoteId: ninth }),
    );
    reuse.dispose();
  });

  it("resolves a roster wait as not attached when the session is disposed", async () => {
    const kit = await ticketKit();
    const { reuse, registry, opened } = createHarness({
      resolveTicketKey: kit.resolveTicketKey,
    });
    const pending = registry.receive("wouter", "prin-wouter", {
      v: 1,
      kind: "collab-reuse",
      room: ROOM,
      op: "open",
      collabPeerId: "bbbbbbbbbbbbbbbb",
      name: "Wouter",
      ticket: await kit.sign({ user: "wouter", peer: "bbbbbbbbbbbbbbbb", access: "write" }),
    });
    reuse.dispose();
    await pending;

    expect(opened).toEqual([]);
    expect(reuse.reusedLinkCount()).toBe(0);
  });
});
