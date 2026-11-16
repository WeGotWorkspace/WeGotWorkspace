import { describe, expect, it } from "vitest";
import {
  CONNECTION_PHASE_REVEAL_MS,
  docsCollabConnectionPhase,
  shouldRevealConnectionPhase,
} from "./docs-collab-connection-phase";

describe("docsCollabConnectionPhase", () => {
  it("recognises the three transient connection phases", () => {
    expect(docsCollabConnectionPhase("Connecting to collaborators…")).toBe("connecting");
    expect(docsCollabConnectionPhase("Reconnecting…")).toBe("reconnecting");
    expect(docsCollabConnectionPhase("Rejoining…")).toBe("rejoining");
  });

  it("leaves durable states and errors alone", () => {
    expect(docsCollabConnectionPhase("")).toBeNull();
    expect(docsCollabConnectionPhase("Saved")).toBeNull();
    expect(docsCollabConnectionPhase("Editing offline")).toBeNull();
    expect(docsCollabConnectionPhase("Save failed: network down")).toBeNull();
  });
});

describe("shouldRevealConnectionPhase", () => {
  it("holds the phase for 1.5 seconds", () => {
    expect(CONNECTION_PHASE_REVEAL_MS).toBe(1500);
    expect(shouldRevealConnectionPhase(1_000, 1_000)).toBe(false);
    expect(shouldRevealConnectionPhase(1_000, 2_499)).toBe(false);
    expect(shouldRevealConnectionPhase(1_000, 2_500)).toBe(true);
    expect(shouldRevealConnectionPhase(1_000, 9_000)).toBe(true);
  });

  it("never reveals a phase that is not active", () => {
    expect(shouldRevealConnectionPhase(null, 9_000)).toBe(false);
  });
});
