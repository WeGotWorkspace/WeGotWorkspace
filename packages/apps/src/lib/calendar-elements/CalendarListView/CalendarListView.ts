import { Temporal } from "@js-temporal/polyfill";
import { html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { CalendarViewBase } from "../CalendarViewBase/CalendarViewBase.js";
import "../EventCard/EventCard.js";
import type { CalendarEvent as EventInput } from "@/lib/calendar-engine";
import { resolvedDataEnd } from "../domain/events-api/eventMapBridge.js";
import { renderCalendarIcon } from "../icons/CalendarIcon.js";
import {
  isCalendarEventException,
  isCalendarEventRecurring,
} from "../types/calendarEventSemantics.js";
import { clampAgendaDaysPerWeek, daysPerWeekFromInput } from "../utils/DaysPerWeek.js";
import { eventSelectionOriginFromElement } from "../types/CalendarEventRequests.js";
import { getEventColorStyles } from "../utils/EventColor.js";
import { resolveLocale } from "../utils/Locale.js";
import { formatShortTime } from "../utils/TimeFormatting.js";
import collectionStateStyle from "@/collection-state/src/collection-state.css?inline";
import { CALENDAR_LIST_EMPTY_LABEL } from "./calendar-list-empty-label.js";
import componentStyle from "./CalendarListView.css?inline";

type AgendaItem = {
  id: string;
  event: EventInput;
  start: Temporal.PlainDateTime;
  end: Temporal.PlainDateTime;
  displayDate: Temporal.PlainDate;
  continuesFromPreviousDay: boolean;
  continuesToNextDay: boolean;
};

type AgendaDay = {
  date: Temporal.PlainDate;
  items: AgendaItem[];
};

@customElement("calendar-list-view")
export class CalendarListView extends CalendarViewBase {
  #startDate?: string;
  #daysPerWeekStored = 31;

  static get properties() {
    return {
      ...CalendarViewBase.properties,
      startDate: { type: String, attribute: "start-date" },
      emptyLabel: { type: String, attribute: "empty-label" },
    } as const;
  }

  emptyLabel = CALENDAR_LIST_EMPTY_LABEL;

  /**
   * When true, render the bound `events` map as already-expanded instances
   * (no startDate / 366-day agenda window). Search uses this so the list SST
   * can show the bootstrap window without becoming a period agenda.
   */
  @property({ type: Boolean, attribute: "use-event-set" })
  useEventSet = false;

  /** Height follows content; parent owns the scrollport. */
  @property({ type: Boolean, reflect: true })
  embedded = false;

  @property({ type: String, attribute: "sort-direction" })
  sortDirection: "asc" | "desc" = "asc";

  /** Search results only — period list/agenda headings stay month+day. */
  @property({ type: Boolean, attribute: "show-year-in-headings" })
  showYearInHeadings = false;

  get startDate(): Temporal.PlainDate {
    if (this.#startDate) {
      return Temporal.PlainDate.from(this.#startDate);
    }
    return this.#resolvedNow.toPlainDate();
  }

  set startDate(value: string | Temporal.PlainDate | undefined) {
    const nextValue =
      value === undefined
        ? undefined
        : value instanceof Temporal.PlainDate
          ? value.toString()
          : Temporal.PlainDate.from(value).toString();
    this.#startDate = nextValue;
  }

  @property({ type: Number, attribute: "days-per-week" })
  get daysPerWeek(): number {
    return clampAgendaDaysPerWeek(this.#daysPerWeekStored);
  }

  set daysPerWeek(value: number | string | null | undefined) {
    const next = daysPerWeekFromInput(value);
    if (Object.is(next, this.#daysPerWeekStored)) return;
    const previous = this.#daysPerWeekStored;
    this.#daysPerWeekStored = next;
    this.requestUpdate("daysPerWeek", previous);
  }

  static get styles() {
    return [...CalendarViewBase.styles, unsafeCSS(collectionStateStyle), unsafeCSS(componentStyle)];
  }

  render() {
    const direction = this.resolveDirection();
    const days = this.#agendaDays;

    return html`
      <div class="agenda-shell collection-state-host" dir=${direction}>
        ${days.length
          ? html`
              ${days.map(
                ({ date, items }) => html`
                  <section class="agenda-day" aria-labelledby=${`agenda-day-${date}`}>
                    <h2
                      class="agenda-day-heading"
                      id=${`agenda-day-${date}`}
                      aria-label=${this.#formatLongDateLabel(date)}
                    >
                      <span class="agenda-day-weekday">${this.#formatWeekday(date)}</span>
                      <span class="agenda-day-date">${this.#formatDayLabel(date)}</span>
                    </h2>
                    <ul class="agenda-event-list">
                      ${items.map((item) => this.#renderItem(item))}
                    </ul>
                  </section>
                `,
              )}
            `
          : html`
              <div class="collection-state">
                <div class="collection-state__icon" aria-hidden="true">${renderCalendarIcon()}</div>
                <div class="collection-state__body">${this.emptyLabel}</div>
              </div>
            `}
      </div>
    `;
  }

  #renderItem(item: AgendaItem) {
    const { event } = item;
    const isPast = Temporal.PlainDateTime.compare(item.end, this.#now) <= 0;
    const colorStyles = getEventColorStyles(this.resolveEventDisplayColor(event));
    const isRecurring = this.#isRecurringEvent(event);
    const isException = this.#isExceptionEvent(event);
    return html`
      <li
        class="agenda-event-item"
        data-event-key=${item.id}
        @click=${(clickEvent: MouseEvent) => this.#handleEventClick(item, clickEvent)}
      >
        <event-card
          layout="flow"
          .lang=${this.lang}
          .summary=${event.data.summary}
          .time=${this.#formatItemTime(item)}
          .location=${event.data.location ?? ""}
          .recurring=${isRecurring}
          .exception=${isException}
          ?past=${isPast}
          .rsvp=${event.participationStatus === "needs-action" ||
          event.participationStatus === "tentative"
            ? event.participationStatus
            : ""}
          style=${styleMap(colorStyles)}
        ></event-card>
      </li>
    `;
  }

  /** Align the agenda scrollport so this occurrence is the first visible row. */
  scrollToEvent(key: string) {
    const root = this.renderRoot;
    if (!root) return;
    for (const node of root.querySelectorAll("[data-event-key]")) {
      if (node.getAttribute("data-event-key") === key) {
        node.scrollIntoView({ block: "start" });
        return;
      }
    }
  }

  #handleEventClick(item: AgendaItem, event: MouseEvent) {
    const card =
      event.currentTarget instanceof Element
        ? (event.currentTarget.querySelector("event-card") ?? event.currentTarget)
        : null;
    const origin = eventSelectionOriginFromElement(card);
    this.dispatchEvent(
      new CustomEvent("event-selected", {
        detail: {
          key: item.id,
          ...(origin ? { origin } : {}),
        },
      }),
    );
  }

  get #agendaDays(): AgendaDay[] {
    const grouped = new Map<string, AgendaItem[]>();
    if (this.useEventSet) {
      for (const [id, event] of (this.events ?? new Map()).entries()) {
        this.#pushEventDays(grouped, id, event);
      }
      return this.#sortedAgendaDays(grouped);
    }

    const rangeStart = this.startDate;
    const rangeEndExclusive = rangeStart.add({ days: this.daysPerWeek });
    const renderedEvents = this.getRenderedEvents({
      start: rangeStart.toPlainDateTime({ hour: 0, minute: 0, second: 0 }),
      end: rangeEndExclusive.toPlainDateTime({ hour: 0, minute: 0, second: 0 }),
    });

    for (const [id, event] of renderedEvents.entries()) {
      const start = this.#toPlainDateTime(event.data.start);
      const end = this.#toPlainDateTime(resolvedDataEnd(event.data));
      if (Temporal.PlainDateTime.compare(end, start) <= 0) continue;
      if (!this.#eventOverlapsRange(start, end, rangeStart, rangeEndExclusive)) continue;
      this.#pushEventDays(grouped, id, event, rangeStart, rangeEndExclusive);
    }

    return this.#sortedAgendaDays(grouped);
  }

  #pushEventDays(
    grouped: Map<string, AgendaItem[]>,
    id: string,
    event: EventInput,
    rangeStart?: Temporal.PlainDate,
    rangeEndExclusive?: Temporal.PlainDate,
  ) {
    const start = this.#toPlainDateTime(event.data.start);
    const end = this.#toPlainDateTime(resolvedDataEnd(event.data));
    if (Temporal.PlainDateTime.compare(end, start) <= 0) return;

    const eventStartDate = start.toPlainDate();
    const eventEndDateInclusive = end.subtract({ nanoseconds: 1 }).toPlainDate();
    const firstDisplayDate =
      rangeStart && Temporal.PlainDate.compare(eventStartDate, rangeStart) < 0
        ? rangeStart
        : eventStartDate;
    const lastDisplayDate =
      rangeEndExclusive &&
      Temporal.PlainDate.compare(eventEndDateInclusive, rangeEndExclusive.subtract({ days: 1 })) > 0
        ? rangeEndExclusive.subtract({ days: 1 })
        : eventEndDateInclusive;

    let displayDate = firstDisplayDate;
    while (Temporal.PlainDate.compare(displayDate, lastDisplayDate) <= 0) {
      const key = displayDate.toString();
      const dayItems = grouped.get(key) ?? [];
      dayItems.push({
        id,
        event,
        start,
        end,
        displayDate,
        continuesFromPreviousDay: Temporal.PlainDate.compare(eventStartDate, displayDate) < 0,
        continuesToNextDay: Temporal.PlainDate.compare(eventEndDateInclusive, displayDate) > 0,
      });
      grouped.set(key, dayItems);
      displayDate = displayDate.add({ days: 1 });
    }
  }

  #sortedAgendaDays(grouped: Map<string, AgendaItem[]>): AgendaDay[] {
    const days = Array.from(grouped.entries())
      .sort(([a], [b]) =>
        Temporal.PlainDate.compare(Temporal.PlainDate.from(a), Temporal.PlainDate.from(b)),
      )
      .map(([date, items]) => ({
        date: Temporal.PlainDate.from(date),
        items: items.sort((a, b) => this.#compareAgendaItems(a, b)),
      }));
    return this.sortDirection === "desc" ? days.reverse() : days;
  }

  #eventOverlapsRange(
    start: Temporal.PlainDateTime,
    end: Temporal.PlainDateTime,
    rangeStart: Temporal.PlainDate,
    rangeEndExclusive: Temporal.PlainDate,
  ): boolean {
    const rangeStartDateTime = rangeStart.toPlainDateTime({ hour: 0, minute: 0, second: 0 });
    const rangeEndDateTime = rangeEndExclusive.toPlainDateTime({ hour: 0, minute: 0, second: 0 });
    return (
      Temporal.PlainDateTime.compare(start, rangeEndDateTime) < 0 &&
      Temporal.PlainDateTime.compare(end, rangeStartDateTime) > 0
    );
  }

  #compareAgendaItems(a: AgendaItem, b: AgendaItem): number {
    const startDiff = Temporal.PlainDateTime.compare(a.start, b.start);
    if (startDiff !== 0) return startDiff;
    const endDiff = Temporal.PlainDateTime.compare(a.end, b.end);
    if (endDiff !== 0) return endDiff;
    return a.event.data.summary.localeCompare(b.event.data.summary);
  }

  #formatDayLabel(date: Temporal.PlainDate): string {
    return new Intl.DateTimeFormat(this.#resolvedLocale, {
      month: "short",
      day: "numeric",
      ...(this.showYearInHeadings ? { year: "numeric" as const } : {}),
      timeZone: "UTC",
    }).format(this.#toDate(date));
  }

  #formatWeekday(date: Temporal.PlainDate): string {
    return new Intl.DateTimeFormat(this.#resolvedLocale, {
      weekday: "long",
      timeZone: "UTC",
    }).format(this.#toDate(date));
  }

  #formatLongDateLabel(date: Temporal.PlainDate): string {
    return new Intl.DateTimeFormat(this.#resolvedLocale, {
      dateStyle: "full",
      timeZone: "UTC",
    }).format(this.#toDate(date));
  }

  #formatItemTime(item: AgendaItem): string {
    if (this.#isAllDayEvent(item.event)) {
      const startDate = item.start.toPlainDate();
      const endDate = item.end.subtract({ nanoseconds: 1 }).toPlainDate();
      if (Temporal.PlainDate.compare(startDate, endDate) === 0) {
        return item.continuesFromPreviousDay ? "All day (continues)" : "All day";
      }
      if (!item.continuesFromPreviousDay && item.continuesToNextDay) {
        return `All day - until ${this.#formatDate(endDate)}`;
      }
      if (item.continuesFromPreviousDay && !item.continuesToNextDay) {
        return `All day - ends ${this.#formatDate(endDate)}`;
      }
      return "All day (continues)";
    }

    const startsAndEndsSameDay = Temporal.PlainDate.compare(
      item.start.toPlainDate(),
      item.end.toPlainDate(),
    );
    if (startsAndEndsSameDay === 0) {
      return `${this.#formatTime(item.start)} - ${this.#formatTime(item.end)}`;
    }
    if (!item.continuesFromPreviousDay && item.continuesToNextDay) {
      return `${this.#formatTime(item.start)} - continues`;
    }
    if (item.continuesFromPreviousDay && !item.continuesToNextDay) {
      return `Continues - ${this.#formatTime(item.end)}`;
    }
    if (item.continuesFromPreviousDay && item.continuesToNextDay) {
      return "Continues";
    }
    return `${this.#formatDateTime(item.start)} - ${this.#formatDateTime(item.end)}`;
  }

  #formatDate(date: Temporal.PlainDate): string {
    return new Intl.DateTimeFormat(this.#resolvedLocale, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(this.#toDate(date));
  }

  #formatDateTime(dateTime: Temporal.PlainDateTime): string {
    return new Intl.DateTimeFormat(this.#resolvedLocale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(this.#toDate(dateTime));
  }

  #formatTime(dateTime: Temporal.PlainDateTime): string {
    return formatShortTime(this.#resolvedLocale, dateTime);
  }

  #toDate(value: Temporal.PlainDate | Temporal.PlainDateTime): Date {
    if (value instanceof Temporal.PlainDate) {
      return new Date(Date.UTC(value.year, value.month - 1, value.day));
    }
    return new Date(
      Date.UTC(
        value.year,
        value.month - 1,
        value.day,
        value.hour,
        value.minute,
        value.second,
        value.millisecond,
      ),
    );
  }

  #toPlainDateTime(value: Temporal.PlainDateTime): Temporal.PlainDateTime {
    return value;
  }

  #isAllDayEvent(event: EventInput): boolean {
    return event.data.allDay === true;
  }

  #isRecurringEvent(event: EventInput): boolean {
    return isCalendarEventRecurring(event);
  }

  #isExceptionEvent(event: EventInput): boolean {
    return isCalendarEventException(event);
  }

  get #resolvedLocale(): string {
    return resolveLocale(this.lang);
  }

  get #now(): Temporal.PlainDateTime {
    return this.#resolvedNow;
  }

  get #resolvedNow(): Temporal.PlainDateTime {
    if (this.currentTime) {
      if (this.currentTime.includes("[") && this.currentTime.includes("]")) {
        const zoned = Temporal.ZonedDateTime.from(this.currentTime);
        return this.timezone
          ? zoned.withTimeZone(this.timezone).toPlainDateTime()
          : zoned.toPlainDateTime();
      }
      return Temporal.PlainDateTime.from(this.currentTime);
    }
    if (this.timezone) {
      return Temporal.Now.zonedDateTimeISO(this.timezone).toPlainDateTime();
    }
    return Temporal.Now.plainDateTimeISO();
  }
}
