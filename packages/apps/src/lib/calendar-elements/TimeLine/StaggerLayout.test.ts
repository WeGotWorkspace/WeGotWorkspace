import { describe, expect, it } from "vitest";
import { computeStaggerLayout } from "./StaggerLayout.js";

describe("computeStaggerLayout", () => {
  it("returns an empty array for no events", () => {
    expect(computeStaggerLayout([])).toEqual([]);
  });

  it("gives a lone event full width and no indent", () => {
    expect(computeStaggerLayout([{ start: 10, end: 20 }])).toEqual([
      { groupIndex: 0, groupSize: 1, indent: 0 },
    ]);
  });

  it("leaves non-overlapping events untouched", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
    expect(result).toEqual([
      { groupIndex: 0, groupSize: 1, indent: 0 },
      { groupIndex: 0, groupSize: 1, indent: 0 },
      { groupIndex: 0, groupSize: 1, indent: 0 },
    ]);
  });

  it("splits same-start overlapping events into an equal-width group", () => {
    const result = computeStaggerLayout([
      { start: 10, end: 30 },
      { start: 10, end: 20 },
    ]);
    expect(result).toEqual([
      { groupIndex: 0, groupSize: 2, indent: 0 },
      { groupIndex: 1, groupSize: 2, indent: 0 },
    ]);
  });

  it("orders same-start group members by input index (stable)", () => {
    const result = computeStaggerLayout([
      { start: 5, end: 15 },
      { start: 0, end: 20 },
      { start: 5, end: 25 },
    ]);
    // Events 0 and 2 share start 5: event 0 comes first in the group.
    expect(result[0]).toEqual({ groupIndex: 0, groupSize: 2, indent: 0 });
    expect(result[2]).toEqual({ groupIndex: 1, groupSize: 2, indent: 0 });
  });

  it("indents a later-starting overlap by one level per still-active earlier event", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 100 },
      { start: 10, end: 50 },
      { start: 20, end: 40 },
    ]);
    expect(result).toEqual([
      { groupIndex: 0, groupSize: 1, indent: 0 },
      { groupIndex: 0, groupSize: 1, indent: 1 },
      { groupIndex: 0, groupSize: 1, indent: 2 },
    ]);
  });

  it("does not indent past events that already ended", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 10 },
      { start: 5, end: 30 },
      { start: 15, end: 40 },
    ]);
    // At t=15 only event 1 is still active (event 0 ended at 10).
    expect(result[2]).toEqual({ groupIndex: 0, groupSize: 1, indent: 1 });
  });

  it("treats an event ending exactly at another's start as non-overlapping", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
    ]);
    expect(result[1]).toEqual({ groupIndex: 0, groupSize: 1, indent: 0 });
  });

  it("counts both members of an earlier same-start group towards a later event's indent", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 60 },
      { start: 0, end: 50 },
      { start: 20, end: 40 },
    ]);
    expect(result[0]).toEqual({ groupIndex: 0, groupSize: 2, indent: 0 });
    expect(result[1]).toEqual({ groupIndex: 1, groupSize: 2, indent: 0 });
    expect(result[2]).toEqual({ groupIndex: 0, groupSize: 1, indent: 2 });
  });

  it("keeps a later same-start group width-split without indent (reference grid behavior)", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 100 },
      { start: 20, end: 60 },
      { start: 20, end: 80 },
    ]);
    expect(result[1]).toEqual({ groupIndex: 0, groupSize: 2, indent: 0 });
    expect(result[2]).toEqual({ groupIndex: 1, groupSize: 2, indent: 0 });
  });

  it("is index-aligned regardless of input order", () => {
    const result = computeStaggerLayout([
      { start: 20, end: 40 },
      { start: 0, end: 100 },
      { start: 10, end: 50 },
    ]);
    expect(result[0]).toEqual({ groupIndex: 0, groupSize: 1, indent: 2 });
    expect(result[1]).toEqual({ groupIndex: 0, groupSize: 1, indent: 0 });
    expect(result[2]).toEqual({ groupIndex: 0, groupSize: 1, indent: 1 });
  });

  it("handles many stacked overlaps (cascade)", () => {
    const events = Array.from({ length: 50 }, (_, i) => ({ start: i, end: 1000 }));
    const result = computeStaggerLayout(events);
    for (let i = 0; i < events.length; i++) {
      expect(result[i]).toEqual({ groupIndex: 0, groupSize: 1, indent: i });
    }
  });

  it("ignores zero-duration events in the active set but still groups them", () => {
    const result = computeStaggerLayout([
      { start: 0, end: 0 },
      { start: 0, end: 10 },
      { start: 5, end: 15 },
    ]);
    // Events 0 and 1 share a start (group of 2); the zero-duration event never stays active,
    // so event 2 is only indented under event 1.
    expect(result[0]).toEqual({ groupIndex: 0, groupSize: 2, indent: 0 });
    expect(result[1]).toEqual({ groupIndex: 1, groupSize: 2, indent: 0 });
    expect(result[2]).toEqual({ groupIndex: 0, groupSize: 1, indent: 1 });
  });
});
