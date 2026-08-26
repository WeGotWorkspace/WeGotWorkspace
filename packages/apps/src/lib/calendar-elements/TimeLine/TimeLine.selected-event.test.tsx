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

describe("TimeLine selected-event resize handles", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("omits resize handles when resizeHandles is false", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 100;
    el.resizeHandles = false;
    el.events = [{ start: 10, end: 40, key: "dentist", color: "#6366f1" }];
    el.selectedEventKey = "dentist";
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll("resize-handle")).toHaveLength(0);
  });

  it("does not mount resize handles on idle unselected events", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 7;
    el.columns = 7;
    el.max = 100;
    el.flow = "horizontal";
    el.events = Array.from({ length: 80 }, (_, i) => ({
      start: (i % 7) * 100 + (i % 5) * 8,
      end: (i % 7) * 100 + (i % 5) * 8 + 6,
      key: `busy-${i}`,
      color: "#6366f1",
    }));
    const started = performance.now();
    document.body.append(el);
    await el.updateComplete;
    const firstPaintMs = performance.now() - started;

    const cards = el.shadowRoot?.querySelectorAll(".event") ?? [];
    const handles = el.shadowRoot?.querySelectorAll("resize-handle") ?? [];
    expect(cards.length).toBeGreaterThan(40);
    expect(handles).toHaveLength(0);
    // Naive mount-all paid 2 Lit custom elements per visible segment (~160 here).
    expect(firstPaintMs).toBeGreaterThan(0);
  });

  it("mounts grabbers for the hovered event only", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 100;
    el.events = [
      { start: 10, end: 40, key: "dentist", color: "#6366f1" },
      { start: 50, end: 80, key: "standup" },
    ];
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll("resize-handle")).toHaveLength(0);

    const standup = el.shadowRoot?.querySelector('.event[data-index="1"]');
    expect(standup).toBeInstanceOf(HTMLElement);
    standup?.dispatchEvent(
      new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }),
    );
    await el.updateComplete;

    expect(standup?.querySelectorAll("resize-handle")).toHaveLength(2);
    expect(
      el.shadowRoot?.querySelector('.event[data-index="0"]')?.querySelectorAll("resize-handle"),
    ).toHaveLength(0);

    standup?.dispatchEvent(
      new PointerEvent("pointerleave", { bubbles: true, pointerType: "mouse" }),
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll("resize-handle")).toHaveLength(0);
  });

  it("resizes from grabbers mounted on hover", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 1440;
    el.step = 15;
    el.flow = "vertical";
    el.events = [{ start: 570, end: 600, key: "standup", color: "#6366f1" }];
    document.body.append(el);
    await el.updateComplete;

    Object.defineProperty(el, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 200, height: 1440, right: 200, bottom: 1440 }),
    });
    const main = el.shadowRoot?.querySelector(".cell-main");
    if (main instanceof HTMLElement) {
      Object.defineProperty(main, "getBoundingClientRect", {
        value: () => ({ left: 0, top: 0, width: 200, height: 1440, right: 200, bottom: 1440 }),
      });
    }

    const card = el.shadowRoot?.querySelector(".event");
    expect(card).toBeInstanceOf(HTMLElement);
    card?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "mouse" }));
    await el.updateComplete;

    const handle = el.shadowRoot?.querySelector('resize-handle[position="end"]');
    expect(handle).toBeInstanceOf(HTMLElement);
    if (!(handle instanceof HTMLElement)) return;

    const resized = vi.fn();
    el.addEventListener("timeline-event-resize", resized);
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 40,
        clientY: 600,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 40,
        clientY: 720,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        clientX: 40,
        clientY: 720,
      }),
    );

    expect(resized).toHaveBeenCalled();
  });

  it("does not mount grabbers on touch hover", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 100;
    el.events = [{ start: 10, end: 40, key: "dentist", color: "#6366f1" }];
    document.body.append(el);
    await el.updateComplete;

    const card = el.shadowRoot?.querySelector(".event");
    card?.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true, pointerType: "touch" }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll("resize-handle")).toHaveLength(0);
  });

  it("activates grabbers only for the selected event key", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 100;
    el.events = [
      { start: 10, end: 40, key: "dentist", color: "#6366f1" },
      { start: 50, end: 80, key: "standup" },
    ];
    document.body.append(el);
    await el.updateComplete;

    expect(el.shadowRoot?.querySelectorAll("resize-handle[active]")).toHaveLength(0);

    el.selectedEventKey = "dentist";
    await el.updateComplete;

    const dentist = el.shadowRoot?.querySelector('.event[data-index="0"]');
    const standup = el.shadowRoot?.querySelector('.event[data-index="1"]');
    expect(dentist?.querySelectorAll("resize-handle[active]")).toHaveLength(2);
    expect(standup?.querySelectorAll("resize-handle[active]")).toHaveLength(0);

    const style = dentist instanceof HTMLElement ? (dentist.getAttribute("style") ?? "") : "";
    expect(style).toMatch(/--__start:\s*[\d.]+%/);
    expect(style).toMatch(/--__end:/);
    expect(style.indexOf("--__end:")).toBeLessThan(style.indexOf("--_lc-event-accent-color"));
    expect(style).toContain("#6366f1");
    expect(style).not.toContain("--_lc-event-bg:");
    expect(dentist?.classList.contains("event--selected")).toBe(true);
    expect(standup?.classList.contains("event--selected")).toBe(false);
    expect(dentist?.hasAttribute("data-selected")).toBe(true);
    expect(style).toMatch(/z-index:\s*400/);
  });

  it("marks every segment of a multi-day selected event", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 2;
    el.columns = 2;
    el.max = 100;
    el.flow = "vertical";
    el.events = [{ start: 10, end: 150, key: "summit" }];
    document.body.append(el);
    await el.updateComplete;

    el.selectedEventKey = "summit";
    await el.updateComplete;

    const segments = el.shadowRoot?.querySelectorAll(".event") ?? [];
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.classList.contains("event--selected")).toBe(true);
    }
  });

  it("stacks the selected overlapping event above the later-indent sibling", async () => {
    const el = document.createElement("time-line") as TimeLine;
    el.cells = 1;
    el.max = 100;
    el.flow = "vertical";
    el.layout = "stagger";
    el.events = [
      { start: 10, end: 80, key: "under" },
      { start: 30, end: 90, key: "over" },
    ];
    document.body.append(el);
    await el.updateComplete;

    el.selectedEventKey = "under";
    await el.updateComplete;

    const under = el.shadowRoot?.querySelector('.event[data-index="0"]');
    const over = el.shadowRoot?.querySelector('.event[data-index="1"]');
    expect(under).toBeInstanceOf(HTMLElement);
    expect(over).toBeInstanceOf(HTMLElement);
    if (!(under instanceof HTMLElement) || !(over instanceof HTMLElement)) return;

    expect(under.classList.contains("event--selected")).toBe(true);
    expect(over.classList.contains("event--selected")).toBe(false);
    expect(under.style.zIndex).toBe("400");
    expect(under.style.getPropertyValue("--time-line-event-selected-boost")).toBe("400");
    expect(over.style.zIndex).toBe("");
    expect(over.style.getPropertyValue("--time-line-event-selected-boost")).toBe("");

    const underZ = Number.parseInt(getComputedStyle(under).zIndex, 10);
    const overZ = Number.parseInt(getComputedStyle(over).zIndex, 10);
    expect(Number.isFinite(underZ)).toBe(true);
    expect(underZ).toBeGreaterThan(Number.isFinite(overZ) ? overZ : 0);
  });
});
