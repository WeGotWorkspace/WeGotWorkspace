import { describe, expect, it } from "vitest";
import {
  DOCS_COLLAB_INDICATOR_MAX_NAMES,
  deriveDocsCollabIndicator,
  formatDocsCollabLiveNames,
} from "./docs-collab-indicator";

const base = { online: true, saving: false, saved: false, liveNames: [] as string[] };

describe("formatDocsCollabLiveNames", () => {
  it("joins up to three names in plain prose", () => {
    expect(formatDocsCollabLiveNames(["Ada"])).toBe("Ada");
    expect(formatDocsCollabLiveNames(["Ada", "Bo"])).toBe("Ada and Bo");
    expect(formatDocsCollabLiveNames(["Ada", "Bo", "Cy"])).toBe("Ada, Bo and Cy");
  });

  it("collapses the tail once past the inline limit", () => {
    expect(formatDocsCollabLiveNames(["Ada", "Bo", "Cy", "Di"])).toBe("Ada, Bo, Cy and 1 other");
    expect(formatDocsCollabLiveNames(["Ada", "Bo", "Cy", "Di", "Eve"])).toBe(
      "Ada, Bo, Cy and 2 others",
    );
    expect(DOCS_COLLAB_INDICATOR_MAX_NAMES).toBe(3);
  });

  it("ignores blank names so a half-joined editor cannot produce dangling commas", () => {
    expect(formatDocsCollabLiveNames(["Ada", "  ", ""])).toBe("Ada");
    expect(formatDocsCollabLiveNames([])).toBe("");
    expect(formatDocsCollabLiveNames(["  "])).toBe("");
  });
});

describe("deriveDocsCollabIndicator", () => {
  it("shows the live state with the other editors' names", () => {
    expect(deriveDocsCollabIndicator({ ...base, liveNames: ["Ada", "Bo"] })).toEqual({
      kind: "live",
      label: "Live with Ada and Bo",
    });
  });

  it("shows the saved state when nobody else is editing", () => {
    expect(deriveDocsCollabIndicator({ ...base, saved: true })).toEqual({
      kind: "saved",
      label: "Saved",
    });
  });

  it("shows the saving state", () => {
    expect(deriveDocsCollabIndicator({ ...base, saving: true, saved: true })).toEqual({
      kind: "saving",
      label: "Saving…",
    });
  });

  it("shows the offline state and keeps the device promise", () => {
    expect(deriveDocsCollabIndicator({ ...base, online: false, liveNames: ["Ada"] })).toEqual({
      kind: "offline",
      label: "Offline – changes are kept on this device",
    });
  });

  it("shows the save-only state while no direct connection exists", () => {
    expect(deriveDocsCollabIndicator({ ...base, saveOnly: true, liveNames: ["Ada"] })).toEqual({
      kind: "saveOnly",
      label: "Changes sync when saved",
    });
  });

  it("falls back to nothing at all when there is no story to tell", () => {
    expect(deriveDocsCollabIndicator(base)).toEqual({ kind: "idle", label: "" });
  });

  it("prefers company over a landed save, and a save in flight over company", () => {
    expect(deriveDocsCollabIndicator({ ...base, saved: true, liveNames: ["Ada"] }).label).toBe(
      "Live with Ada",
    );
    expect(deriveDocsCollabIndicator({ ...base, saving: true, liveNames: ["Ada"] }).label).toBe(
      "Saving…",
    );
  });

  it("shows a revealed transient phase in plain words", () => {
    expect(deriveDocsCollabIndicator({ ...base, phase: "connecting" })).toEqual({
      kind: "connecting",
      label: "Connecting…",
    });
    expect(deriveDocsCollabIndicator({ ...base, phase: "reconnecting" })).toEqual({
      kind: "reconnecting",
      label: "Reconnecting…",
    });
    expect(deriveDocsCollabIndicator({ ...base, phase: "rejoining" })).toEqual({
      kind: "rejoining",
      label: "Rejoining…",
    });
  });

  it("lets offline outrank a phase, and a phase outrank save and presence", () => {
    expect(deriveDocsCollabIndicator({ ...base, online: false, phase: "reconnecting" }).kind).toBe(
      "offline",
    );
    expect(
      deriveDocsCollabIndicator({ ...base, phase: "connecting", saving: true, liveNames: ["Ada"] })
        .kind,
    ).toBe("connecting");
  });

  it("never leaks transport vocabulary into any state", () => {
    // Whole words only: "device" legitimately ends in "ice".
    const jargon = /\b(mesh|signal+ing|ice|peers?|turn|stun|webrtc)\b/i;
    const indicators = [
      deriveDocsCollabIndicator({ ...base, online: false }),
      deriveDocsCollabIndicator({ ...base, saveOnly: true }),
      deriveDocsCollabIndicator({ ...base, saving: true }),
      deriveDocsCollabIndicator({ ...base, liveNames: ["Ada"] }),
      deriveDocsCollabIndicator({ ...base, saved: true }),
      deriveDocsCollabIndicator({ ...base, phase: "connecting" }),
      deriveDocsCollabIndicator({ ...base, phase: "reconnecting" }),
      deriveDocsCollabIndicator({ ...base, phase: "rejoining" }),
    ];

    for (const indicator of indicators) {
      expect(indicator.label).not.toMatch(jargon);
    }
  });
});
