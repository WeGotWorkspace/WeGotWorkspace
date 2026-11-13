import { describe, expect, it } from "vitest";
import {
  layoutFloatingCommentOverlapIndents,
  layoutFloatingCommentTops,
  measureCommentCardMaxHeightPx,
  measureCommentCardViewportLeft,
  measureCommentCardsViewportTopInset,
  measureCommentFloatingLayerTop,
  measureCommentFloatingLayerTopFromSurface,
  measureCommentMarkViewportTop,
  resolveFloatingCardTop,
} from "./docs-comments-positioning";

describe("layoutFloatingCommentTops", () => {
  it("preserves ideal tops when cards do not overlap", () => {
    const tops = layoutFloatingCommentTops(
      [
        { id: "a", idealTop: 40, height: 120 },
        { id: "b", idealTop: 220, height: 120 },
      ],
      12,
    );

    expect(tops.get("a")).toBe(40);
    expect(tops.get("b")).toBe(220);
  });

  it("stacks overlapping cards with a minimum gap", () => {
    const tops = layoutFloatingCommentTops(
      [
        { id: "a", idealTop: 40, height: 120 },
        { id: "b", idealTop: 60, height: 120 },
      ],
      12,
    );

    expect(tops.get("a")).toBe(40);
    expect(tops.get("b")).toBe(172);
  });

  it("keeps cards below workspace header chrome", () => {
    const tops = layoutFloatingCommentTops(
      [
        { id: "a", idealTop: 40, height: 120 },
        { id: "b", idealTop: 220, height: 120 },
      ],
      12,
      96,
    );

    expect(tops.get("a")).toBe(96);
    expect(tops.get("b")).toBe(228);
  });

  it("pulls cards above the footer when they would overflow the viewport", () => {
    const tops = layoutFloatingCommentTops(
      [
        { id: "a", idealTop: 40, height: 120 },
        { id: "b", idealTop: 520, height: 160 },
      ],
      12,
      96,
      600,
    );

    expect(tops.get("a")).toBe(96);
    expect(tops.get("b")).toBe(440);
  });

  it("keeps the prioritized card fully visible even when stacked cards push it down", () => {
    const tops = layoutFloatingCommentTops(
      [
        { id: "a", idealTop: 120, height: 180 },
        { id: "b", idealTop: 140, height: 180 },
        { id: "c", idealTop: 160, height: 180 },
        { id: "draft", idealTop: 560, height: 180 },
      ],
      12,
      96,
      600,
      "draft",
    );

    expect(tops.get("draft")).toBe(420);
  });
});

describe("layoutFloatingCommentOverlapIndents", () => {
  it("does not indent cards that are far apart vertically", () => {
    const { indents, levels } = layoutFloatingCommentOverlapIndents([
      { id: "a", top: 40, height: 120 },
      { id: "b", top: 220, height: 120 },
    ]);

    expect(indents.get("a")).toBe(0);
    expect(indents.get("b")).toBe(0);
    expect(levels.get("a")).toBe(0);
    expect(levels.get("b")).toBe(0);
  });

  it("indents overlapping cards in a cascading stagger", () => {
    const { indents, levels } = layoutFloatingCommentOverlapIndents(
      [
        { id: "a", top: 40, height: 120 },
        { id: "b", top: 80, height: 120 },
        { id: "c", top: 110, height: 120 },
      ],
      18,
      108,
    );

    expect(indents.get("a")).toBe(0);
    expect(indents.get("b")).toBe(18);
    expect(indents.get("c")).toBe(36);
    expect(levels.get("a")).toBe(0);
    expect(levels.get("b")).toBe(1);
    expect(levels.get("c")).toBe(2);
  });

  it("preserves indent for active overlapping cards", () => {
    const { indents } = layoutFloatingCommentOverlapIndents(
      [
        { id: "a", top: 40, height: 120 },
        { id: "b", top: 80, height: 120 },
      ],
      18,
      108,
    );

    expect(indents.get("a")).toBe(0);
    expect(indents.get("b")).toBe(18);
  });

  it("indents when cards overlap only because of taller measured heights", () => {
    const { indents } = layoutFloatingCommentOverlapIndents([
      { id: "a", top: 100, height: 280 },
      { id: "b", top: 320, height: 280 },
    ]);

    expect(indents.get("a")).toBe(0);
    expect(indents.get("b")).toBe(18);
  });

  it("keeps monotonic stack levels when indents hit the max cap", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: String.fromCharCode(97 + index),
      top: 96,
      height: 200,
    }));

    const { indents, levels } = layoutFloatingCommentOverlapIndents(items, 18, 108);

    expect(indents.get("a")).toBe(0);
    expect(indents.get("b")).toBe(18);
    expect(indents.get("f")).toBe(90);
    expect(indents.get("g")).toBe(108);
    expect(indents.get("h")).toBe(108);
    expect(levels.get("g")).toBe(6);
    expect(levels.get("h")).toBe(7);
    expect(levels.get("h")).toBeGreaterThan(levels.get("g")!);
  });
});

