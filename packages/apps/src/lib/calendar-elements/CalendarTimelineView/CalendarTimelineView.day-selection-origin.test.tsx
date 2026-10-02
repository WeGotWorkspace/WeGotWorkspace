import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarEventsMap } from "@/lib/calendar-engine";
import type { EventSelectionRequestDetail } from "../types/CalendarEventRequests";
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

function sampleEvent(): CalendarEventsMap {
  return new Map([
    [
      "standup",
      {
        eventId: "standup@example.test",
        data: {
          start: Temporal.PlainDateTime.from("2026-08-18T09:00:00"),
          end: Temporal.PlainDateTime.from("2026-08-18T11:00:00"),
          summary: "Standup",
          color: "#6366f1",
        },
      },
    ],
  ]);
}

type Box = { left: number; top: number; width: number; height: number };

function domRect(box: Box): DOMRect {
  return {
    x: box.left,
    y: box.top,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    right: box.left + box.width,
    bottom: box.top + box.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function stubBox(element: Element, box: Box) {
  element.getBoundingClientRect = () => domRect(box);
}

const cardBox: Box = { left: 80, top: 140, width: 920, height: 180 };
const timeMainBox: Box = { left: 96, top: 148, width: 88, height: 16 };
const compactTimeBox: Box = { left: 96, top: 148, width: 52, height: 14 };

async function mount(mode: "day" | "week" | "month") {
  const el = document.createElement("calendar-timeline-view") as CalendarTimelineView;
  el.mode = mode;
  el.lang = "en-US";
  el.startDate = mode === "month" ? "2026-08-01" : "2026-08-18";
  el.weekStart = 1;
  el.timezone = "UTC";
  el.events = sampleEvent();
  document.body.append(el);
  await el.updateComplete;
  const timeline =
    el.shadowRoot?.querySelector("time-line.timeline-timed") ??
    el.shadowRoot?.querySelector("time-line");
  if (timeline && "updateComplete" in timeline) {
    await (timeline as { updateComplete: Promise<unknown> }).updateComplete;
  }
  const card = timeline?.shadowRoot?.querySelector("event-card");
  if (!(card instanceof HTMLElement) || !card.shadowRoot) {
    throw new Error("timed event card was not rendered");
  }
  if ("updateComplete" in card) {
    await (card as { updateComplete: Promise<unknown> }).updateComplete;
  }
  return { el, card };
}

function stubCardBoxes(card: HTMLElement, options: { timeMain: Box; compactTime?: Box }) {
  stubBox(card, cardBox);
  const timeMain = card.shadowRoot?.querySelector(".event-card-time-main");
  const compactTime = card.shadowRoot?.querySelector(".event-card-compact-time");
  if (!(timeMain instanceof Element)) throw new Error("event-card-time-main was not rendered");
  stubBox(timeMain, options.timeMain);
  if (options.compactTime) {
    if (!(compactTime instanceof Element)) {
      throw new Error("event-card-compact-time was not rendered");
    }
    stubBox(compactTime, options.compactTime);
  }
}

function listenForSelection(el: CalendarTimelineView) {
  let detail: EventSelectionRequestDetail | undefined;
  el.addEventListener("event-selected", (event) => {
    detail = (event as CustomEvent<EventSelectionRequestDetail>).detail;
  });
  return () => detail;
}

describe("CalendarTimelineView day selection origin", { timeout: 15_000 }, () => {
  beforeEach(() => {
    mockDomApis();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("anchors a day-view click to the painted time label, not the full card", async () => {
    const { el, card } = await mount("day");
    stubCardBoxes(card, { timeMain: timeMainBox });
    const selected = listenForSelection(el);

    card.click();

    expect(selected()?.key).toBe("standup");
    expect(selected()?.origin).toEqual(timeMainBox);
  });

  it("anchors day-view Enter to the painted time label", async () => {
    const { el, card } = await mount("day");
    stubCardBoxes(card, { timeMain: timeMainBox });
    const selected = listenForSelection(el);

    card.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );

    expect(selected()?.origin).toEqual(timeMainBox);
  });

  it("anchors a short day-view card to the compact time when the time row is hidden", async () => {
    const { el, card } = await mount("day");
    stubCardBoxes(card, {
      timeMain: { left: 0, top: 0, width: 0, height: 0 },
      compactTime: compactTimeBox,
    });
    const selected = listenForSelection(el);

    card.click();

    expect(selected()?.origin).toEqual(compactTimeBox);
  });

  it("keeps the full card origin outside day view", async () => {
    const { el, card } = await mount("week");
    stubCardBoxes(card, { timeMain: timeMainBox });
    const selected = listenForSelection(el);

    card.click();

    expect(selected()?.origin).toEqual(cardBox);
  });
});
