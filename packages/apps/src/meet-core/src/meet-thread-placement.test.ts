import { describe, expect, it } from "vitest";
import {
  meetCallLayoutToThreadLayout,
  meetThreadPlacement,
  meetThreadRailShowsBack,
} from "@/meet-core/src/meet-thread-placement";

describe("meetThreadPlacement", () => {
  it("always uses the shared workspace panel", () => {
    expect(meetThreadPlacement("none")).toBe("panel");
    expect(meetThreadPlacement(undefined, false)).toBe("panel");
    expect(meetThreadPlacement("split")).toBe("panel");
    expect(meetThreadPlacement("fullscreen")).toBe("panel");
    expect(meetThreadPlacement(undefined, true)).toBe("panel");
    expect(meetThreadPlacement("none", true)).toBe("panel");
    expect(meetThreadPlacement("split", false)).toBe("panel");
  });

  it("maps call-stage layout onto thread placement layout", () => {
    expect(meetCallLayoutToThreadLayout("collapsed")).toBe("none");
    expect(meetCallLayoutToThreadLayout("compact")).toBe("none");
    expect(meetCallLayoutToThreadLayout("side-by-side")).toBe("split");
    expect(meetCallLayoutToThreadLayout("fullscreen")).toBe("fullscreen");
  });

  it("shows thread back only in the expanded-call rail", () => {
    expect(meetThreadRailShowsBack(true, true)).toBe(true);
    expect(meetThreadRailShowsBack(true, false)).toBe(false);
    expect(meetThreadRailShowsBack(false, true)).toBe(false);
  });
});
