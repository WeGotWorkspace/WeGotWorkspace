import { afterEach, describe, expect, it } from "vitest";
import { eventSelectionOriginFromElement } from "./CalendarEventRequests.js";

function card(rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect;
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("eventSelectionOriginFromElement", () => {
  it("returns undefined for a non-element target", () => {
    expect(eventSelectionOriginFromElement(null)).toBeUndefined();
    expect(eventSelectionOriginFromElement(undefined)).toBeUndefined();
    expect(eventSelectionOriginFromElement(new EventTarget())).toBeUndefined();
  });

  it("returns the viewport rect of the card", () => {
    expect(
      eventSelectionOriginFromElement(card({ left: 10, top: 20, width: 120, height: 48 })),
    ).toEqual({ left: 10, top: 20, width: 120, height: 48 });
  });

  it("returns undefined for a collapsed rect so the popover can fall back", () => {
    expect(eventSelectionOriginFromElement(card({ left: 10, top: 20 }))).toBeUndefined();
  });
});
