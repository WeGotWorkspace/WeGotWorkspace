import { Mic, Video } from "lucide-react";
import { describe, expect, it } from "vitest";
import { meetCallLiveIcon } from "@/meet-core/src/meet-call-live-icon";

describe("meetCallLiveIcon", () => {
  it("uses Mic for audio-only calls and Video otherwise", () => {
    expect(meetCallLiveIcon(true)).toBe(Mic);
    expect(meetCallLiveIcon(false)).toBe(Video);
  });
});
