import { describe, expect, it } from "vitest";
import {
  MEET_MIC_LEVEL_NOISE_FLOOR,
  meetMicRms,
  shouldPublishMeetMicLevel,
  smoothMeetMicLevel,
} from "@/meet-core/src/meet-mic-level";

function silence(length = 32): Uint8Array {
  return Uint8Array.from({ length }, () => 128);
}

function tone(amplitude: number, length = 32): Uint8Array {
  return Uint8Array.from(
    { length },
    (_, index) => 128 + Math.round(amplitude * 127 * (index % 2 === 0 ? 1 : -1)),
  );
}

describe("meetMicRms", () => {
  it("is ~0 for a silent time-domain buffer", () => {
    expect(meetMicRms(silence())).toBeCloseTo(0, 5);
  });

  it("rises with a louder square wave", () => {
    expect(meetMicRms(tone(0.2))).toBeGreaterThan(meetMicRms(tone(0.05)));
  });
});

describe("smoothMeetMicLevel", () => {
  it("gates ambient noise below the floor to 0", () => {
    expect(smoothMeetMicLevel(0, MEET_MIC_LEVEL_NOISE_FLOOR * 0.5)).toBe(0);
    expect(smoothMeetMicLevel(0, 0)).toBe(0);
  });

  it("attacks slower than the raw target and releases slower than it attacks", () => {
    const attack = smoothMeetMicLevel(0, 0.2);
    const nextAttack = smoothMeetMicLevel(attack, 0.2);
    expect(attack).toBeGreaterThan(0);
    expect(attack).toBeLessThan(0.6);
    expect(nextAttack).toBeGreaterThan(attack);

    const peaked = 0.8;
    const release = smoothMeetMicLevel(peaked, 0);
    const nextRelease = smoothMeetMicLevel(release, 0);
    expect(release).toBeLessThan(peaked);
    expect(peaked - release).toBeLessThan(attack);
    expect(nextRelease).toBeLessThan(release);
  });

  it("snaps a near-empty tail to 0 so the bar rests", () => {
    expect(smoothMeetMicLevel(0.008, 0)).toBe(0);
  });
});

describe("shouldPublishMeetMicLevel", () => {
  it("waits out the publish interval unless the bar would rest", () => {
    expect(shouldPublishMeetMicLevel(0.4, 0.45, 20, 0)).toBe(false);
    expect(shouldPublishMeetMicLevel(0.4, 0.45, 50, 0)).toBe(true);
    expect(shouldPublishMeetMicLevel(0.05, 0, 10, 0)).toBe(true);
  });
});
