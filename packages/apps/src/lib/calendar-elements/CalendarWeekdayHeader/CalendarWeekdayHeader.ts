import { Temporal } from "@js-temporal/polyfill";
import { html, unsafeCSS, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import type { WeekdayNumber } from "../types/Weekday.js";
import {
  clampDaysPerWeek,
  clampGridDaysPerWeek,
  daysPerWeekFromInput,
} from "../utils/DaysPerWeek.js";
import { getLocaleDirection, getLocaleWeekInfo, resolveLocale } from "../utils/Locale.js";
import { renderPlusIcon } from "../icons/PlusIcon.js";
import componentStyle from "./CalendarWeekdayHeader.css?inline";

function isWeekdayNumber(value: number | undefined): value is WeekdayNumber {
  return Boolean(value && Number.isInteger(value) && value >= 1 && value <= 7);
}

@customElement("calendar-weekday-header")
export class CalendarWeekdayHeader extends BaseElement {
  lang = "";
  weekStart?: number;
  /**
   * Forces the one-letter (narrow) weekday variant regardless of measured cell width.
   * Compact compositions whose cells can outgrow the 64px narrow breakpoint (e.g. the
   * timeline year grid's forced-compact month cards) opt in via this instead of relying on
   * the width-based container query alone.
   */
  narrow = false;
  /**
   * Forces right-to-left column order (same prop the calendar views take), so a composing
   * view's forced-RTL day grid and this header flip together even under an LTR locale.
   * Off (default) keeps the locale-derived direction.
   */
  rtl = false;
  /**
   * ISO date of the first column. When set (and parseable) the header switches to its
   * interactive date mode: columns are the consecutive dates starting here (ordering comes
   * from the dates themselves, not `weekStart`), each rendered as a clickable day-selection
   * button showing the weekday name plus a day-number pill — the chrome the composed
   * day/week timeline needs. Unset (default) keeps the label-only weekday row.
   */
  startDate = "";
  /**
   * ISO date to mark as "today" in date mode (highlight pill + `aria-current="date"`).
   * Composing views pass their resolved current date so a mocked `currentTime` and this
   * header always agree.
   */
  currentDate = "";
  #daysPerWeekStored = 7;

  static get properties() {
    return {
      weekStart: { type: Number, attribute: "week-start", reflect: true },
      lang: { type: String },
      narrow: { type: Boolean, reflect: true },
      rtl: { type: Boolean, reflect: true },
      startDate: { type: String, attribute: "start-date" },
      currentDate: { type: String, attribute: "current-date" },
    } as const;
  }

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  get #resolvedLocale(): string {
    return resolveLocale(this.lang);
  }

  get #resolvedWeekStart(): WeekdayNumber {
    if (isWeekdayNumber(this.weekStart)) return this.weekStart as WeekdayNumber;
    const firstDay = getLocaleWeekInfo(this.#resolvedLocale).firstDay;
    return isWeekdayNumber(firstDay) ? firstDay : 1;
  }

  @property({ type: Number, attribute: "days-per-week", reflect: true })
  get daysPerWeek(): number {
    return clampDaysPerWeek(this.#daysPerWeekStored);
  }

  set daysPerWeek(value: number | string | null | undefined) {
    const next = daysPerWeekFromInput(value);
    if (Object.is(next, this.#daysPerWeekStored)) return;
    const previous = this.#daysPerWeekStored;
    this.#daysPerWeekStored = next;
    this.requestUpdate("daysPerWeek", previous);
  }

  get #weekdayNumbers(): WeekdayNumber[] {
    const weekStart = this.#resolvedWeekStart;
    const ordered = Array.from(
      { length: 7 },
      (_, index) => (((weekStart - 1 + index) % 7) + 1) as WeekdayNumber,
    );
    return ordered.slice(0, this.daysPerWeek);
  }

  get #weekendDays(): Set<number> {
    return new Set(getLocaleWeekInfo(this.#resolvedLocale).weekend);
  }

  #weekdayDate(weekday: WeekdayNumber): Date {
    // Monday reference week to generate locale weekday labels consistently.
    return new Date(Date.UTC(2024, 0, 1 + (weekday - 1)));
  }

  #formatWeekday(weekday: WeekdayNumber, width: "long" | "short" | "narrow"): string {
    return new Intl.DateTimeFormat(this.#resolvedLocale, { weekday: width }).format(
      this.#weekdayDate(weekday),
    );
  }

  /** Date-mode columns: consecutive dates from `startDate`, or null in label-only mode. */
  get #dateModeDays(): Temporal.PlainDate[] | null {
    if (!this.startDate) return null;
    let start: Temporal.PlainDate;
    try {
      start = Temporal.PlainDate.from(this.startDate);
    } catch {
      return null;
    }
    // The grid clamp (1..42), not the week clamp (1..7): composed views can span custom
    // multi-week day ranges and the header must keep one column per day to stay aligned.
    const count = clampGridDaysPerWeek(this.#daysPerWeekStored);
    return Array.from({ length: count }, (_, index) => start.add({ days: index }));
  }

  get #parsedCurrentDate(): Temporal.PlainDate | null {
    if (!this.currentDate) return null;
    try {
      return Temporal.PlainDate.from(this.currentDate);
    } catch {
      return null;
    }
  }

  /**
   * Grid-view-parity `day-selection` (click/Enter/Space on a date-mode button). Buttons
   * synthesize click for Enter/Space with `event.detail === 0`, covering keyboard too.
   */
  #emitDaySelection(day: Temporal.PlainDate, dayIndex: number, event: MouseEvent) {
    const keyboard = event.detail === 0;
    this.dispatchEvent(
      new CustomEvent("day-selection", {
        bubbles: true,
        composed: true,
        detail: {
          date: day.toString(),
          dayIndex,
          trigger: keyboard ? "keyboard" : "click",
          pointerType: keyboard ? "keyboard" : "mouse",
          sourceEvent: event,
        },
      }),
    );
  }

  #emitDayCreate(day: Temporal.PlainDate, dayIndex: number) {
    this.dispatchEvent(
      new CustomEvent("day-create-requested", {
        bubbles: true,
        composed: true,
        detail: { date: day.toString(), dayIndex },
      }),
    );
  }

  /**
   * Interactive date-mode row: one day-selection button per date, with the same responsive
   * long/short/narrow weekday label spans as the label-only mode plus a day-number pill
   * (today gets the highlight pill + aria-current). Not aria-hidden — unlike the decorative
   * label row, these buttons are the real day-selection affordance.
   */
  #renderDateHeader(days: Temporal.PlainDate[], direction: "ltr" | "rtl"): TemplateResult {
    const weekendDays = this.#weekendDays;
    const today = this.#parsedCurrentDate;
    const numberFormatter = new Intl.NumberFormat(this.#resolvedLocale);
    const fullDateFormatter = new Intl.DateTimeFormat(this.#resolvedLocale, {
      dateStyle: "full",
    });
    return html`
      <div
        class="weekday-header"
        dir=${direction}
        style=${`grid-template-columns: repeat(${days.length}, minmax(0, 1fr));`}
      >
        ${days.map((day, index) => {
          const weekday = day.dayOfWeek as WeekdayNumber;
          const isToday = today !== null && Temporal.PlainDate.compare(day, today) === 0;
          const dayDate = new Date(Date.UTC(day.year, day.month - 1, day.day));
          const fullDateLabel = fullDateFormatter.format(dayDate);
          return html`
            <div class="weekday weekday-date-cell ${weekendDays.has(weekday) ? "weekend" : ""}">
              <button
                type="button"
                class="weekday-date-button"
                .ariaLabel=${fullDateLabel}
                .ariaCurrent=${isToday ? "date" : null}
                @click=${(clickEvent: MouseEvent) => this.#emitDaySelection(day, index, clickEvent)}
              >
                <span class="weekday-label">
                  <span class="weekday-long">${this.#formatWeekday(weekday, "long")}</span>
                  <span class="weekday-short">${this.#formatWeekday(weekday, "short")}</span>
                  <span class="weekday-narrow">${this.#formatWeekday(weekday, "narrow")}</span>
                </span>
                <span class="weekday-day-number ${isToday ? "is-today" : ""}">
                  ${numberFormatter.format(day.day)}
                </span>
              </button>
              <button
                type="button"
                class="weekday-create-button"
                .ariaLabel=${`Create event on ${fullDateLabel}`}
                @click=${() => this.#emitDayCreate(day, index)}
              >
                ${renderPlusIcon({ className: "weekday-create-button__icon" })}
              </button>
            </div>
          `;
        })}
      </div>
    `;
  }

  render() {
    const direction = this.rtl ? "rtl" : getLocaleDirection(this.#resolvedLocale);
    const dateModeDays = this.#dateModeDays;
    if (dateModeDays) return this.#renderDateHeader(dateModeDays, direction);
    const weekendDays = this.#weekendDays;
    return html`
      <div
        class="weekday-header"
        dir=${direction}
        style=${`grid-template-columns: repeat(${this.daysPerWeek}, minmax(0, 1fr));`}
        aria-hidden="true"
      >
        ${this.#weekdayNumbers.map(
          (weekday) => html`
            <div class="weekday ${weekendDays.has(weekday) ? "weekend" : ""}">
              <span class="weekday-label">
                <span class="weekday-long">${this.#formatWeekday(weekday, "long")}</span>
                <span class="weekday-short">${this.#formatWeekday(weekday, "short")}</span>
                <span class="weekday-narrow">${this.#formatWeekday(weekday, "narrow")}</span>
              </span>
            </div>
          `,
        )}
      </div>
    `;
  }
}
