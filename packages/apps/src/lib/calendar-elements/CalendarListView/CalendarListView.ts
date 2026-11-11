import { Temporal } from "@js-temporal/polyfill";
import { html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { CalendarViewBase } from "../CalendarViewBase/CalendarViewBase.js";
import "../EventCard/EventCard.js";
import type { CalendarEvent as EventInput } from "@/lib/calendar-engine";
import { renderCalendarIcon } from "../icons/CalendarIcon.js";
import {
  isCalendarEventException,
  isCalendarEventRecurring,
} from "../types/calendarEventSemantics.js";
import { clampAgendaDaysPerWeek, daysPerWeekFromInput } from "../utils/DaysPerWeek.js";
import { eventSelectionOriginFromElement } from "../types/CalendarEventRequests.js";
import { getEventColorStyles } from "../utils/EventColor.js";
import { resolveLocale } from "../utils/Locale.js";
import {
  formatAgendaDayLabel,
  formatAgendaItemTime,
  formatAgendaLongDate,
  formatAgendaWeekday,
  groupAgendaDays,
  type AgendaDay,
  type AgendaItem,
} from "../utils/agenda-days.js";
import collectionStateStyle from "@/collection-state/src/collection-state.css?inline";
import listStickyHeaderStyle from "@/list-sticky-header/src/list-sticky-header.css?inline";
import { CALENDAR_LIST_EMPTY_LABEL } from "./calendar-list-empty-label.js";
import componentStyle from "./CalendarListView.css?inline";

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
    return [
      ...CalendarViewBase.styles,
      unsafeCSS(collectionStateStyle),
      unsafeCSS(listStickyHeaderStyle),
      unsafeCSS(componentStyle),
    ];
  }

  render() {
    const direction = this.resolveDirection();
    const days = this.#agendaDays;

    return html`
      <div class="agenda-shell collection-state-host" dir=${direction}>
        ${
          days.length
            ? html`
                ${days.map(
                  ({ date, items }) => html`
                    <section class="agenda-day" aria-labelledby=${`agenda-day-${date}`}>
                      <h2
                        class="list-sticky-header agenda-day-heading"
                        id=${`agenda-day-${date}`}
                        aria-label=${this.#formatLongDateLabel(date)}
                      >
                        <span class="list-sticky-header__emphasis"
                          >${this.#formatWeekday(date)}</span
                        >
                        <span class="list-sticky-header__rest">${this.#formatDayLabel(date)}</span>
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
                  <div class="collection-state__icon" aria-hidden="true">
                    ${renderCalendarIcon()}
                  </div>
                  <div class="collection-state__body">${this.emptyLabel}</div>
                </div>
              `
        }
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
        @keydown=${(keyEvent: KeyboardEvent) => this.#handleEventKeyDown(item, keyEvent)}
      >
        <event-card
          role="button"
          tabindex="0"
          layout="flow"
          .lang=${this.lang}
          .summary=${event.data.summary}
          .time=${this.#formatItemTime(item)}
          .location=${event.data.location ?? ""}
          .recurring=${isRecurring}
          .exception=${isException}
          ?past=${isPast}
          .rsvp=${
            event.participationStatus === "needs-action" ||
            event.participationStatus === "tentative"
              ? event.participationStatus
              : ""
          }
          .overlay=${event.overlayKind ?? ""}
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

  /** Agenda rows open like buttons from the keyboard (Enter / Space). */
  #handleEventKeyDown(item: AgendaItem, event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.#handleEventClick(item, event);
  }

  #handleEventClick(item: AgendaItem, event: Event) {
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
    if (this.useEventSet) {
      return groupAgendaDays((this.events ?? new Map()).entries(), {
        timezone: this.timezone,
        sortDirection: this.sortDirection,
      });
    }
    const start = this.startDate;
    const end = start.add({ days: this.daysPerWeek });
    const renderedEvents = this.getRenderedEvents({
      start: start.toPlainDateTime({ hour: 0, minute: 0, second: 0 }),
      end: end.toPlainDateTime({ hour: 0, minute: 0, second: 0 }),
    });
    return groupAgendaDays(renderedEvents.entries(), {
      timezone: this.timezone,
      range: { start, end },
      sortDirection: this.sortDirection,
    });
  }

  #formatDayLabel(date: Temporal.PlainDate): string {
    return formatAgendaDayLabel(this.#resolvedLocale, date, this.showYearInHeadings);
  }

  #formatWeekday(date: Temporal.PlainDate): string {
    return formatAgendaWeekday(this.#resolvedLocale, date);
  }

  #formatLongDateLabel(date: Temporal.PlainDate): string {
    return formatAgendaLongDate(this.#resolvedLocale, date);
  }

  #formatItemTime(item: AgendaItem): string {
    return formatAgendaItemTime(this.#resolvedLocale, item);
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