describe("resolveFloatingCardTop overlap indents", () => {
  it("staggers cards clamped to the same viewport top", () => {
    const minTop = 96;
    const maxBottom = 800;
    const overlapItems = ["a", "b", "c"].map((id, index) => ({
      id,
      top: resolveFloatingCardTop(40 + index * 10, 200, minTop, maxBottom),
      height: 200,
    }));

    const { indents } = layoutFloatingCommentOverlapIndents(overlapItems);

    expect(overlapItems.every((item) => item.top === minTop)).toBe(true);
    expect(indents.get("a")).toBe(0);
    expect(indents.get("b")).toBe(18);
    expect(indents.get("c")).toBe(36);
  });
});

describe("measureCommentCardsViewportTopInset", () => {
  it("returns gap when header is missing", () => {
    expect(measureCommentCardsViewportTopInset(null, 8)).toBe(8);
  });
});

describe("measureCommentFloatingLayerTopFromSurface", () => {
  it("returns fallback when surface is missing", () => {
    expect(measureCommentFloatingLayerTopFromSurface(null, 8)).toBe(8);
  });

  it("returns the sheet surface viewport top", () => {
    const surface = {
      getBoundingClientRect: () => ({ top: 96 }),
    } as HTMLElement;

    expect(measureCommentFloatingLayerTopFromSurface(surface)).toBe(96);
  });
});

describe("measureCommentFloatingLayerTop", () => {
  it("returns gap when header and format bar are missing", () => {
    expect(measureCommentFloatingLayerTop(null, null, 8)).toBe(8);
  });

  it("uses header bottom when format bar is missing", () => {
    const header = {
      getBoundingClientRect: () => ({ bottom: 64 }),
    } as HTMLElement;

    expect(measureCommentFloatingLayerTop(header, null, 8)).toBe(72);
  });

  it("uses format bar bottom when it sits below the header", () => {
    const header = {
      getBoundingClientRect: () => ({ bottom: 64 }),
    } as HTMLElement;
    const formatBar = {
      getBoundingClientRect: () => ({ bottom: 112 }),
    } as HTMLElement;

    expect(measureCommentFloatingLayerTop(header, formatBar, 8)).toBe(120);
  });

  it("uses header bottom when format bar is above the header inset", () => {
    const header = {
      getBoundingClientRect: () => ({ bottom: 96 }),
    } as HTMLElement;
    const formatBar = {
      getBoundingClientRect: () => ({ bottom: 80 }),
    } as HTMLElement;

    expect(measureCommentFloatingLayerTop(header, formatBar, 8)).toBe(104);
  });
});

describe("measureCommentMarkViewportTop", () => {
  it("returns null when the mark is missing", () => {
    expect(measureCommentMarkViewportTop(null)).toBeNull();
  });
});

describe("measureCommentCardViewportLeft", () => {
  it("returns null when the surface is missing", () => {
    expect(measureCommentCardViewportLeft(null, 16)).toBeNull();
  });
});

describe("measureCommentCardMaxHeightPx", () => {
  it("limits height to the viewport when footer is missing", () => {
    expect(measureCommentCardMaxHeightPx(100, null, 16, 800)).toBe(684);
  });

  it("limits height to the footer top when it is above the viewport bottom", () => {
    const footer = {
      getBoundingClientRect: () => ({ top: 600 }),
    } as HTMLElement;

    expect(measureCommentCardMaxHeightPx(100, footer, 16, 800)).toBe(484);
  });
});
