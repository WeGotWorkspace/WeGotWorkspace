import { describe, expect, it } from "vitest";
import {
  buildLinkLabel,
  LINK_RETRY_AFTER_NOT_IN_ROOM_MS,
  LINK_RETRY_AFTER_REJECT_MS,
  outboundKey,
  parseLinkFrame,
  parseLinkLabel,
  planOutbound,
  retryDelayForReject,
  type OutboundRecord,
} from "@/lib/rtc/link/link-channel-protocol";
import type { LinkPeer, RoomEndpointState } from "@/lib/rtc/link/link-channel-types";

const ROOM = "a".repeat(40);
const ROOM_B = "b".repeat(40);

function room(overrides: Partial<RoomEndpointState> = {}): RoomEndpointState {
  return {
    kind: "collab",
    roomKey: ROOM,
    myPeerId: "me",
    jwk: null,
    roster: [
      { id: "me", user: "alice", access: "write" },
      { id: "peer-b", user: "bob", access: "write" },
    ],
    ...overrides,
  };
}

function record(
  overrides: Partial<OutboundRecord> & Pick<OutboundRecord, "roomKey" | "linkPeer">,
): OutboundRecord {
  return {
    state: "ready",
    acceptedPeer: null,
    since: 0,
    retryAt: 0,
    ...overrides,
  };
}

describe("link channel labels", () => {
  it("round-trips buildLinkLabel through parseLinkLabel", () => {
    const label = buildLinkLabel("collab", ROOM);
    expect(label).toBe(`wgw1/collab/${ROOM}`);
    expect(parseLinkLabel(label)).toEqual({ kind: "collab", roomKey: ROOM });
  });

  it("rejects labels that are not wgw1/collab/<40 lowercase hex>", () => {
    expect(parseLinkLabel(`wgw2/collab/${ROOM}`)).toBeNull();
    expect(parseLinkLabel(`wgw1/meet/${ROOM}`)).toBeNull();
    expect(parseLinkLabel(`wgw1/collab/${"a".repeat(39)}`)).toBeNull();
    expect(parseLinkLabel(`wgw1/collab/${"A".repeat(40)}`)).toBeNull();
  });
});

describe("parseLinkFrame", () => {
  it("parses each valid frame", () => {
    expect(parseLinkFrame(JSON.stringify({ t: "hello", v: 1, peer: "p1" }))).toEqual({
      t: "hello",
      v: 1,
      peer: "p1",
    });
    expect(parseLinkFrame(JSON.stringify({ t: "hello", v: 1, peer: "p1", ticket: "tok" }))).toEqual(
      { t: "hello", v: 1, peer: "p1", ticket: "tok" },
    );
    expect(parseLinkFrame(JSON.stringify({ t: "accept", peer: "p1" }))).toEqual({
      t: "accept",
      peer: "p1",
    });
    expect(parseLinkFrame(JSON.stringify({ t: "reject", reason: "not-in-room" }))).toEqual({
      t: "reject",
      reason: "not-in-room",
    });
    expect(parseLinkFrame(JSON.stringify({ t: "d", m: { hi: 1 } }))).toEqual({
      t: "d",
      m: { hi: 1 },
    });
  });

  it("rejects invalid frames", () => {
    expect(parseLinkFrame("{")).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "hello", v: 2, peer: "p1" }))).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "hello", v: 1, peer: "" }))).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "hello", v: 1, peer: "p1", ticket: 1 }))).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "accept" }))).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "reject", reason: "nope" }))).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "d" }))).toBeNull();
    expect(parseLinkFrame(JSON.stringify({ t: "x" }))).toBeNull();
  });
});

describe("planOutbound", () => {
  const linkBob: LinkPeer = { linkPeer: "link-bob", user: "bob" };
  const linkCarol: LinkPeer = { linkPeer: "link-carol", user: "carol" };

  it("opens one channel per (room, link) for a rostered user without duplicating", () => {
    const actions = planOutbound({
      rooms: [
        room({
          roster: [
            { id: "me", user: "alice", access: "write" },
            { id: "peer-b", user: "bob", access: "write" },
            { id: "peer-b2", user: "bob", access: "comment" },
          ],
        }),
      ],
      links: [linkBob],
      outbound: new Map(),
      now: 0,
    });
    expect(actions).toEqual([{ op: "open", roomKey: ROOM, linkPeer: "link-bob" }]);
  });

  it("does not open to myself", () => {
    const actions = planOutbound({
      rooms: [room({ roster: [{ id: "me", user: "alice", access: "write" }] })],
      links: [{ linkPeer: "link-me", user: "alice" }],
      outbound: new Map(),
      now: 0,
    });
    expect(actions).toEqual([]);
  });

  it("does not reopen a closed record before retryAt and reopens at retryAt", () => {
    const key = outboundKey(ROOM, "link-bob");
    const closed = record({
      roomKey: ROOM,
      linkPeer: "link-bob",
      state: "closed",
      retryAt: 100,
    });
    expect(
      planOutbound({
        rooms: [room()],
        links: [linkBob],
        outbound: new Map([[key, closed]]),
        now: 99,
      }),
    ).toEqual([]);
    expect(
      planOutbound({
        rooms: [room()],
        links: [linkBob],
        outbound: new Map([[key, closed]]),
        now: 100,
      }),
    ).toEqual([{ op: "open", roomKey: ROOM, linkPeer: "link-bob" }]);
  });

  it("closes a ready record whose user left the roster and ignores unwanted closed", () => {
    const key = outboundKey(ROOM, "link-bob");
    const ready = record({ roomKey: ROOM, linkPeer: "link-bob", state: "ready" });
    const closed = record({
      roomKey: ROOM,
      linkPeer: "link-carol",
      state: "closed",
      retryAt: 0,
    });
    const actions = planOutbound({
      rooms: [room({ roster: [{ id: "me", user: "alice", access: "write" }] })],
      links: [linkBob, linkCarol],
      outbound: new Map([
        [key, ready],
        [outboundKey(ROOM, "link-carol"), closed],
      ]),
      now: 0,
    });
    expect(actions).toEqual([{ op: "close", roomKey: ROOM, linkPeer: "link-bob" }]);
  });

  it("sorts output by key and is stable for shuffled input", () => {
    const rooms = [
      room({ roomKey: ROOM_B, myPeerId: "me-b" }),
      room({
        roomKey: ROOM,
        roster: [
          { id: "me", user: "alice", access: "write" },
          { id: "peer-c", user: "carol", access: "write" },
          { id: "peer-b", user: "bob", access: "write" },
        ],
      }),
    ];
    const links = [linkCarol, linkBob];
    const first = planOutbound({ rooms, links, outbound: new Map(), now: 0 });
    const second = planOutbound({
      rooms: [...rooms].reverse(),
      links: [...links].reverse(),
      outbound: new Map(),
      now: 0,
    });
    expect(first).toEqual(second);
    expect(first.map((action) => outboundKey(action.roomKey, action.linkPeer))).toEqual(
      [...first.map((action) => outboundKey(action.roomKey, action.linkPeer))].sort(),
    );
  });
});

describe("retryDelayForReject", () => {
  it("uses the not-in-room delay and the default reject delay", () => {
    expect(retryDelayForReject("not-in-room")).toBe(LINK_RETRY_AFTER_NOT_IN_ROOM_MS);
    expect(retryDelayForReject("ticket-rejected")).toBe(LINK_RETRY_AFTER_REJECT_MS);
    expect(retryDelayForReject("user-mismatch")).toBe(LINK_RETRY_AFTER_REJECT_MS);
  });
});
