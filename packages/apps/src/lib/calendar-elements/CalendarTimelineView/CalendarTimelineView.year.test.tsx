import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import { CalendarTimelineView } from "./CalendarTimelineView";
import "./CalendarTimelineView";

function mockDomApis() {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

function sampleEvents(): CalendarEventsMap {
  return new Map([
    [
      "standup",
      {
        eventId: "standup@example.test",
        data: {
          start: Temporal.PlainDateTime.from("2026-08-18T09:00:00"),
          end: Temporal.PlainDateTime.from("2026-08-18T09:30:00"),
          summary: "Standup",
          color: "#6366f1",
        },
      },
    ],
  ]);
}

describe("CalendarTimelineView year mode", () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("does not mount nested timelines, event cards, or resize handles", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = sampleEvents();
    document.body.append(el);
    await el.updateComplete;

    const root = el.shadowRoot;
    expect(root?.querySelectorAll("calendar-timeline-view")).toHaveLength(0);
    expect(root?.querySelectorAll("time-line")).toHaveLength(0);
    expect(root?.querySelectorAll("event-card")).toHaveLength(0);
    expect(root?.querySelectorAll("resize-handle")).toHaveLength(0);
    expect(root?.querySelectorAll(".year-days")).toHaveLength(12);
    expect(root?.querySelectorAll("button.year-day").length).toBe(12 * 42);
    expect(root?.querySelectorAll(".year-day-dot").length).toBeGreaterThan(0);
  });

  it("emits composed day-selection from an empty year day", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.lang = "en-US";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = new Map();
    document.body.append(el);
    await el.updateComplete;

    const selected = vi.fn();
    el.addEventListener("day-selection", selected);
    const august = [...(el.shadowRoot?.querySelectorAll(".month-card") ?? [])].find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("August"),
    );
    const emptyDay = [...(august?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        button.querySelector(".year-day-number")?.textContent?.trim() === "18" &&
        !button.classList.contains("is-outside-month"),
    );
    expect(emptyDay).toBeTruthy();
    (emptyDay as HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.composed).toBe(true);
    expect(event.detail.date).toBe("2026-08-18");
  });

  it("gives in-month and neighbor outside-month cells distinct CSS anchors", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.lang = "en-US";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = new Map();
    document.body.append(el);
    await el.updateComplete;

    const cards = [...(el.shadowRoot?.querySelectorAll(".month-card") ?? [])];
    const july = cards.find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("July"),
    );
    const august = cards.find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("August"),
    );
    const july31Label = new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(Date.UTC(2026, 6, 31)),
    );
    const inMonth = [...(july?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        (button as HTMLButtonElement).ariaLabel === july31Label &&
        !button.classList.contains("is-outside-month"),
    );
    const outsideMonth = [...(august?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        (button as HTMLButtonElement).ariaLabel === july31Label &&
        button.classList.contains("is-outside-month"),
    );

    expect(inMonth).toBeTruthy();
    expect(outsideMonth).toBeTruthy();
    const inMonthAnchor = cssAnchorName(inMonth as Element);
    const outsideAnchor = cssAnchorName(outsideMonth as Element);
    expect(inMonthAnchor).toMatch(/^--year-day-anchor-/);
    expect(outsideAnchor).toMatch(/^--year-day-anchor-/);
    expect(inMonthAnchor).not.toBe(outsideAnchor);

    const allAnchors = [...(el.shadowRoot?.querySelectorAll("button.year-day") ?? [])].map(
      (button) => cssAnchorName(button),
    );
    expect(allAnchors.every((name) => name.length > 0)).toBe(true);
    expect(new Set(allAnchors).size).toBe(allAnchors.length);
  });

  it("anchors the year popover to the clicked cell when the same date is on two cards", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.lang = "en-US";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = new Map([
      [
        "overlap",
        {
          eventId: "overlap@example.test",
          data: {
            start: Temporal.PlainDateTime.from("2026-07-31T09:00:00"),
            end: Temporal.PlainDateTime.from("2026-07-31T10:00:00"),
            summary: "Overlap",
            color: "#6366f1",
          },
        },
      ],
    ]);
    document.body.append(el);
    await el.updateComplete;

    const cards = [...(el.shadowRoot?.querySelectorAll(".month-card") ?? [])];
    const july = cards.find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("July"),
    );
    const august = cards.find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("August"),
    );
    const july31Label = new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(Date.UTC(2026, 6, 31)),
    );
    const inMonth = [...(july?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        (button as HTMLButtonElement).ariaLabel === july31Label &&
        !button.classList.contains("is-outside-month"),
    ) as HTMLButtonElement | undefined;
    const outsideMonth = [...(august?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        (button as HTMLButtonElement).ariaLabel === july31Label &&
        button.classList.contains("is-outside-month"),
    ) as HTMLButtonElement | undefined;
    expect(inMonth).toBeTruthy();
    expect(outsideMonth).toBeTruthy();

    inMonth!.click();
    await el.updateComplete;
    await el.updateComplete;
    const popoverAfterInMonth = el.shadowRoot?.querySelector(
      "day-overflow-popover.year-day-popover",
    );
    expect(cssPositionAnchor(popoverAfterInMonth)).toBe(cssAnchorName(inMonth!));

    outsideMonth!.click();
    await el.updateComplete;
    await el.updateComplete;
    const popoverAfterOutside = el.shadowRoot?.querySelector(
      "day-overflow-popover.year-day-popover",
    );
    expect(cssPositionAnchor(popoverAfterOutside)).toBe(cssAnchorName(outsideMonth!));
  });

  it("emits day-selection from an empty outside-month year day", async () => {
    const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
    el.mode = "year";
    el.lang = "en-US";
    el.startDate = "2026-08-01";
    el.weekStart = 1;
    el.events = new Map();
    document.body.append(el);
    await el.updateComplete;

    const selected = vi.fn();
    el.addEventListener("day-selection", selected);
    const august = [...(el.shadowRoot?.querySelectorAll(".month-card") ?? [])].find((card) =>
      card.querySelector(".month-title")?.textContent?.includes("August"),
    );
    const july31Label = new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(
      new Date(Date.UTC(2026, 6, 31)),
    );
    const outsideDay = [...(august?.querySelectorAll("button.year-day") ?? [])].find(
      (button) =>
        (button as HTMLButtonElement).ariaLabel === july31Label &&
        button.classList.contains("is-outside-month"),
    );
    expect(outsideDay).toBeTruthy();
    (outsideDay as HTMLButtonElement).click();

    expect(selected).toHaveBeenCalledTimes(1);
    const event = selected.mock.calls[0]?.[0] as CustomEvent<{ date?: string }>;
    expect(event.detail.date).toBe("2026-07-31");
  });
});

function cssAnchorName(element: Element): string {
  return (
    (element as HTMLElement).style.getPropertyValue("anchor-name") ||
    /anchor-name:\s*([^;]+)/.exec(element.getAttribute("style") ?? "")?.[1]?.trim() ||
    ""
  );
}

function cssPositionAnchor(element: Element | null | undefined): string {
  if (!element) return "";
  return (
    (element as HTMLElement).style.getPropertyValue("position-anchor") ||
    /position-anchor:\s*([^;]+)/.exec(element.getAttribute("style") ?? "")?.[1]?.trim() ||
    ""
  );
}
