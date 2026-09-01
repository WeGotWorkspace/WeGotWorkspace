import { describe, expect, it } from "vitest";
import {
  meetCallLayoutToThreadLayout,
  meetThreadPlacement,
} from "@/meet-core/src/meet-thread-placement";

describe("meetThreadPlacement", () => {
  it("uses the workspace panel when there is no call", () => {
    expect(meetThreadPlacement("none")).toBe("panel");
    expect(meetThreadPlacement(undefined, false)).toBe("panel");
  });

  it("uses a drawer over the chat column when a call is open", () => {
    expect(meetThreadPlacement("split")).toBe("drawer");
    expect(meetThreadPlacement("fullscreen")).toBe("drawer");
    expect(meetThreadPlacement(undefined, true)).toBe("drawer");
  });

  it("prefers callLayout over callActive", () => {
    expect(meetThreadPlacement("none", true)).toBe("panel");
    expect(meetThreadPlacement("split", false)).toBe("drawer");
  });

  it("maps call-stage layout onto thread placement layout", () => {
    expect(meetCallLayoutToThreadLayout("collapsed")).toBe("none");
    expect(meetCallLayoutToThreadLayout("side-by-side")).toBe("split");
    expect(meetCallLayoutToThreadLayout("fullscreen")).toBe("fullscreen");
  });
});
