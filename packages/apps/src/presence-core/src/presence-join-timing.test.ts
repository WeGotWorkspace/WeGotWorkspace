import { describe, expect, it } from "vitest";
import {
  decidePresenceJoinMode,
  PRESENCE_MOBILE_VIEWPORT_MAX_PX,
} from "@/presence-core/src/presence-join-timing";

describe("decidePresenceJoinMode", () => {
  it("joins eagerly on desktop (fine pointer, wide viewport)", () => {
    expect(decidePresenceJoinMode({ hasCoarsePointer: false, viewportWidth: 1440 })).toBe("eager");
  });

  it("joins lazily on touch devices regardless of viewport", () => {
    expect(decidePresenceJoinMode({ hasCoarsePointer: true, viewportWidth: 1440 })).toBe("lazy");
  });

  it("joins lazily on small viewports regardless of pointer", () => {
    expect(
      decidePresenceJoinMode({
        hasCoarsePointer: false,
        viewportWidth: PRESENCE_MOBILE_VIEWPORT_MAX_PX,
      }),
    ).toBe("lazy");
    expect(
      decidePresenceJoinMode({
        hasCoarsePointer: false,
        viewportWidth: PRESENCE_MOBILE_VIEWPORT_MAX_PX + 1,
      }),
    ).toBe("eager");
  });
});
