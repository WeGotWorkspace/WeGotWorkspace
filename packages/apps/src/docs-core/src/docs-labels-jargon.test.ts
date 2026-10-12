import { describe, expect, it } from "vitest";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { meetLabels } from "@/meet-core/src/meet-labels";

/**
 * Whole words only — "device" legitimately ends in "ice", and "turn" has to be
 * allowed to appear inside ordinary words like "returning".
 */
const JARGON = /\b(mesh|signal+ing|ice|peers?|turn|stun|webrtc|datachannel)\b/i;

/** Calls every function label with plausible arguments so its output is covered too. */
function renderedStrings(labels: Record<string, unknown>): string[] {
  const rendered: string[] = [];
  for (const value of Object.values(labels)) {
    if (typeof value === "string") {
      rendered.push(value);
      continue;
    }
    if (typeof value !== "function") continue;
    const args = Array.from({ length: value.length }, (_unused, index) =>
      index === 0 ? "Ada" : 2,
    );
    const output: unknown = (value as (...xs: unknown[]) => unknown)(...args);
    if (typeof output === "string") rendered.push(output);
  }
  return rendered;
}

describe("user-visible label vocabulary", () => {
  it("keeps transport jargon out of every Docs label", () => {
    for (const label of renderedStrings(docsLabels)) {
      expect(label, label).not.toMatch(JARGON);
    }
  });

  it("keeps transport jargon out of every Meet label", () => {
    for (const label of renderedStrings(meetLabels)) {
      expect(label, label).not.toMatch(JARGON);
    }
  });

  it("actually detects the words it is guarding against", () => {
    expect("Connecting to mesh…").toMatch(JARGON);
    expect("Connecting to 2 peer(s)").toMatch(JARGON);
    expect("ICE failed").toMatch(JARGON);
    expect("Relaying via TURN").toMatch(JARGON);
    expect("Offline – changes are kept on this device").not.toMatch(JARGON);
  });
});
