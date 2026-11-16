import { describe, expect, it } from "vitest";
import { deriveDocsCollabIndicator } from "./docs-collab-indicator";

const base = { online: true, saving: false };

describe("deriveDocsCollabIndicator", () => {
  it("shows the saving state", () => {
    expect(deriveDocsCollabIndicator({ ...base, saving: true })).toEqual({
      kind: "saving",
      label: "Saving…",
    });
  });

  it("shows the offline state and keeps the device promise", () => {
    expect(deriveDocsCollabIndicator({ ...base, online: false })).toEqual({
      kind: "offline",
      label: "Offline – changes are kept on this device",
    });
  });

  it("shows the save-only state while no direct connection exists", () => {
    expect(deriveDocsCollabIndicator({ ...base, saveOnly: true })).toEqual({
      kind: "saveOnly",
      label: "Changes sync when saved",
    });
  });

  it("stays quiet once there is no connection or save story to tell", () => {
    const indicator = deriveDocsCollabIndicator(base);
    expect(indicator).toEqual({ kind: "idle", label: "" });
    expect(indicator.label).not.toMatch(/Live with/);
    expect(indicator.label).not.toBe("Saved");
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

  it("lets offline outrank a phase, and a phase outrank a save", () => {
    expect(deriveDocsCollabIndicator({ ...base, online: false, phase: "reconnecting" }).kind).toBe(
      "offline",
    );
    expect(deriveDocsCollabIndicator({ ...base, phase: "connecting", saving: true }).kind).toBe(
      "connecting",
    );
  });

  it("never leaks transport vocabulary into any state", () => {
    // Whole words only: "device" legitimately ends in "ice".
    const jargon = /\b(mesh|signal+ing|ice|peers?|turn|stun|webrtc)\b/i;
    const indicators = [
      deriveDocsCollabIndicator({ ...base, online: false }),
      deriveDocsCollabIndicator({ ...base, saveOnly: true }),
      deriveDocsCollabIndicator({ ...base, saving: true }),
      deriveDocsCollabIndicator(base),
      deriveDocsCollabIndicator({ ...base, phase: "connecting" }),
      deriveDocsCollabIndicator({ ...base, phase: "reconnecting" }),
      deriveDocsCollabIndicator({ ...base, phase: "rejoining" }),
    ];

    for (const indicator of indicators) {
      expect(indicator.label).not.toMatch(jargon);
    }
  });
});
