import { Temporal } from "@js-temporal/polyfill";
import { html, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import { cache } from "lit/directives/cache.js";
import { CalendarViewBase } from "../CalendarViewBase/CalendarViewBase.js";
import "../CalendarTimelineView/CalendarTimelineView.js";
import "../CalendarWeekdayHeader/CalendarWeekdayHeader.js";
import "../CalendarListView/CalendarListView.js";
import type { CalendarPresentationMode, CalendarViewMode } from "../types/CalendarViewGroup.js";
import type { WeekdayNumber } from "../types/Weekday.js";
import { clampDaysPerWeek, daysPerWeekFromInput } from "../utils/DaysPerWeek.js";
import { resolveLocale } from "../utils/Locale.js";
import { startOfWeekFor, weekNumberForDate } from "../utils/WeekNumber.js";
import componentStyle from "./CalendarViewGroup.css?inline";
import { monthAnchorDate, yearAnchorDate } from "./timelineAnchorDates.js";

type RangeLabelPart = {
  text: string;
  isYear: boolean;
};

@customElement("calendar-view-group")
export class CalendarViewGroup extends CalendarViewBase {
  #view: CalendarViewMode = "month";
  #presentation: CalendarPresentationMode = "grid";
  #startDate?: string;
  weekStart?: number;
  #daysPerWeekStored = 7;
  snapInterval = 15;
  visibleHours?: number;
  rtl = false;

  static get properties() {
    return {
      ...CalendarViewBase.properties,
      view: {
        type: String,
        reflect: true,
        dispatchChangeEvent: { composed: true },
      },
      presentation: {
        type: String,
        reflect: true,
        dispatchChangeEvent: { composed: true },
      },
      startDate: {
        type: String,
        attribute: "start-date",
        dispatchChangeEvent: { composed: true },
      },
      weekStart: { type: Number, attribute: "week-start", reflect: true },
      daysPerWeek: {
        type: Number,
        attribute: "days-per-week",
      },
      snapInterval: { type: Number, attribute: "snap-interval" },
      visibleHours: { type: Number, attribute: "visible-hours" },
      rtl: { type: Boolean, reflect: true },
    } as const;
  }

  static get styles() {
    return [...CalendarViewBase.styles, unsafeCSS(componentStyle)];
  }

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

  render() {
    return html`
      <div class="calendar-view-group">
        <section class="content" role="tabpanel">${cache(this.#renderViewFor(this.view))}</section>
      </div>
    `;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  get view(): CalendarViewMode {
    return this.#view;
  }

  set view(value: CalendarViewMode | string | null | undefined) {
    const nextValue =
      value === "day" || value === "week" || value === "month" || value === "year"
        ? value
        : "month";
    this.#view = nextValue;
  }

  get presentation(): CalendarPresentationMode {
    return this.#presentation;
  }

  set presentation(value: CalendarPresentationMode | string | null | undefined) {
    this.#presentation = value === "list" ? "list" : "grid";
  }

  get month(): number {
    return this.#resolvedStartDate.month;
  }

  get year(): number {
    return this.#resolvedStartDate.year;
  }

  get weekNumber(): number {
    return this.#weekNumberFromStartDate(this.#resolvedStartDate);
  }

  get today(): string {
    return this.#now.toPlainDate().toString();
  }

  get rangeLabel(): string {
    return this.rangeLabelParts.map((part) => part.text).join("");
  }

  get rangeLabelParts(): RangeLabelPart[] {
    const lang = resolveLocale(this.lang);
    const anchor = this.#resolvedStartDate;
    const anchorDate = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day));

    if (this.view === "year") {
      return [
        {
          text: new Intl.DateTimeFormat(lang, { year: "numeric" }).format(anchorDate),
          isYear: false,
        },
      ];
    }

    if (this.view === "month") {
      return this.#dateLabelParts(
        new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }),
        new Date(Date.UTC(anchor.year, anchor.month - 1, 1)),
      );
    }

    if (this.view === "day") {
      return this.#dateLabelParts(new Intl.DateTimeFormat(lang, { dateStyle: "long" }), anchorDate);
    }

    const start = this.#weekRangeStartDate;
    const rangeLengthDays = this.daysPerWeek;
    const end = start.add({ days: rangeLengthDays - 1 });
    return this.#weekRangeLabelParts(start, end, lang);
  }

  get startDate(): Temporal.PlainDate | undefined {
    if (!this.#startDate) return undefined;
    return Temporal.PlainDate.from(this.#startDate);
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

  get nextDay(): string {
    return this.#resolvedStartDate.add({ days: 1 }).toString();
  }

  get nextWeek(): string {
    return this.#weekRangeStartDate.add({ days: this.daysPerWeek }).toString();
  }

  get nextMonth(): string {
    return Temporal.PlainDate.from({
      year: this.#resolvedStartDate.year,
      month: this.#resolvedStartDate.month,
      day: 1,
    })
      .add({ months: 1 })
      .toString();
  }

  get nextYear(): string {
    return this.#resolvedStartDate.add({ years: 1 }).toString();
  }

  goBack() {
    this.startDate = this.#targetDateByView(-1);
  }

  goForward() {
    if (this.view === "day") {
      this.startDate = this.nextDay;
      return;
    }
    if (this.view === "week") {
      this.startDate = this.nextWeek;
      return;
    }
    if (this.view === "month") {
      this.startDate = this.nextMonth;
      return;
    }
    this.startDate = this.nextYear;
  }

  goToday() {
    this.#goToToday();
  }

  #renderViewFor(view: CalendarViewMode) {
    if (this.presentation === "list") {
      return html`
        <calendar-list-view
          .startDate=${this.#agendaRangeStartDate}
          .daysPerWeek=${this.#agendaRangeDays}
          .events=${this.events}
          .lang=${this.lang}
          .timezone=${this.timezone}
          .currentTime=${this.#resolvedCurrentTime}
          @day-selection=${this.#handleDaySelectionRequested}
          @event-selected=${this.forwardComposedCalendarEvent}
        ></calendar-list-view>
      `;
    }

    if (view === "day" || view === "week") {
      // The timeline week mode week-aligns a full-week window itself (weekStart/locale);
      // partial weeks (daysPerWeek < 7) keep the raw sliding anchor — same contract the
      // grid week view had, so the raw resolved start date is passed either way.
      const startDate = this.#resolvedStartDate;
      const daysPerWeek = view === "day" ? 1 : this.daysPerWeek;
      return html`
        <calendar-timeline-view
          mode=${view}
          all-day-row
          .startDate=${startDate.toString()}
          .weekStart=${this.weekStart}
          .daysPerWeek=${daysPerWeek}
          .events=${this.events}
          .rtl=${this.rtl}
          .lang=${this.lang}
          .timezone=${this.timezone}
          .currentTime=${this.pinnedCurrentTime}
          .snapInterval=${this.snapInterval}
          .visibleHours=${this.visibleHours}
          .selectedCalendarId=${this.selectedCalendarId}
          @active-date-changed=${this.#handleWeekActiveDateChanged}
          @day-selection=${this.#handleDaySelectionRequested}
          @event-create-requested=${this.forwardComposedCalendarEvent}
          @event-created=${this.forwardComposedCalendarEvent}
          @event-selected=${this.forwardComposedCalendarEvent}
          @event-updated=${this.forwardComposedCalendarEvent}
          @event-deleted=${this.forwardComposedCalendarEvent}
        ></calendar-timeline-view>
      `;
    }

    if (view === "year") {
      return html`
        <calendar-timeline-view
          mode="year"
          .startDate=${yearAnchorDate(this.year).toString()}
          .weekStart=${this.weekStart}
          .events=${this.events}
          .rtl=${this.rtl}
          .lang=${this.lang}
          .timezone=${this.timezone}
          .currentTime=${this.#resolvedCurrentTime}
          .selectedCalendarId=${this.selectedCalendarId}
          @day-selection=${this.#handleDaySelectionRequested}
          @event-create-requested=${this.forwardComposedCalendarEvent}
          @event-created=${this.forwardComposedCalendarEvent}
          @event-selected=${this.forwardComposedCalendarEvent}
          @event-updated=${this.forwardComposedCalendarEvent}
          @event-deleted=${this.forwardComposedCalendarEvent}
        ></calendar-timeline-view>
      `;
    }

    // The timeline month intentionally renders no weekday row; the group composes the shared
    // weekday header above it (same chrome the grid month view carried internally).
    return html`
      <div class="timeline-month-layout">
        <calendar-weekday-header
          .lang=${this.lang}
          .weekStart=${this.weekStart}
          .daysPerWeek=${7}
        ></calendar-weekday-header>
        <calendar-timeline-view
          class="timeline-month-view"
          mode="month"
          .startDate=${monthAnchorDate(this.year, this.month).toString()}
          .weekStart=${this.weekStart}
          .events=${this.events}
          .rtl=${this.rtl}
          .lang=${this.lang}
          .timezone=${this.timezone}
          .currentTime=${this.#resolvedCurrentTime}
          .selectedCalendarId=${this.selectedCalendarId}
          @day-selection=${this.#handleDaySelectionRequested}
          @event-create-requested=${this.forwardComposedCalendarEvent}
          @event-created=${this.forwardComposedCalendarEvent}
          @event-selected=${this.forwardComposedCalendarEvent}
          @event-updated=${this.forwardComposedCalendarEvent}
          @event-deleted=${this.forwardComposedCalendarEvent}
        ></calendar-timeline-view>
      </div>
    `;
  }

  #handleDaySelectionRequested = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;

    const detail = event.detail as { date?: string } | undefined;
    if (!detail?.date) return;

    const selectedDate = Temporal.PlainDate.from(detail.date);
    this.startDate = selectedDate;
    this.view = "day";
  };

  #handleWeekActiveDateChanged = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as { date?: string } | undefined;
    if (!detail?.date) return;
    this.startDate = Temporal.PlainDate.from(detail.date);
  };

  #goToToday() {
    const now = this.#now;
    const today = now.toPlainDate();
    this.currentTime = now.toString();
    this.startDate = today;
  }

  #targetDateByView(step: number): Temporal.PlainDate {
    const anchorDate = this.#resolvedStartDate;
    if (this.view === "day") {
      return anchorDate.add({ days: step });
    }

    if (this.view === "year") {
      return anchorDate.add({ years: step });
    }

    if (this.view === "month") {
      return Temporal.PlainDate.from({
        year: anchorDate.year,
        month: anchorDate.month,
        day: 1,
      }).add({
        months: step,
      });
    }

    return this.#weekRangeStartDate.add({ days: this.daysPerWeek * step });
  }

  get #weekStartDate(): Temporal.PlainDate {
    return this.#startOfWeekFor(this.#resolvedStartDate, this.#resolvedWeekStart);
  }

  get #weekRangeStartDate(): Temporal.PlainDate {
    // Full-week mode stays aligned to localized week start; partial-week modes use a sliding anchor.
    if (this.daysPerWeek < 7) return this.#resolvedStartDate;
    return this.#weekStartDate;
  }

  get #agendaRangeStartDate(): Temporal.PlainDate {
    if (this.view === "day") return this.#resolvedStartDate;
    if (this.view === "week") return this.#weekRangeStartDate;
    if (this.view === "year") {
      return Temporal.PlainDate.from({ year: this.year, month: 1, day: 1 });
    }
    return Temporal.PlainDate.from({ year: this.year, month: this.month, day: 1 });
  }

  get #agendaRangeDays(): number {
    if (this.view === "day") return 1;
    if (this.view === "week") return this.daysPerWeek;
    if (this.view === "year") {
      const start = Temporal.PlainDate.from({ year: this.year, month: 1, day: 1 });
      return start.daysInYear;
    }
    const start = Temporal.PlainDate.from({ year: this.year, month: this.month, day: 1 });
    return start.daysInMonth;
  }

  get #resolvedWeekStart(): WeekdayNumber {
    return this.resolveWeekStart(this.weekStart, this.lang);
  }

  #startOfWeekFor(date: Temporal.PlainDate, weekStart: WeekdayNumber): Temporal.PlainDate {
    return startOfWeekFor(date, weekStart);
  }

  #weekRangeLabelParts(
    start: Temporal.PlainDate,
    end: Temporal.PlainDate,
    lang: string,
  ): RangeLabelPart[] {
    const startDate = new Date(Date.UTC(start.year, start.month - 1, start.day));
    const endDate = new Date(Date.UTC(end.year, end.month - 1, end.day));
    const yearText = new Intl.DateTimeFormat(lang, { year: "numeric" }).format(startDate);

    if (start.year === end.year && start.month === end.month) {
      const month = new Intl.DateTimeFormat(lang, { month: "short" }).format(startDate);
      return [
        { text: `${month} ${start.day}-${end.day}, `, isYear: false },
        { text: yearText, isYear: true },
      ];
    }

    if (start.year === end.year) {
      const startPart = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(
        startDate,
      );
      const endPart = new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }).format(
        endDate,
      );
      return [
        { text: `${startPart} - ${endPart}, `, isYear: false },
        { text: yearText, isYear: true },
      ];
    }

    const mediumDateFormatter = new Intl.DateTimeFormat(lang, { dateStyle: "medium" });
    return [
      ...this.#dateLabelParts(mediumDateFormatter, startDate),
      { text: " - ", isYear: false },
      ...this.#dateLabelParts(mediumDateFormatter, endDate),
    ];
  }

  #dateLabelParts(formatter: Intl.DateTimeFormat, date: Date): RangeLabelPart[] {
    return formatter.formatToParts(date).map((part) => ({
      text: part.value,
      isYear: part.type === "year",
    }));
  }

  #weekNumberFromStartDate(date: Temporal.PlainDate): number {
    return weekNumberForDate(date, this.#resolvedWeekStart);
  }

  get #now(): Temporal.PlainDateTime {
    if (this.timezone) {
      return Temporal.Now.zonedDateTimeISO(this.timezone).toPlainDateTime();
    }
    return Temporal.Now.plainDateTimeISO();
  }

  get #resolvedCurrentTime(): string {
    return this.currentTime ?? this.#now.toString();
  }

  get #resolvedStartDate(): Temporal.PlainDate {
    if (this.#startDate) {
      return Temporal.PlainDate.from(this.#startDate);
    }
    return Temporal.PlainDate.from(this.#resolvedCurrentTime);
  }
}
