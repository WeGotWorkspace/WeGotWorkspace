import { ContextProvider } from "@lit/context";
import { css, html, LitElement } from "lit";
import type { CalendarEventsMap as EventsMap } from "@/lib/calendar-engine";
import { eventsAPIContext, type EventsAPIContextValue } from "../context/EventsAPIContext.js";
import "../CalendarViewGroup/CalendarViewGroup.js";

/**
 * WGW-owned host for the vendored lit-calendar views (this file is ours, not
 * vendored): provides the events-api context (a JmapEventsAdapter in the app,
 * a MockJmapServer-backed adapter in stories, or nothing for read-only
 * offline rendering) and renders `<calendar-view-group>` with the visibility
 * filtering the reference `<event-calendar>` shell applies. React drives it
 * purely through properties; interaction events (`event-selected`,
 * `event-create-requested`, …) bubble out composed.
 */
export class WgwCalendarSurface extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    calendar-view-group {
      flex: 1;
      min-height: 0;
    }
  `;

  static get properties() {
    return {
      view: { type: String },
      presentation: { type: String },
      startDate: { type: String, attribute: "start-date" },
      weekStart: { type: Number, attribute: "week-start" },
      timezone: { type: String },
      selectedCalendarId: { type: String, attribute: false },
      events: { attribute: false },
      visibleCalendarIds: { attribute: false },
    } as const;
  }

  view = "month";
  presentation: "grid" | "list" = "grid";
  startDate = "";
  weekStart = 1;
  timezone?: string;
  selectedCalendarId?: string;
  events: EventsMap = new Map();
  visibleCalendarIds?: string[];

  #provider = new ContextProvider(this, { context: eventsAPIContext });

  /** The mutation/store API for the views; undefined renders read-only. */
  set contextValue(value: EventsAPIContextValue | undefined) {
    if (value) {
      this.#provider.setValue(value, true);
    }
  }

  get #visibleEvents(): EventsMap {
    const selected = this.visibleCalendarIds;
    if (selected === undefined) return this.events;
    if (selected.length === 0) return new Map();
    const allowed = new Set(selected);
    const filtered: EventsMap = new Map();
    for (const [key, event] of this.events) {
      if (!event.calendarId || allowed.has(event.calendarId)) {
        filtered.set(key, event);
      }
    }
    return filtered;
  }

  override render() {
    return html`
      <calendar-view-group
        .events=${this.#visibleEvents}
        view=${this.view}
        presentation=${this.presentation}
        start-date=${this.startDate}
        week-start=${this.weekStart}
        timezone=${this.timezone ?? ""}
        selected-calendar-id=${this.selectedCalendarId ?? ""}
      ></calendar-view-group>
    `;
  }
}

if (!customElements.get("wgw-calendar-surface")) {
  customElements.define("wgw-calendar-surface", WgwCalendarSurface);
}

declare global {
  interface HTMLElementTagNameMap {
    "wgw-calendar-surface": WgwCalendarSurface;
  }
}
