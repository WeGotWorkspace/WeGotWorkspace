import { describe, expect, it } from "vitest";
import { MOBILE_BREAKPOINT_PX, MOBILE_MEDIA_QUERY } from "@/hooks/use-mobile";

describe("useIsMobile breakpoint", () => {
  it("switches below Tailwind md so portrait iPad (768px) stays desktop", () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(768);
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 767px)");
  });
});
