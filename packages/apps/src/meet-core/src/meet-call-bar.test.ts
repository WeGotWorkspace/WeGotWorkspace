import { describe, expect, it } from "vitest";
import {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
  meetCallPreviewPeers,
} from "@/meet-core/src/meet-call-bar-roster";
import { meetLabels } from "@/meet-core/src/meet-labels";

const self = { id: "self", name: "Demo User", stream: null };
const peers = [
  { id: "ada.lovelace", name: "Ada Lovelace" },
  { id: "grace.hopper", name: "Grace Hopper" },
];

describe("meetCallBarRoster", () => {
  it("excludes self when this user has not joined", () => {
    expect(meetCallBarRoster({ joined: false, self, peers })).toEqual(peers);
  });

  it("includes self when this user has joined", () => {
    expect(meetCallBarRoster({ joined: true, self, peers })).toEqual([self, ...peers]);
  });
});

describe("meetCallBarShownCount", () => {
  it("uses peerCount only when not joined and never coerces 0 to 1", () => {
    expect(meetCallBarShownCount({ joined: false, participantCount: 1, peerCount: 2 })).toBe(2);
    expect(meetCallBarShownCount({ joined: false, participantCount: 1, peerCount: 0 })).toBe(0);
  });

  it("uses participantCount when joined, including a live 0", () => {
    expect(meetCallBarShownCount({ joined: true, participantCount: 4, peerCount: 3 })).toBe(4);
    expect(meetCallBarShownCount({ joined: true, participantCount: 0, peerCount: 0 })).toBe(0);
  });
});

describe("meetCallBarMeta", () => {
  it("joins count and timer without a video-on hint", () => {
    expect(meetCallBarMeta(4, "1:57")).toBe(`${meetLabels.inCallCount(4)} · 1:57`);
  });

  it("omits elapsed when unknown and omits a zero count", () => {
    expect(meetCallBarMeta(3)).toBe(meetLabels.inCallCount(3));
    expect(meetCallBarMeta(3, "")).toBe(meetLabels.inCallCount(3));
    expect(meetCallBarMeta(0)).toBe("");
    expect(meetCallBarMeta(0, "1:57")).toBe("1:57");
  });
});

describe("meetCallPreviewPeers", () => {
  it("resolves directory display names and falls back to the username", () => {
    expect(
      meetCallPreviewPeers(
        ["ada.lovelace", "unknown.user"],
        [{ id: "ada.lovelace", displayName: "Ada Lovelace", principalType: "user" }],
      ),
    ).toEqual([
      { id: "ada.lovelace", name: "Ada Lovelace" },
      { id: "unknown.user", name: "unknown.user" },
    ]);
  });
});
