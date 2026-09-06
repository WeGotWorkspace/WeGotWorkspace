import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
  meetCallPreviewPeers,
} from "@/meet-core/src/meet-call-bar-roster";
import { meetLabels } from "@/meet-core/src/meet-labels";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "meet-call-bar.tsx"), "utf8");
const workspaceTsx = readFileSync(join(here, "meet-workspace.tsx"), "utf8");

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

describe("MeetCallBar", () => {
  it("builds the avatar roster from the joined-aware helper", () => {
    expect(tsx).toMatch(/meetCallBarRoster\(/);
    expect(tsx).not.toMatch(/const roster: MeetCallBarPeer\[\] = \[\{ id: selfId/);
  });

  it("does not coerce an empty call to 1 participant", () => {
    expect(tsx).not.toMatch(/\?\? 1/);
    expect(workspaceTsx).not.toMatch(/participantCount=\{callRoom\?\.participantCount \?\? 1\}/);
    expect(workspaceTsx).toMatch(/meetCallBarShownCount\(/);
  });

  it("uses a generic meeting title and omits presence pips on avatars", () => {
    expect(tsx).toMatch(/meetLabels\.meetingStarted/);
    expect(tsx).toMatch(/<UserAvatar/);
    expect(tsx).not.toMatch(/presence=\{/);
    expect(tsx).not.toMatch(/meetInChannel/);
  });

  it("keeps the camera tile strip and omits share screen", () => {
    expect(tsx).toMatch(/meet-call-bar__tiles/);
    expect(tsx).not.toMatch(/onToggleScreenShare/);
    expect(tsx).not.toMatch(/meetLabels\.shareScreen/);
    expect(tsx).not.toMatch(/MonitorUp/);
  });

  it("keeps settings in the media cluster before the leave divider", () => {
    expect(tsx).toMatch(/MeetDevicePopover/);
    expect(tsx).toMatch(/meet-call-bar__divider/);
    expect(tsx.indexOf("meetLabels.stopVideo")).toBeLessThan(tsx.indexOf("<MeetDevicePopover"));
    expect(tsx.indexOf("<MeetDevicePopover")).toBeLessThan(
      tsx.indexOf('className="meet-call-bar__divider"'),
    );
    expect(tsx.indexOf('className="meet-call-bar__divider"')).toBeLessThan(
      tsx.indexOf("icon={<PhoneOff />}"),
    );
  });

  it("hides the IconButton cluster until the local user has joined", () => {
    expect(tsx).toMatch(/joined = false/);
    expect(tsx).toMatch(/\{joined \? \(/);
    expect(tsx).toMatch(/\{joined && videoOn \? \(/);
  });

  it("puts Join on the bar while a live meeting has not been joined", () => {
    expect(tsx).toMatch(/meet-call-bar__invite-button/);
    expect(tsx).toMatch(/meetLabels\.join/);
    expect(tsx).not.toMatch(/label=\{meetLabels\.start\}/);
    expect(tsx).not.toMatch(/meetLabels\.joined/);
  });

  it("uses an audio mark when audioOnly and keeps the Join label", () => {
    expect(tsx).toMatch(/audioOnly = false/);
    expect(tsx).toMatch(/meet-call-bar__mark[\s\S]*audioOnly \? \([\s\S]*<Mic[\s\S]*<Video/);
    expect(tsx).toMatch(/icon=\{audioOnly \? <Mic \/> : <Video \/>\}/);
    expect(tsx).toMatch(/label=\{meetLabels\.join\}/);
    expect(tsx).not.toMatch(/joinAudioOnly/);
    expect(tsx).not.toMatch(/Join \(Audio Only\)/);
  });
});
