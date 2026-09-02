import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { meetCallBarMeta } from "@/meet-core/src/meet-call-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "meet-call-bar.tsx"), "utf8");

describe("meetCallBarMeta", () => {
  it("joins count and timer without a video-on hint", () => {
    expect(meetCallBarMeta(4, "1:57")).toBe(`${meetLabels.inCallCount(4)} · 1:57`);
  });
});

describe("MeetCallBar", () => {
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

  it("puts Start or Join on the bar while this user is not in the call", () => {
    expect(tsx).toMatch(/meet-call-bar__invite-button/);
    expect(tsx).toMatch(/meetLabels\.join/);
    expect(tsx).toMatch(/meetLabels\.start/);
    expect(tsx).not.toMatch(/meetLabels\.joined/);
  });
});
