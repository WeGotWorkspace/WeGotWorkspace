import { describe, expect, it } from "vitest";
import { getEventColorStyles, hexToRgb, isHexColor, surfaceTint } from "./EventColor.js";

describe("isHexColor", () => {
  it("accepts six-digit hex in either case", () => {
    expect(isHexColor("#AABBCC")).toBe(true);
    expect(isHexColor("#aabbcc")).toBe(true);
  });

  it("rejects empty, short, and non-hex values", () => {
    expect(isHexColor(undefined)).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("rebeccapurple")).toBe(false);
  });
});

describe("surfaceTint", () => {
  it("mixes the color into the surface variable for both schemes", () => {
    const tint = surfaceTint("#336699", 10);
    expect(tint.startsWith("light-dark(")).toBe(true);
    expect(tint).toContain("#336699 10%");
    expect(tint).toContain("#336699 18%");
  });

  it("uses an explicit dark percentage when given", () => {
    expect(surfaceTint("#336699", 10, 40)).toContain("#336699 40%");
  });
});

describe("getEventColorStyles", () => {
  it("returns no custom properties for a non-hex color", () => {
    expect(getEventColorStyles("rebeccapurple")).toEqual({});
  });

  it("keeps the raw color on the accent edge", () => {
    expect(getEventColorStyles("#336699")["--_lc-event-accent-color"]).toBe("#336699");
  });

  it("progresses base, hover, and active tints monotonically", () => {
    const styles = getEventColorStyles("#336699");
    expect(styles["--_lc-event-bg"]).toBe(surfaceTint("#336699", 11));
    expect(styles["--_lc-event-bg-hover"]).toBe(surfaceTint("#336699", 17));
    expect(styles["--_lc-event-bg-active"]).toBe(surfaceTint("#336699", 23));
    expect(styles["--_lc-event-bg-focus"]).toBe(styles["--_lc-event-bg-active"]);
  });

  it("derives the border, text, focus ring, and shadow from the same color", () => {
    const styles = getEventColorStyles("#336699");
    expect(styles["--_lc-event-border-color"]).toBe(surfaceTint("#336699", 45));
    expect(styles["--_lc-event-text-color"]).toContain("#336699");
    expect(styles["--_lc-event-focus-ring-light"]).toContain("#336699 80%");
    expect(styles["--_lc-event-shadow"]).toContain("#336699 55%");
  });
});

describe("hexToRgb", () => {
  it("parses with and without the leading hash", () => {
    expect(hexToRgb("#336699")).toEqual({ r: 51, g: 102, b: 153 });
    expect(hexToRgb("336699")).toEqual({ r: 51, g: 102, b: 153 });
  });

  it("returns null for empty and malformed input", () => {
    expect(hexToRgb(undefined)).toBeNull();
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("#xyzxyz")).toBeNull();
  });
});
