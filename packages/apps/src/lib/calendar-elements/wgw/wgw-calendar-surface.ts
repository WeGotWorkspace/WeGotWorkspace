import { ContextProvider } from "@lit/context";
import { css, html, LitElement } from "lit";
import type { CalendarEventsMap as EventsMap } from "@/lib/calendar-engine";
import type { PendingCreateGeometry } from "../CalendarTimelineView/pendingOccurrenceGeometry.js";
import type { CalendarViewGroup } from "../CalendarViewGroup/CalendarViewGroup.js";
import { eventsAPIContext, type EventsAPIContextValue } from "../context/EventsAPIContext.js";
import "../CalendarViewGroup/CalendarViewGroup.js";

/**
 * WGW-owned host for the vendored lit-calendar views (this file is ours, not
 * vendored): provides the events-api context (a JmapEventsAdapter while
 * online, an offline EventsAPI context that queues hybrid writes, a
 * MockJmapServer-backed adapter in stories, or nothing when neither is
 * available) and renders `<calendar-view-group>` with the visibility
 * filtering the reference `<event-calendar>` shell applies. React drives it
 * through properties; the host mirrors view-group navigation (day-number → day
 * view, etc.) onto its own properties so React can stay the source of truth.
 * Interaction events (`event-selected`, `event-create-requested`, …) bubble out
 * composed.
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
      pendingCreateIntent: { attribute: false },
      selectedEventKey: { type: String, attribute: "selected-event-key" },
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
  /** Create-dialog range while the React editor is open (drag-create preview persist). */
  pendingCreateIntent: PendingCreateGeometry | null = null;
  /** Event open in the React details popover; empty when nothing is previewed. */
  selectedEventKey = "";
  /**
   * React-provided resolver for Only-this / This-and-future (and All instances
   * on delete) when editing recurring occurrences via drag/delete in the Lit
   * views. Lit views reach this host across shadow roots (not via light-DOM
   * `closest` alone).
   */
  requestRecurrenceScope?: (request: {
    action: "edit" | "delete" | "update";
    masterId: string;
    recurrenceId?: string;
    description?: string;
  }) => Promise<"thisInstance" | "thisAndFuture" | "allInstances" | null>;

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

  /** Keep host props aligned when the view-group navigates on its own (day click, swipe). */
  #syncFromViewGroup = (event: Event) => {
    const target = event.target as CalendarViewGroup | null;
    if (!target) return;
    this.view = target.view;
    this.presentation = target.presentation;
    const nextStart = target.startDate;
    if (nextStart) this.startDate = nextStart.toString();
  };

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
        .pendingCreateIntent=${this.pendingCreateIntent}
        .selectedEventKey=${this.selectedEventKey}
        @view-changed=${this.#syncFromViewGroup}
        @start-date-changed=${this.#syncFromViewGroup}
        @presentation-changed=${this.#syncFromViewGroup}
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
