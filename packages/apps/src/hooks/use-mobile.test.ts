import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MOBILE_BREAKPOINT_PX, MOBILE_MEDIA_QUERY } from "@/hooks/use-mobile";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "use-mobile.tsx"),
  "utf8",
);

describe("useIsMobile breakpoint", () => {
  it("switches below Tailwind md so portrait iPad (768px) stays desktop", () => {
    expect(MOBILE_BREAKPOINT_PX).toBe(768);
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 767px)");
  });

  it("reads matchMedia.matches on first paint instead of window.innerWidth", () => {
    expect(source).toContain("useSyncExternalStore");
    expect(source).toContain("getSnapshot");
    expect(source).toMatch(/matchMedia\(MOBILE_MEDIA_QUERY\)\.matches/);
    expect(source).not.toMatch(/\bwindow\.innerWidth\b/);
    expect(source).not.toContain("!!isMobile");
  });
});
