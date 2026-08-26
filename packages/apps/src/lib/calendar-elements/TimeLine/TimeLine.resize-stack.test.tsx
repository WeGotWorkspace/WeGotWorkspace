import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeLine } from "./TimeLine";
import "./TimeLine";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

function pointerOn(
  target: EventTarget,
  type: string,
  clientX: number,
  clientY: number,
  extra: PointerEventInit = {},
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX,
      clientY,
      ...extra,
    }),
  );
}

describe("TimeLine resize overlay stacking", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("lifts the resized card into the top-layer overlay", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 7;
    el.columns = 7;
    el.max = 1440;
    el.step = 1440;
    el.flow = "horizontal";
    el.layout = "masonry";
    el.height = "auto";
    el.events = [
      { start: 0, end: 1440, key: "early", color: "#6366f1" },
      { start: 6 * 1440, end: 7 * 1440, key: "late", color: "#0f766e" },
    ];
    document.body.append(el);
    await el.updateComplete;

    const early = el.shadowRoot?.querySelector('.event[data-index="0"]');
    const late = el.shadowRoot?.querySelector('.event[data-index="1"]');
    expect(early).toBeInstanceOf(HTMLElement);
    expect(late).toBeInstanceOf(HTMLElement);
    if (!(early instanceof HTMLElement) || !(late instanceof HTMLElement)) return;

    const originCell = early.closest(".cell");
    const laterCell = late.closest(".cell");
    expect(originCell).toBeInstanceOf(HTMLElement);
    expect(laterCell).toBeInstanceOf(HTMLElement);
    if (!(originCell instanceof HTMLElement) || !(laterCell instanceof HTMLElement)) return;

    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 700, height: 200, right: 700, bottom: 200 }),
    });
    for (const [i, main] of [...(el.shadowRoot?.querySelectorAll(".cell-main") ?? [])].entries()) {
      if (!(main instanceof HTMLElement)) continue;
      Object.defineProperty(main, "getBoundingClientRect", {
        value: () => ({
          left: i * 100,
          top: 0,
          width: 100,
          height: 200,
          right: i * 100 + 100,
          bottom: 200,
        }),
      });
    }

    pointerOn(early, "pointerenter", 80, 20);
    await el.updateComplete;

    const handle = early.querySelector('resize-handle[position="end"]');
    expect(handle).toBeInstanceOf(HTMLElement);
    if (!(handle instanceof HTMLElement)) return;

    pointerOn(handle, "pointerdown", 90, 20);
    pointerOn(window, "pointermove", 150, 20);
    await el.updateComplete;

    expect(early.classList.contains("event--dragging")).toBe(true);
    expect(originCell.querySelector(".event--dragging")).toBe(early);
    expect(laterCell.querySelector(".event--dragging")).toBeNull();

    const overlay = el.shadowRoot?.querySelector(".event--drag-overlay");
    const layer = el.shadowRoot?.querySelector(".drag-layer");
    expect(overlay).toBeInstanceOf(HTMLElement);
    expect(layer).toBeInstanceOf(HTMLElement);
    expect(layer?.parentElement?.classList.contains("viewport")).toBe(true);
    expect(layer?.getAttribute("popover")).toBe("manual");
    expect(overlay?.closest(".cell")).toBeNull();
    expect(early.classList.contains("event--drag-overlay")).toBe(false);
    expect(early.style.transform).not.toMatch(/translate/);
  });
});
