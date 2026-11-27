import { describe, expect, it } from "vitest";
import { clampZoom, edgeSpeed, ZOOM_MAX, ZOOM_MIN } from "../src/ycsv-ux/touch";

describe("spike 7 touch helpers", () => {
  it("edge speed is zero in the middle and ramps up into the edge band", () => {
    expect(edgeSpeed(300, 100, 600, 40)).toBe(0);
    expect(edgeSpeed(590, 100, 600, 40)).toBeGreaterThan(0);
    expect(edgeSpeed(110, 100, 600, 40)).toBeLessThan(0);
    // Deeper is faster, capped past twice the band.
    expect(edgeSpeed(598, 100, 600, 40)).toBeGreaterThan(edgeSpeed(570, 100, 600, 40));
    expect(edgeSpeed(800, 100, 600, 40)).toBe(edgeSpeed(900, 100, 600, 40));
  });

  it("zoom stays in range and rounds to whole percents", () => {
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(1.23456)).toBe(1.23);
  });
});
