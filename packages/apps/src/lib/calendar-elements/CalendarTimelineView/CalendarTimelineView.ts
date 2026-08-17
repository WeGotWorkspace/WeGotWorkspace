import { Temporal } from "@js-temporal/polyfill";
import { html, nothing, type TemplateResult, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { styleMap } from "lit/directives/style-map.js";
import { CalendarViewBase } from "../CalendarViewBase/CalendarViewBase.js";
import { resolvedDataEnd } from "../domain/events-api/eventMapBridge.js";
import "../EventCard/EventCard.js";
import "../CalendarTimeSidebar/CalendarTimeSidebar.js";
import "../CalendarWeekdayHeader/CalendarWeekdayHeader.js";
import "../DayOverflowPopover/DayOverflowPopover.js";
import "../SwipeContainer/SwipeContainer.js";
import type { CalendarEvent as ApiCalendarEvent } from "@/lib/calendar-engine";
import type {
  EventCreateRequestDetail,
  EventDeleteRequestDetail,
  EventSelectionRequestDetail,
  EventUpdateRequestDetail,
} from "../types/CalendarEventRequests.js";
import {
  isCalendarEventException,
  isCalendarEventRecurring,
} from "../types/calendarEventSemantics.js";
import type { DayOverflowPopoverEvent } from "../types/DayOverflowPopover.js";
import type {
  TimeLineLayout,
  TimelineEvent,
  TimelineEventCreateDetail,
  TimelineEventMoveCommitDetail,
  TimelineEventPreviewRange,
  TimelineEventResizeCommitDetail,
  TimelineGestureSignalDetail,
} from "../types/TimeLine.js";
import "../TimeLine/TimeLine.js";
import { getLocaleWeekInfo, resolveLocale } from "../utils/Locale.js";
import { formatShortTime, formatShortTimeRange } from "../utils/TimeFormatting.js";
import { weekNumberForDate } from "../utils/WeekNumber.js";
import {
  alignedMonthGridStart,
  alignedWeekStart,
  compareDaySnappedRenderOrder,
  composedTimedScrollTop,
  currentTimeMarkerTodayCell,
  currentTimeMarkersAcrossDays,
  fromTimelineRange,
  fromTimelineValue,
  isOutsideVisibleMonth,
  monthDayHeaderPartNames,
  resolveTimelineEventFilter,
  resolveVisibleHoursZoom,
  timelineRangeOverlapsCell,
  toTimelineAllDayRange,
  toTimelineRange,
  toTimelineValue,
  yearMonthStarts,
} from "./CalendarTimelineScale.js";
import componentStyle from "./CalendarTimelineView.css?inline";

const MINUTES_PER_DAY = 24 * 60;
const SECONDS_PER_DAY = MINUTES_PER_DAY * 60;

export type CalendarTimelineViewMode = "day" | "week" | "month" | "gantt" | "year";

type TimelineVariant = "timed" | "all-day";

type TimelineFlow = "vertical" | "horizontal";
type TimelineLayout = TimeLineLayout;

type ModePreset = {
  numDays: number;
  /** `"days"` resolves to the resolved day count (one continuous row for gantt). */
  columns?: number | "days";
  flow: TimelineFlow;
  layout: TimelineLayout;
  height?: "auto";
  variant: TimelineVariant;
};

/* Year mode has no preset: it composes twelve month-mode instances instead of configuring
 * a single <time-line> (see #renderYearGrid). */
const MODE_PRESETS: Record<Exclude<CalendarTimelineViewMode, "year">, ModePreset> = {
  day: { numDays: 1, flow: "vertical", layout: "stagger", variant: "timed" },
  week: { numDays: 7, flow: "vertical", layout: "stagger", variant: "timed" },
  month: {
    numDays: 42,
    columns: 7,
    flow: "horizontal",
    layout: "masonry",
    height: "auto",
    variant: "all-day",
  },
  gantt: { numDays: 7, columns: "days", flow: "horizontal", layout: "timeline", variant: "timed" },
};

type CalendarTimelineEvent = TimelineEvent & {
  key: string;
  summary: string;
  color: string;
  location: string;
  originalStart: Temporal.PlainDateTime;
  originalEnd: Temporal.PlainDateTime;
  allDay: boolean;
  past: boolean;
  recurring: boolean;
  exception: boolean;
};

/* Header/footer/event templates render inside <time-line>'s shadow root, out of reach of this
 * component's plain selectors. The rendered elements carry `part` attributes instead and all
 * their static chrome lives in CalendarTimelineView.css as `time-line::part(...)` rules
 * (including the compact month treatment, hover/focus states and the selection ring). Only
 * per-cell/per-event DYNAMIC values (event colors, anchor names) stay inline. */

@customElement("calendar-timeline-view")
export class CalendarTimelineView extends CalendarViewBase {
  /**
   * Convenience preset configuring flow/layout/day count/variant for the four calendar modes.
   * Explicitly set individual properties always win over the preset.
   */
  mode?: CalendarTimelineViewMode;
  variant?: TimelineVariant;
  /**
   * Opt-in for the composed all-day row above the timed timeline in day/week (vertical timed)
   * modes, with round-trip gestures and drag-create of whole-day events. Off by default:
   * day/week then show only timed events (the dedicated day-header row always remains).
   */
  allDayRow = false;
  /**
   * Keeps a month-mode instance in the compact (year-style) treatment regardless of measured
   * width. Year mode sets this on the twelve months it composes: relying only on the size-based
   * container query would leave gaps — the year grid's 1-column breakpoint (512px) exceeds the
   * 504px compact threshold, and 4-column cards outgrow it again on very wide screens
   * ((w − 3·gap) / 4 > 504px once the grid passes ~2208px) — so composed months force it
   * instead. The container query remains for standalone month views that shrink.
   */
  forceCompact = false;
  startDate = Temporal.Now.plainDateISO().toString();
  numDays?: number;
  daysPerWeek?: number;
  columns?: number;
  /** Week start override for the month-mode grid alignment (1 = Monday … 7 = Sunday). */
  weekStart?: number;
  timelineMax = 24 * 60;
  /**
   * Explicit snapping step in raw time-line axis units. When unset, `snapInterval`
   * (minutes, same concept as the grid views) is converted to axis units instead.
   */
  timelineStep?: number;
  /** Snap interval in minutes, mirroring the grid views' `snap-interval` attribute. */
  snapInterval?: number;
  timelineFlow?: TimelineFlow;
  timelineLayout?: TimelineLayout;
  timelineHeight?: "auto" | "";
  /**
   * Grid-parity `visibleHours`: zoom for the day/week (vertical timed) composition. The hour
   * height derives from the available viewport height divided by this count, the timed
   * timeline always renders the full 24h (taller than the viewport when `visibleHours` < 24),
   * and the remaining hours scroll into view — same behavior as the grid week view. When
   * unset, hours shrink to fit down to a 72px-per-hour floor before scrolling kicks in.
   */
  visibleHours?: number;
  /** First visible hour when `visibleHours` is active: the initial scroll offset (default 0). */
  visibleHoursStart?: number;
  rtl = false;

  /** Events passed to the timed `<time-line>` in the latest render; commit indexes point here. */
  #renderedTimedEvents: CalendarTimelineEvent[] = [];
  /** Events passed to the all-day `<time-line>` in the latest render. */
  #renderedAllDayEvents: CalendarTimelineEvent[] = [];
  #selectedEventKey: string | null = null;
  /** Set right after a gesture commit so the trailing click does not also select the event. */
  #suppressNextCardSelect = false;
  #suppressNextCardSelectTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Cell whose overflow popover is (being) opened; its popover renders the full event list. */
  #activeOverflowCellIndex: number | null = null;
  /** Cell whose compact-month day-header popover is (being) opened (month/year compact mode). */
  #activeHeaderPopoverCellIndex: number | null = null;
  /**
   * Live TimeLine gestures (`kind:gestureId` keys from `timeline-gesture-start/-end`); while
   * non-empty, swipe navigation is suppressed so drags never fight the pager (grid-week
   * `interaction-lock-change` parity).
   */
  #activeGestureLocks = new Set<string>();
  /** Active day column for the narrow-week swipe pager (grid-week `currentDayIndex` parity). */
  #currentDayIndex = 0;
  /**
   * Apply the initial timed-grid scroll on the next layout pass (once per mount / view change,
   * not on the 30s now-indicator tick). Centers “now” when today is in range; otherwise
   * `visibleHoursStart`.
   */
  #pendingInitialScroll = true;
  /** Watches the composed layout + all-day shell to derive the timed viewport height. */
  #composedResizeObserver: ResizeObserver | null = null;
  #observedComposedElements = new Set<Element>();
  /** Keeps the now-indicator line + clock badge moving while the view is connected. */
  #nowTickTimer: ReturnType<typeof setInterval> | null = null;

  static get properties() {
    return {
      ...CalendarViewBase.properties,
      mode: { type: String, reflect: true },
      variant: { type: String, reflect: true },
      allDayRow: { type: Boolean, attribute: "all-day-row", reflect: true },
      forceCompact: { type: Boolean, attribute: "force-compact", reflect: true },
      startDate: { type: String, attribute: "start-date" },
      numDays: { type: Number, attribute: "num-days" },
      daysPerWeek: { type: Number, attribute: "days-per-week" },
      columns: { type: Number, attribute: "columns" },
      weekStart: { type: Number, attribute: "week-start" },
      timelineMax: { type: Number, attribute: "timeline-max" },
      timelineStep: { type: Number, attribute: "timeline-step" },
      snapInterval: { type: Number, attribute: "snap-interval" },
      timelineFlow: { type: String, attribute: "timeline-flow" },
      timelineLayout: { type: String, attribute: "timeline-layout" },
      timelineHeight: { type: String, attribute: "timeline-height" },
      visibleHours: { type: Number, attribute: "visible-hours" },
      visibleHoursStart: { type: Number, attribute: "visible-hours-start" },
      rtl: { type: Boolean, reflect: true },
    } as const;
  }

  static get styles() {
    return [...CalendarViewBase.styles, unsafeCSS(componentStyle)];
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.#nowTickTimer == null) {
      this.#nowTickTimer = setInterval(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        this.requestUpdate();
      }, 30_000);
    }
  }

  disconnectedCallback() {
    if (this.#suppressNextCardSelectTimeout) {
      clearTimeout(this.#suppressNextCardSelectTimeout);
      this.#suppressNextCardSelectTimeout = null;
    }
    if (this.#nowTickTimer != null) {
      clearInterval(this.#nowTickTimer);
      this.#nowTickTimer = null;
    }
    this.#composedResizeObserver?.disconnect();
    this.#composedResizeObserver = null;
    this.#observedComposedElements.clear();
    // Gestures can leave transient locks active if the view unmounts mid-drag; reset so swipe
    // is re-enabled when returning to this view (grid-week parity).
    this.#activeGestureLocks.clear();
    super.disconnectedCallback();
  }

  protected willUpdate(changedProperties: Map<string | number | symbol, unknown>): void {
    super.willUpdate(changedProperties);
    if (changedProperties.has("daysPerWeek")) {
      const next = Number(this.daysPerWeek);
      if (Number.isFinite(next) && next > 0) {
        this.numDays = Math.floor(next);
      }
    }
    if (
      changedProperties.has("mode") ||
      changedProperties.has("visibleHours") ||
      changedProperties.has("visibleHoursStart")
    ) {
      this.#pendingInitialScroll = true;
    }
    // Date-window moves: re-center on now only when today is in range (e.g. goToday). Other
    // weeks keep the user’s scroll so navigation does not fight them.
    if (
      this.#composedVertical &&
      this.#nowIndicatorDayFraction != null &&
      (changedProperties.has("startDate") ||
        changedProperties.has("numDays") ||
        changedProperties.has("daysPerWeek") ||
        changedProperties.has("weekStart"))
    ) {
      this.#pendingInitialScroll = true;
    }
    // Keep the swipe pager's active column on the anchor date whenever the window moves
    // (grid-week parity: CalendarWeekView#willUpdate).
    if (
      this.#composedVertical &&
      this.#resolvedNumDays > 1 &&
      (changedProperties.has("startDate") ||
        changedProperties.has("weekStart") ||
        changedProperties.has("numDays") ||
        changedProperties.has("daysPerWeek") ||
        changedProperties.has("mode"))
    ) {
      const dayOffset = this.#gridStartDate.until(this.#parsedStartDate, {
        largestUnit: "day",
      }).days;
      const maxIndex = Math.max(0, this.#resolvedNumDays - 1);
      this.#currentDayIndex = Math.max(0, Math.min(maxIndex, Math.floor(dayOffset)));
    }
  }

  override updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
    this.#syncComposedLayout();
  }

  /**
   * Locale for direct `Intl` formatting. Hosts may pass a raw (possibly empty) `lang` — Lit's
   * generated accessor for the re-declared property shadows CalendarViewBase's resolving
   * getter, so `this.lang` is not guaranteed to be a valid language tag here.
   */
  get #locale(): string {
    return resolveLocale(this.lang);
  }

  get #modePreset(): ModePreset | undefined {
    const mode = this.mode;
    if (mode === "day" || mode === "week" || mode === "month" || mode === "gantt") {
      return MODE_PRESETS[mode];
    }
    return undefined;
  }

  get #scale() {
    return {
      startDate: this.#gridStartDate,
      numDays: this.#resolvedNumDays,
      unitsPerDay: this.#resolvedTimelineMax,
    };
  }

  get #parsedStartDate(): Temporal.PlainDate {
    try {
      return Temporal.PlainDate.from(this.startDate);
    } catch {
      return Temporal.Now.plainDateISO();
    }
  }

  /**
   * First rendered day; month mode aligns the 42-cell window to the locale week start, and
   * week mode rendering a full week aligns the same way (`CalendarWeekView#gridStartDate`
   * parity). Day mode and custom day counts keep the raw start date.
   */
  get #gridStartDate(): Temporal.PlainDate {
    if (this.mode === "month") {
      return alignedMonthGridStart(
        this.#parsedStartDate,
        this.resolveWeekStart(this.weekStart, this.lang),
      );
    }
    if (this.mode === "week" && this.#resolvedNumDays === 7) {
      return alignedWeekStart(
        this.#parsedStartDate,
        this.resolveWeekStart(this.weekStart, this.lang),
      );
    }
    return this.#parsedStartDate;
  }

  get #resolvedNumDays(): number {
    const fromNumDays = Number(this.numDays);
    if (Number.isFinite(fromNumDays) && fromNumDays > 0) return Math.floor(fromNumDays);
    const fromDaysPerWeek = Number(this.daysPerWeek);
    if (Number.isFinite(fromDaysPerWeek) && fromDaysPerWeek > 0) return Math.floor(fromDaysPerWeek);
    return this.#modePreset?.numDays ?? 7;
  }

  get #resolvedColumns(): number {
    const value = Number(this.columns);
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
    const preset = this.#modePreset?.columns;
    if (preset === "days") return this.#resolvedNumDays;
    if (typeof preset === "number") return preset;
    return this.#resolvedNumDays <= 7 ? this.#resolvedNumDays : 7;
  }

  get #resolvedTimelineMax(): number {
    const value = Number(this.timelineMax);
    if (!Number.isFinite(value) || value <= 0) return 24 * 60;
    return Math.floor(value);
  }

  /**
   * Snapping step handed to the timed `<time-line>` (axis units).
   * Precedence: an explicitly set `timelineStep` (raw axis units) always wins; otherwise
   * `snapInterval` (minutes, the grid views' concept) is converted via unitsPerDay / 1440;
   * fallback is 5 axis units.
   */
  get #resolvedTimelineStep(): number {
    const explicit = Number(this.timelineStep);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const snapMinutes = Number(this.snapInterval);
    if (Number.isFinite(snapMinutes) && snapMinutes > 0) {
      const units = (snapMinutes * this.#resolvedTimelineMax) / MINUTES_PER_DAY;
      if (units > 0) return units;
    }
    return 5;
  }

  get #resolvedVariant(): TimelineVariant {
    if (this.variant === "all-day" || this.variant === "timed") return this.variant;
    return this.#modePreset?.variant ?? "timed";
  }

  get #resolvedFlow(): TimelineFlow {
    if (this.timelineFlow === "vertical" || this.timelineFlow === "horizontal") {
      return this.timelineFlow;
    }
    return this.#modePreset?.flow ?? "vertical";
  }

  get #resolvedLayout(): TimelineLayout {
    if (
      this.timelineLayout === "default" ||
      this.timelineLayout === "timeline" ||
      this.timelineLayout === "masonry" ||
      this.timelineLayout === "stagger"
    ) {
      return this.timelineLayout;
    }
    return this.#modePreset?.layout ?? "masonry";
  }

  get #resolvedHeight(): "auto" | undefined {
    if (this.timelineHeight === "auto") return "auto";
    if (this.timelineHeight === "") return undefined;
    return this.#modePreset?.height;
  }

  /** Vertical timed modes compose the full chrome: time sidebar + all-day row + timed timeline. */
  get #composedVertical(): boolean {
    return this.#resolvedFlow === "vertical" && this.#resolvedVariant === "timed";
  }

  /** Clamped `visibleHours` zoom (hour count + first hour), or `null` when unset. */
  get #resolvedVisibleHours(): { hours: number; startHour: number } | null {
    return resolveVisibleHoursZoom(this.visibleHours, this.visibleHoursStart);
  }

  get #currentDateTime(): Temporal.PlainDateTime {
    const value = this.currentTime;
    try {
      if (value.includes("[")) {
        return Temporal.ZonedDateTime.from(value).withTimeZone(this.timezone).toPlainDateTime();
      }
      return Temporal.PlainDateTime.from(value);
    } catch {
      return Temporal.Now.plainDateTimeISO();
    }
  }

  /** Current-time markers: one value per day column at the same time-of-day so the line
   * spans the full timed grid, including weeks that do not contain today. */
  get #currentTimeMarkers(): number[] {
    const value = toTimelineValue(this.#currentDateTime, this.#scale);
    return currentTimeMarkersAcrossDays(value, this.#resolvedTimelineMax, this.#resolvedNumDays);
  }

  /** Day-column index of today when it is in the rendered range; `null` otherwise. */
  get #nowMarkerTodayCell(): number | null {
    const value = toTimelineValue(this.#currentDateTime, this.#scale);
    return currentTimeMarkerTodayCell(value, this.#resolvedTimelineMax, this.#resolvedNumDays);
  }

  /** Fraction of the day (0–1) for the now badge / scroll-to-now; `null` when today is out of range. */
  get #nowIndicatorDayFraction(): number | null {
    if (this.#nowMarkerTodayCell == null) return null;
    const now = this.#currentDateTime;
    const minutes = now.hour * 60 + now.minute + now.second / 60 + now.millisecond / 60_000;
    return minutes / MINUTES_PER_DAY;
  }

  get #renderedEntries(): [string, ApiCalendarEvent][] {
    const rangeStart = this.#gridStartDate.toPlainDateTime(Temporal.PlainTime.from("00:00"));
    const rangeEnd = rangeStart.add({ days: this.#resolvedNumDays });
    return Array.from(this.getRenderedEvents({ start: rangeStart, end: rangeEnd }).entries());
  }

  #mapTimelineEvents(
    entries: [string, ApiCalendarEvent][],
    variant: TimelineVariant,
  ): CalendarTimelineEvent[] {
    const now = this.#currentDateTime;
    return entries.map(([key, event]) => {
      const originalStart = event.data.start;
      const originalEnd = resolvedDataEnd(event.data);
      const range =
        variant === "all-day"
          ? toTimelineAllDayRange(originalStart, originalEnd, this.#scale)
          : toTimelineRange(originalStart, originalEnd, this.#scale);
      return {
        key,
        start: range.start,
        end: range.end,
        location: event.data.location ?? "",
        summary: event.data.summary,
        color: this.resolveEventDisplayColor(event),
        originalStart,
        originalEnd,
        allDay: event.data.allDay === true,
        past: Temporal.PlainDateTime.compare(originalEnd, now) <= 0,
        recurring: isCalendarEventRecurring(event),
        exception: isCalendarEventException(event),
      };
    });
  }

  #renderedEventsFor(variant: TimelineVariant): CalendarTimelineEvent[] {
    return variant === "all-day" ? this.#renderedAllDayEvents : this.#renderedTimedEvents;
  }

  #handleTimelineMoveCommit(event: Event, variant: TimelineVariant) {
    const detail = (event as CustomEvent<TimelineEventMoveCommitDetail>).detail;
    if (!detail) return;
    const timelineEvent = this.#renderedEventsFor(variant)[detail.index];
    if (!timelineEvent) return;
    const next = this.#nextRangeForMove(timelineEvent, detail, variant);
    if (!next) {
      // Nothing to commit (e.g. sub-day move in the all-day variant); re-render so the
      // timeline snaps back to the unchanged events map.
      this.requestUpdate();
      return;
    }
    this.#markGestureCommitted();
    this.#applyTimelineUpdate(timelineEvent, next);
  }

  #handleTimelineResizeCommit(event: Event, variant: TimelineVariant) {
    const detail = (event as CustomEvent<TimelineEventResizeCommitDetail>).detail;
    if (!detail) return;
    const timelineEvent = this.#renderedEventsFor(variant)[detail.index];
    if (!timelineEvent) return;
    const next = this.#nextRangeForResize(timelineEvent, detail, variant);
    if (!next) {
      this.requestUpdate();
      return;
    }
    this.#markGestureCommitted();
    this.#applyTimelineUpdate(timelineEvent, next);
  }

  /** Drag-to-create commit: numeric range → datetimes → create API (grid-view semantics). */
  #handleTimelineCreate(event: Event, variant: TimelineVariant) {
    const detail = (event as CustomEvent<TimelineEventCreateDetail>).detail;
    if (!detail) return;
    if (variant === "all-day") {
      const unitsPerDay = this.#resolvedTimelineMax;
      const startDay = Math.floor(detail.start / unitsPerDay + 1e-9);
      const endDay = Math.max(startDay + 1, Math.ceil(detail.end / unitsPerDay - 1e-9));
      const dayStart = this.#gridStartDate.add({ days: startDay });
      const dayEndExclusive = this.#gridStartDate.add({ days: endDay });
      this.#emitEventCreateRequested({
        start: dayStart.toPlainDateTime(Temporal.PlainTime.from("00:00")),
        end: dayEndExclusive.toPlainDateTime(Temporal.PlainTime.from("00:00")),
        allDay: true,
      });
      return;
    }
    const range = fromTimelineRange(detail.start, detail.end, this.#scale);
    // Timed grid / day-week body: never omit the flag — consumers treat missing as ambiguous.
    this.#emitEventCreateRequested({ start: range.start, end: range.end, allDay: false });
  }

  #emitEventCreateRequested(input: {
    start: Temporal.PlainDateTime;
    end: Temporal.PlainDateTime;
    allDay: boolean;
  }) {
    const calendarId = this.calendarIdForNewEvent();
    const detail: EventCreateRequestDetail = {
      envelope: {
        calendarId,
        accountId: this.accountIdForCalendar(calendarId),
      },
      content: {
        start: input.start,
        end: input.end,
        allDay: input.allDay,
        // Intent event listeners may set a summary via detail.content before the create applies.
        summary: "",
        color: this.resolveNewEventColor(calendarId),
      },
    };
    this.applyCreateRequestToEventsAPI(detail);
  }

  /**
   * Moves preserve the exact original duration: the committed numeric delta is applied to the
   * original datetimes (all-day: rounded to whole days) instead of re-deriving both edges from
   * axis values, so the events API classifies the change as a "move".
   */
  #nextRangeForMove(
    timelineEvent: CalendarTimelineEvent,
    detail: TimelineEventMoveCommitDetail,
    variant: TimelineVariant,
  ): { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } | null {
    const unitsPerDay = this.#resolvedTimelineMax;
    const deltaUnits = detail.start - detail.previousStart;
    if (deltaUnits === 0) return null;

    if (variant === "all-day") {
      const dayDelta = Math.round(deltaUnits / unitsPerDay);
      if (dayDelta === 0) return null;
      return {
        start: timelineEvent.originalStart.add({ days: dayDelta }),
        end: timelineEvent.originalEnd.add({ days: dayDelta }),
      };
    }

    const deltaSeconds = Math.round((deltaUnits * SECONDS_PER_DAY) / unitsPerDay);
    if (deltaSeconds === 0) return null;
    return {
      start: timelineEvent.originalStart.add({ seconds: deltaSeconds }),
      end: timelineEvent.originalEnd.add({ seconds: deltaSeconds }),
    };
  }

  /** Resizes convert only the dragged edge back through the scale; the other edge stays exact. */
  #nextRangeForResize(
    timelineEvent: CalendarTimelineEvent,
    detail: TimelineEventResizeCommitDetail,
    variant: TimelineVariant,
  ): { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime } | null {
    const allDay = variant === "all-day";
    const convertEdge = (value: number): Temporal.PlainDateTime =>
      allDay ? this.#dayRoundedDateTime(value) : fromTimelineValue(value, this.#scale);

    const next =
      detail.edge === "start"
        ? { start: convertEdge(detail.start), end: timelineEvent.originalEnd }
        : { start: timelineEvent.originalStart, end: convertEdge(detail.end) };

    if (Temporal.PlainDateTime.compare(next.end, next.start) <= 0) return null;
    if (
      Temporal.PlainDateTime.compare(next.start, timelineEvent.originalStart) === 0 &&
      Temporal.PlainDateTime.compare(next.end, timelineEvent.originalEnd) === 0
    ) {
      return null;
    }
    return next;
  }

  /** Nearest whole-day boundary for an axis value (all-day gestures commit in whole days). */
  #dayRoundedDateTime(value: number): Temporal.PlainDateTime {
    const dayIndex = Math.round(value / this.#resolvedTimelineMax);
    return this.#gridStartDate
      .add({ days: dayIndex })
      .toPlainDateTime(Temporal.PlainTime.from("00:00"));
  }

  async #applyTimelineUpdate(
    timelineEvent: CalendarTimelineEvent,
    next: { start: Temporal.PlainDateTime; end: Temporal.PlainDateTime },
  ) {
    const { event: current, recurrenceId } = this.#resolveSourceEvent(timelineEvent.key);
    const detail: EventUpdateRequestDetail = {
      envelope: {
        eventId: current?.eventId ?? timelineEvent.key,
        accountId: current?.accountId,
        calendarId: current?.calendarId,
        recurrenceId,
        isException: current ? isCalendarEventException(current) : undefined,
        isRecurring: current ? isCalendarEventRecurring(current) : undefined,
      },
      content: {
        start: next.start,
        end: next.end,
        allDay: current?.data.allDay,
        summary: timelineEvent.summary,
        color: current?.data.color,
        location: current?.data.location,
      },
    };
    const result = await this.applyUpdateRequestToEventsAPI(detail);
    if (!result.handled || !result.accepted) {
      // Rejected or unhandled: re-render from the unchanged events map so the
      // timeline snaps back to the pre-gesture range.
      this.requestUpdate();
    }
  }

  async #requestDeleteForKey(key: string) {
    const { event: current, recurrenceId } = this.#resolveSourceEvent(key);
    const detail: EventDeleteRequestDetail = {
      envelope: {
        accountId: current?.accountId,
        calendarId: current?.calendarId,
        eventId: current?.eventId ?? key,
        recurrenceId,
        isRecurring: current ? isCalendarEventRecurring(current) : undefined,
      },
    };
    await this.applyDeleteRequestToEventsAPI(detail);
    if (this.#selectedEventKey === key) {
      this.#selectedEventKey = null;
      this.requestUpdate();
    }
  }

  /** Rendered keys are `sourceKey::recurrenceId` for expanded occurrences (same as the grid views). */
  #resolveSourceEvent(renderedEventKey: string): {
    event: ApiCalendarEvent | undefined;
    recurrenceId?: string;
  } {
    const separatorIndex = renderedEventKey.indexOf("::");
    const sourceKey =
      separatorIndex === -1 ? renderedEventKey : renderedEventKey.slice(0, separatorIndex);
    const recurrenceId =
      separatorIndex === -1 ? undefined : renderedEventKey.slice(separatorIndex + 2);
    const event = this.events?.get(renderedEventKey) ?? this.events?.get(sourceKey);
    return {
      event,
      recurrenceId: recurrenceId ?? event?.recurrenceId,
    };
  }

  #markGestureCommitted() {
    this.#suppressNextCardSelect = true;
    if (this.#suppressNextCardSelectTimeout) {
      clearTimeout(this.#suppressNextCardSelectTimeout);
    }
    this.#suppressNextCardSelectTimeout = setTimeout(() => {
      this.#suppressNextCardSelect = false;
      this.#suppressNextCardSelectTimeout = null;
    }, 150);
  }

  #selectTimelineEvent(key: string) {
    if (this.#selectedEventKey !== key) {
      this.#selectedEventKey = key;
      this.requestUpdate();
    }
    this.dispatchEvent(
      new CustomEvent("event-selected", {
        detail: { key } satisfies EventSelectionRequestDetail,
      }),
    );
  }

  #handleEventCardClick(key: string, event: MouseEvent) {
    if (this.#suppressNextCardSelect) {
      this.#suppressNextCardSelect = false;
      return;
    }
    // TimeLine cancels pointerdown (for the move gesture), which suppresses native focus;
    // restore it so keyboard Delete works right after a click-selection. focusVisible: false
    // keeps the UA focus ring off for this pointer path (script focus would otherwise match
    // :focus-visible); keyboard focus still shows the ring.
    const card = event.currentTarget;
    if (card instanceof HTMLElement) {
      card.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    }
    this.#selectTimelineEvent(key);
  }

  #handleEventCardKeydown(key: string, event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      const tagName = target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.#selectTimelineEvent(key);
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.#requestDeleteForKey(key);
    }
  }

  /**
   * Card time label; while a gesture preview is active in timed presentations the numeric range
   * converts back through the timeline scale so the label tracks the drag live. Day-snapped
   * contexts keep their normal label during gestures: a day-snapped move never changes the time
   * of day on month chips, and true all-day events show no time — their changing day span is
   * already visible geometrically.
   */
  #timelineEventTimeLabel(
    variant: TimelineVariant,
    timelineEvent: CalendarTimelineEvent,
    preview?: TimelineEventPreviewRange,
  ): string {
    const daySnapped = variant === "all-day" || timelineEvent.allDay;
    if (preview && !daySnapped) {
      const range = fromTimelineRange(preview.start, preview.end, this.#scale);
      return formatShortTimeRange(this.lang, range.start, range.end);
    }
    if (timelineEvent.allDay) return "";
    return formatShortTimeRange(this.lang, timelineEvent.originalStart, timelineEvent.originalEnd);
  }

  /** Stable per-variant template references so <time-line> props keep their identity. */
  #renderTimedTimelineEvent = (event: TimelineEvent, preview?: TimelineEventPreviewRange) =>
    this.#renderTimelineEvent("timed", event, preview);

  #renderAllDayTimelineEvent = (event: TimelineEvent, preview?: TimelineEventPreviewRange) =>
    this.#renderTimelineEvent("all-day", event, preview);

  #renderTimelineEvent(
    variant: TimelineVariant,
    event: TimelineEvent,
    preview?: TimelineEventPreviewRange,
  ): TemplateResult {
    const timelineEvent = event as CalendarTimelineEvent;
    const selected = this.#selectedEventKey === timelineEvent.key;
    const timeLabel = this.#timelineEventTimeLabel(variant, timelineEvent, preview);
    // The card renders inside <time-line>'s shadow root. Selection has no persistent ring
    // (grid parity); it is exposed via aria-pressed and the event-card-selected part.
    return html`
      <event-card
        layout="flow"
        tabindex="0"
        role="button"
        part=${selected ? "event-card event-card-selected" : "event-card"}
        aria-pressed=${selected ? "true" : "false"}
        ?data-selected=${selected}
        ?past=${timelineEvent.past}
        ?recurring=${timelineEvent.recurring}
        ?exception=${timelineEvent.exception}
        .summary=${timelineEvent.summary}
        .location=${timelineEvent.location}
        .time=${timeLabel}
        .color=${timelineEvent.color}
        @click=${(clickEvent: MouseEvent) =>
          this.#handleEventCardClick(timelineEvent.key, clickEvent)}
        @keydown=${(keyEvent: KeyboardEvent) =>
          this.#handleEventCardKeydown(timelineEvent.key, keyEvent)}
      ></event-card>
    `;
  }

  #isWeekendDay(day: Temporal.PlainDate): boolean {
    const weekend: readonly number[] = getLocaleWeekInfo(this.lang).weekend;
    return weekend.includes(day.dayOfWeek);
  }

  /**
   * Grid-view-parity `day-selection` (click/Enter/Space on a day header). Buttons synthesize
   * click for Enter/Space with `event.detail === 0`, covering keyboard too.
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

  /**
   * Per-cell day header for the single-timeline paths (gantt/custom flows; the composed
   * day/week header row is calendar-weekday-header instead): an interactive button showing
   * a locale-aware weekday name + day number, emitting `day-selection` on click/Enter/Space
   * like the month header buttons (grid-view parity).
   */
  #dayHeaderTemplate = (cellIndex: number): TemplateResult => {
    const day = this.#gridStartDate.add({ days: cellIndex });
    const isToday = Temporal.PlainDate.compare(day, this.#currentDateTime.toPlainDate()) === 0;
    const isWeekend = this.#isWeekendDay(day);
    const dayDate = new Date(Date.UTC(day.year, day.month - 1, day.day));
    const weekdayLabel = new Intl.DateTimeFormat(this.#locale, { weekday: "short" }).format(
      dayDate,
    );
    const dayNumber = new Intl.NumberFormat(this.#locale).format(day.day);
    const fullDateLabel = new Intl.DateTimeFormat(this.#locale, { dateStyle: "full" }).format(
      dayDate,
    );
    // State variants travel as extra part names, mirroring the CSS the parts map to.
    const headerParts = ["day-header", "day-header-button", isWeekend ? "day-header-weekend" : ""]
      .filter(Boolean)
      .join(" ");
    return html`
      <button
        type="button"
        class="timeline-day-header"
        part=${headerParts}
        .ariaLabel=${fullDateLabel}
        .ariaCurrent=${isToday ? "date" : null}
        @click=${(clickEvent: MouseEvent) => this.#emitDaySelection(day, cellIndex, clickEvent)}
      >
        <span>${weekdayLabel}</span>
        <span part="day-number${isToday ? " day-number-today" : ""}">${dayNumber}</span>
      </button>
    `;
  };

  /** Month-mode events overlapping day cell `cellIndex` in the latest render. */
  #monthEventsForCell(cellIndex: number): CalendarTimelineEvent[] {
    return this.#renderedEventsFor(this.#resolvedVariant).filter((timelineEvent) =>
      timelineRangeOverlapsCell(timelineEvent, cellIndex, this.#resolvedTimelineMax),
    );
  }

  /**
   * Whether the month presentation is currently compact (tiny cells). The flag is a custom
   * property flipped by the `lc-timeline-month` container query in CalendarTimelineView.css and
   * inherits into <time-line>'s shadow content, so it can be read from the clicked element
   * (same computed-style pattern as the grid's `--_lc-compact-month-view`).
   */
  #isCompactMonthPresentation(element: Element): boolean {
    if (this.forceCompact) return true;
    if (typeof getComputedStyle === "undefined") return false;
    const raw = getComputedStyle(element).getPropertyValue("--_lc-timeline-compact-month");
    const state = Number.parseFloat(raw.trim());
    return Number.isFinite(state) && state >= 0.5;
  }

  /**
   * Month/year day-number click: in the compact treatment a day with events opens its events
   * popover; otherwise (empty compact day, or any regular-size day) it emits the grid views'
   * `day-selection` event so the host can e.g. navigate to that day.
   */
  #handleMonthDayHeaderClick(cellIndex: number, day: Temporal.PlainDate, event: MouseEvent) {
    const button = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (
      button &&
      this.#monthEventsForCell(cellIndex).length > 0 &&
      this.#isCompactMonthPresentation(button)
    ) {
      this.#openHeaderPopover(cellIndex, button);
      return;
    }
    this.#emitDaySelection(day, cellIndex, event);
  }

  #openHeaderPopover(cellIndex: number, button: HTMLElement) {
    if (this.#activeHeaderPopoverCellIndex !== cellIndex) {
      this.#activeHeaderPopoverCellIndex = cellIndex;
      this.requestUpdate();
    }
    // The popover renders as the button's next sibling (see #monthDayHeaderTemplate).
    const popover = button.nextElementSibling;
    if (
      popover instanceof HTMLElement &&
      typeof popover.showPopover === "function" &&
      !popover.matches(":popover-open")
    ) {
      this.#setHeaderPopoverInlineAlign(popover, button);
      popover.showPopover();
    }
  }

  /**
   * Viewport-aware inline alignment (grid parity: `#setOverflowPopoverInlineAlign` in
   * CalendarGridView). The footer's column heuristic assumes a full-width month; in the year
   * grid a month card can sit anywhere, so measure against the viewport at open time instead.
   */
  #setHeaderPopoverInlineAlign(popover: HTMLElement, button: HTMLElement) {
    const anchorRect = button.getBoundingClientRect();
    const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
    const popoverWidth = this.#measurePopoverWidth(popover);
    const viewportMarginPx = 12;
    const availableLeft = anchorCenterX - viewportMarginPx;
    const availableRight = window.innerWidth - viewportMarginPx - anchorCenterX;
    const needsHalfWidth = popoverWidth / 2;
    if (availableLeft >= needsHalfWidth && availableRight >= needsHalfWidth) {
      popover.removeAttribute("data-inline-align");
      return;
    }
    popover.setAttribute(
      "data-inline-align",
      anchorCenterX < window.innerWidth / 2 ? "start" : "end",
    );
  }

  #measurePopoverWidth(popover: HTMLElement): number {
    if (popover.matches(":popover-open")) {
      return popover.getBoundingClientRect().width;
    }
    popover.setAttribute("data-measuring", "");
    const width = popover.getBoundingClientRect().width;
    popover.removeAttribute("data-measuring");
    return width;
  }

  #handleHeaderPopoverToggle(cellIndex: number, event: Event) {
    const newState = (event as ToggleEvent).newState;
    if (newState === "open" && this.#activeHeaderPopoverCellIndex !== cellIndex) {
      this.#activeHeaderPopoverCellIndex = cellIndex;
      this.requestUpdate();
      return;
    }
    if (newState === "closed" && this.#activeHeaderPopoverCellIndex === cellIndex) {
      this.#activeHeaderPopoverCellIndex = null;
      (event.currentTarget as HTMLElement | null)?.removeAttribute("data-inline-align");
      this.requestUpdate();
    }
  }

  /** Popover payload for a day's events (shared by the overflow footer and compact header). */
  #popoverEventsFor(events: CalendarTimelineEvent[]): DayOverflowPopoverEvent[] {
    return events.map((ev) => ({
      id: ev.key,
      start: ev.allDay ? ev.originalStart.toPlainDate().toString() : ev.originalStart.toString(),
      end: ev.allDay ? ev.originalEnd.toPlainDate().toString() : ev.originalEnd.toString(),
      summary: ev.summary,
      color: ev.color,
      hidden: false,
    }));
  }

  /** Keep edge-column popovers on screen: anchor them towards the grid instead of centering. */
  #popoverInlineAlign(cellIndex: number): "start" | "end" | undefined {
    const columns = this.#resolvedColumns;
    const columnIndex = cellIndex % columns;
    const physicalColumnIndex =
      this.resolveDirection(this.rtl) === "rtl" ? columns - 1 - columnIndex : columnIndex;
    return physicalColumnIndex === 0
      ? "start"
      : physicalColumnIndex === columns - 1
        ? "end"
        : undefined;
  }

  /** Up to three unique event colors marking an event day in the compact treatment. */
  #dayDotColors(events: CalendarTimelineEvent[]): string[] {
    const colors: string[] = [];
    const seen = new Set<string>();
    for (const dayEvent of events) {
      const color = dayEvent.color || "currentColor";
      if (seen.has(color)) continue;
      seen.add(color);
      colors.push(color);
      if (colors.length === 3) break;
    }
    return colors;
  }

  /**
   * Month-mode day header: an interactive day-number button (grid-view parity: click/Enter/Space
   * emit `day-selection`; in the compact treatment event days open their events popover instead).
   * Styled via CSS shadow parts from CalendarTimelineView.css, which also carries the compact
   * treatment (behind the lc-timeline-month container query, or unconditionally under the
   * reflected force-compact attribute).
   */
  #monthDayHeaderTemplate = (cellIndex: number): TemplateResult => {
    const day = this.#gridStartDate.add({ days: cellIndex });
    const anchor = this.#parsedStartDate;
    const outsideMonth = isOutsideVisibleMonth(day, anchor);
    const isToday = Temporal.PlainDate.compare(day, this.#currentDateTime.toPlainDate()) === 0;
    const isWeekend = this.#isWeekendDay(day);
    const dayDate = new Date(Date.UTC(day.year, day.month - 1, day.day));
    // The 1st of each month labels the month boundary ("Aug 1", locale-ordered); the non-day
    // parts collapse into prefix/suffix spans (white-space: pre keeps their spacing inside the
    // inline-flex pill) so the compact treatment can hide them.
    const dayNumberContent = (() => {
      if (day.day !== 1) return html`${new Intl.NumberFormat(this.#locale).format(day.day)}`;
      const parts = new Intl.DateTimeFormat(this.#locale, {
        month: "short",
        day: "numeric",
      }).formatToParts(dayDate);
      const dayPartIndex = parts.findIndex((part) => part.type === "day");
      const before = parts
        .slice(0, dayPartIndex)
        .map((part) => part.value)
        .join("");
      const dayText = parts[dayPartIndex]?.value ?? String(day.day);
      const after = parts
        .slice(dayPartIndex + 1)
        .map((part) => part.value)
        .join("");
      return html`${before
        ? html`<span part="day-month-prefix">${before}</span>`
        : nothing}<span>${dayText}</span>${after
        ? html`<span part="day-month-prefix">${after}</span>`
        : nothing}`;
    })();
    const dayEvents = this.#monthEventsForCell(cellIndex);
    const dotColors = this.#dayDotColors(dayEvents);
    const fullDateLabel = new Intl.DateTimeFormat(this.#locale, { dateStyle: "full" }).format(
      dayDate,
    );
    const popoverId = `timeline-day-header-popover-${cellIndex}`;
    const anchorName = `--timeline-day-header-anchor-${cellIndex}`;
    const active = this.#activeHeaderPopoverCellIndex === cellIndex;
    // State variants as extra part names; weekend only inside the anchor month (parity with
    // the plain #dayHeaderTemplate and the old `.is-weekend:not(.is-outside-month)` rule).
    const headerParts = monthDayHeaderPartNames({ outsideMonth, isWeekend });
    const dayNumberParts = [
      "day-number",
      isToday ? "day-number-today" : "",
      outsideMonth ? "day-number-outside-month" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return html`
      <button
        type="button"
        class="timeline-day-header"
        part=${headerParts}
        style=${`anchor-name:${anchorName}`}
        .ariaLabel=${fullDateLabel}
        .ariaCurrent=${isToday ? "date" : null}
        @click=${(clickEvent: MouseEvent) =>
          this.#handleMonthDayHeaderClick(cellIndex, day, clickEvent)}
      >
        <span part=${dayNumberParts}>
          ${dayNumberContent}
          ${dotColors.length
            ? html`
                <span part="day-dots" aria-hidden="true">
                  ${dotColors.map(
                    (color) =>
                      html`<span part="day-dot" style=${`background-color:${color}`}></span>`,
                  )}
                </span>
              `
            : nothing}
        </span>
      </button>
      ${dayEvents.length
        ? html`
            <day-overflow-popover
              id=${popoverId}
              popover="auto"
              role="dialog"
              .ariaLabel=${`Events on ${fullDateLabel}`}
              style=${styleMap({
                "position-anchor": anchorName,
                "--_lc-all-day-day-number-space": "36px",
              })}
              .dayIso=${day.toString()}
              .dayLabel=${new Intl.NumberFormat(this.#locale).format(day.day)}
              ?is-current-day=${isToday}
              ?outside-visible-month=${outsideMonth}
              ?is-weekend=${isWeekend}
              .events=${active ? this.#popoverEventsFor(dayEvents) : []}
              @day-label-selection=${(event: Event) =>
                this.#handlePopoverDaySelection(day, cellIndex, event)}
              @toggle=${(event: Event) => this.#handleHeaderPopoverToggle(cellIndex, event)}
              @select=${this.#handleOverflowPopoverSelect}
              @delete=${this.#handleOverflowPopoverDelete}
            ></day-overflow-popover>
          `
        : nothing}
    `;
  };

  /** "+N" affordance for clipped cells (height="auto" horizontal layouts, e.g. month mode). */
  #overflowFooterTemplate = (
    cellIndex: number,
    visibleEvents: TimelineEvent[],
    allCellEvents: TimelineEvent[],
  ): TemplateResult => {
    const hiddenCount = allCellEvents.length - visibleEvents.length;
    if (hiddenCount <= 0) return html``;
    const visibleKeys = new Set(
      (visibleEvents as CalendarTimelineEvent[]).map((visibleEvent) => visibleEvent.key),
    );
    const hiddenEvents = (allCellEvents as CalendarTimelineEvent[]).filter(
      (cellEvent) => !visibleKeys.has(cellEvent.key),
    );
    const day = this.#gridStartDate.add({ days: cellIndex });
    const popoverId = `timeline-day-overflow-${cellIndex}`;
    const anchorName = `--timeline-day-overflow-anchor-${cellIndex}`;
    const active = this.#activeOverflowCellIndex === cellIndex;
    const popoverEvents: DayOverflowPopoverEvent[] = active
      ? this.#popoverEventsFor(allCellEvents as CalendarTimelineEvent[])
      : [];
    const fullDateLabel = new Intl.DateTimeFormat(this.#locale, { dateStyle: "full" }).format(
      new Date(Date.UTC(day.year, day.month - 1, day.day)),
    );
    const isMonthMode = this.mode === "month";
    const anchor = this.#parsedStartDate;
    const inlineAlign = this.#popoverInlineAlign(cellIndex);
    return html`
      <button
        type="button"
        class="day-overflow-button"
        part="overflow-button"
        style=${`anchor-name:${anchorName}`}
        aria-haspopup="dialog"
        .ariaLabel=${`Show all ${allCellEvents.length} events on ${fullDateLabel}`}
        popovertarget=${popoverId}
        popovertargetaction="toggle"
        @click=${() => this.#prepareOverflowPopover(cellIndex)}
      >
        ${this.#renderOverflowDots(hiddenEvents, hiddenCount)}
        <span>+${new Intl.NumberFormat(this.#locale).format(hiddenCount)}</span>
      </button>
      <day-overflow-popover
        id=${popoverId}
        popover="auto"
        role="dialog"
        data-inline-align=${ifDefined(inlineAlign)}
        .ariaLabel=${`Events on ${fullDateLabel}`}
        style=${styleMap({
          "position-anchor": anchorName,
          "--_lc-all-day-day-number-space": "36px",
        })}
        .dayIso=${day.toString()}
        .dayLabel=${new Intl.NumberFormat(this.#locale).format(day.day)}
        ?is-current-day=${Temporal.PlainDate.compare(day, this.#currentDateTime.toPlainDate()) ===
        0}
        ?outside-visible-month=${isMonthMode && isOutsideVisibleMonth(day, anchor)}
        ?is-weekend=${this.#isWeekendDay(day)}
        .events=${popoverEvents}
        @day-label-selection=${(event: Event) =>
          this.#handlePopoverDaySelection(day, cellIndex, event)}
        @toggle=${(event: Event) => this.#handleOverflowPopoverToggle(cellIndex, event)}
        @select=${this.#handleOverflowPopoverSelect}
        @delete=${this.#handleOverflowPopoverDelete}
      ></day-overflow-popover>
    `;
  };

  /** Grid-parity dots: one per unique hidden-event color, falling back to currentColor. */
  #renderOverflowDots(hiddenEvents: CalendarTimelineEvent[], hiddenCount: number): TemplateResult {
    const colors: string[] = [];
    const seenColors = new Set<string>();
    for (const hiddenEvent of hiddenEvents) {
      const color = hiddenEvent.color;
      if (!color || seenColors.has(color)) continue;
      seenColors.add(color);
      colors.push(color);
    }
    const shownColors = colors.slice(0, hiddenCount);
    return html`
      <span part="overflow-dots" aria-hidden="true">
        ${shownColors.length
          ? shownColors.map(
              (color) =>
                html`<span part="overflow-dot" style=${`background-color:${color}`}></span>`,
            )
          : Array.from(
              { length: hiddenCount },
              () => html`<span part="overflow-dot" style="background-color:currentColor"></span>`,
            )}
      </span>
    `;
  }

  #prepareOverflowPopover(cellIndex: number) {
    if (this.#activeOverflowCellIndex === cellIndex) return;
    this.#activeOverflowCellIndex = cellIndex;
    this.requestUpdate();
  }

  #handleOverflowPopoverToggle(cellIndex: number, event: Event) {
    const newState = (event as ToggleEvent).newState;
    if (newState === "open" && this.#activeOverflowCellIndex !== cellIndex) {
      this.#activeOverflowCellIndex = cellIndex;
      this.requestUpdate();
      return;
    }
    if (newState === "closed" && this.#activeOverflowCellIndex === cellIndex) {
      this.#activeOverflowCellIndex = null;
      this.requestUpdate();
    }
  }

  /**
   * Overflow popover day-number click/Enter/Space → grid-parity `day-selection` (same payload
   * as the in-cell day headers). Closing the popover is expected so navigation isn't buried.
   */
  #handlePopoverDaySelection(day: Temporal.PlainDate, dayIndex: number, event: Event) {
    if (!(event instanceof CustomEvent)) return;
    const detail =
      (event.detail as
        | {
            trigger?: "click" | "keyboard";
            pointerType?: string;
            sourceEvent?: Event;
          }
        | undefined) ?? {};
    this.dispatchEvent(
      new CustomEvent("day-selection", {
        bubbles: true,
        composed: true,
        detail: {
          date: day.toString(),
          dayIndex,
          trigger: detail.trigger ?? "click",
          pointerType: detail.pointerType ?? "mouse",
          sourceEvent: detail.sourceEvent ?? event,
        },
      }),
    );
    const popover = event.currentTarget;
    if (
      popover instanceof HTMLElement &&
      typeof popover.hidePopover === "function" &&
      popover.matches(":popover-open")
    ) {
      popover.hidePopover();
    }
  }

  /** DayOverflowPopover re-emits `select`/`delete` with the inner event element as detail. */
  #eventKeyFromPopoverDetail(event: Event): string | null {
    const detail = (event as CustomEvent<unknown>).detail;
    if (detail && typeof detail === "object" && "eventId" in detail) {
      const key = (detail as { eventId?: unknown }).eventId;
      if (typeof key === "string" && key) return key;
    }
    return null;
  }

  #handleOverflowPopoverSelect = (event: Event) => {
    const key = this.#eventKeyFromPopoverDetail(event);
    if (key) this.#selectTimelineEvent(key);
  };

  #handleOverflowPopoverDelete = (event: Event) => {
    const key = this.#eventKeyFromPopoverDetail(event);
    if (key) this.#requestDeleteForKey(key);
  };

  /** Overflow footer applies where TimeLine clips lanes: horizontal flow + height auto. */
  get #showOverflowFooter(): boolean {
    return (
      this.#resolvedFlow === "horizontal" &&
      this.#resolvedHeight === "auto" &&
      (this.#resolvedLayout === "timeline" ||
        this.#resolvedLayout === "masonry" ||
        this.#resolvedLayout === "stagger")
    );
  }

  /** All-day filtering for the single-timeline render paths (month, standalone all-day, gantt). */
  get #filteredEntries(): [string, ApiCalendarEvent][] {
    const entries = this.#renderedEntries;
    const filter = resolveTimelineEventFilter(this.variant, this.#resolvedVariant);
    if (filter === "all-day-only") {
      return this.#sortDaySnappedEntries(entries.filter(([, event]) => event.data.allDay === true));
    }
    if (this.#resolvedVariant === "all-day") {
      return this.#sortDaySnappedEntries(entries);
    }
    return entries;
  }

  /** Conventional stacking order inside day-snapped cells (month, all-day rows). */
  #sortDaySnappedEntries(entries: [string, ApiCalendarEvent][]): [string, ApiCalendarEvent][] {
    return entries.sort(([, a], [, b]) =>
      compareDaySnappedRenderOrder(
        {
          start: a.data.start,
          end: resolvedDataEnd(a.data),
          summary: a.data.summary,
          allDay: a.data.allDay === true,
        },
        {
          start: b.data.start,
          end: resolvedDataEnd(b.data),
          summary: b.data.summary,
          allDay: b.data.allDay === true,
        },
      ),
    );
  }

  #renderSingleTimeline(variant: TimelineVariant): TemplateResult {
    const events = this.#mapTimelineEvents(this.#filteredEntries, variant);
    if (variant === "all-day") {
      this.#renderedAllDayEvents = events;
      this.#renderedTimedEvents = [];
    } else {
      this.#renderedTimedEvents = events;
      this.#renderedAllDayEvents = [];
    }
    const unitsPerDay = this.#resolvedTimelineMax;
    const step = variant === "all-day" ? unitsPerDay : this.#resolvedTimelineStep;
    return html`
      <time-line
        class="timeline-main"
        .events=${events}
        .cells=${this.#resolvedNumDays}
        .columns=${this.#resolvedColumns}
        .max=${unitsPerDay}
        .step=${step}
        .flow=${this.#resolvedFlow}
        .layout=${this.#resolvedLayout}
        .height=${this.#resolvedHeight}
        .markers=${variant === "timed" ? this.#currentTimeMarkers : []}
        .markerTodayCell=${variant === "timed" ? (this.#nowMarkerTodayCell ?? -1) : -1}
        .eventTemplate=${variant === "all-day"
          ? this.#renderAllDayTimelineEvent
          : this.#renderTimedTimelineEvent}
        .headerTemplate=${this.mode === "month"
          ? this.#monthDayHeaderTemplate
          : this.#dayHeaderTemplate}
        .footerTemplate=${this.#showOverflowFooter ? this.#overflowFooterTemplate : undefined}
        @timeline-event-move=${(event: Event) => this.#handleTimelineMoveCommit(event, variant)}
        @timeline-event-resize=${(event: Event) => this.#handleTimelineResizeCommit(event, variant)}
        @timeline-event-create=${(event: Event) => this.#handleTimelineCreate(event, variant)}
      ></time-line>
    `;
  }

  /**
   * Day/week composition: time sidebar + timed timeline, with a dedicated day-header row
   * (weekday name + number buttons) as the first row of the sticky shell, the all-day row
   * below it when `allDayRow` is opted in (grid-week parity). The all-day row carries only
   * event lanes — its day labels live in the header row above.
   *
   * The layout wrapper (`.timeline-layout--composed`) is the scroll container: the timed
   * timeline renders the full 24h at `--_lc-timeline-hour-height` per hour (derived from the
   * viewport height and `visibleHours`, see the styleMap in `render()`), the all-day shell
   * (day-header row + all-day row) sticks to the top while the timed area scrolls, and the
   * time sidebar scrolls with the timed grid. A `.timeline-week-number` corner cell overlaps
   * the sidebar column, sticky above the shell, showing the visible week's number. A
   * swipe-container wraps the day columns for the narrow-week pager (responsive
   * visible-column count + swipe to change the active date), suspended while a TimeLine
   * gesture is live (grid-week parity).
   */
  #renderComposedVertical(direction: "ltr" | "rtl"): TemplateResult {
    const showAllDayRow = this.allDayRow === true;
    const entries = this.#renderedEntries;
    const timedEntries = entries.filter(([, event]) => event.data.allDay !== true);
    const allDayEntries = showAllDayRow
      ? this.#sortDaySnappedEntries(entries.filter(([, event]) => event.data.allDay === true))
      : [];
    const allDayEvents = this.#mapTimelineEvents(allDayEntries, "all-day");
    const timedEvents = this.#mapTimelineEvents(timedEntries, "timed");
    this.#renderedAllDayEvents = allDayEvents;
    this.#renderedTimedEvents = timedEvents;

    const numDays = this.#resolvedNumDays;
    const unitsPerDay = this.#resolvedTimelineMax;

    // Day-header row: the shared calendar-weekday-header (the same chrome the view group
    // composes above the month grid and each year card composes) in its date mode — weekday
    // name + day-number pill per column, today badge, clickable day-selection buttons. Its
    // columns are plain 1fr fractions of the shared stack width, exactly like the time-line
    // cells below, so the day columns stay aligned — including with the swipe pager's
    // responsive visible-column count, which scales that stack width.
    const dayHeaderRowTemplate = html`
      <calendar-weekday-header
        class="timeline-day-header-row"
        .lang=${this.lang}
        .daysPerWeek=${numDays}
        .startDate=${this.#gridStartDate.toString()}
        .currentDate=${this.#currentDateTime.toPlainDate().toString()}
        ?rtl=${this.rtl}
      ></calendar-weekday-header>
    `;

    const allDayRowTemplate = showAllDayRow
      ? html`
          <time-line
            class="timeline-all-day"
            .events=${allDayEvents}
            .cells=${numDays}
            .columns=${numDays}
            .max=${unitsPerDay}
            .step=${unitsPerDay}
            flow="horizontal"
            layout="masonry"
            height="auto"
            .eventTemplate=${this.#renderAllDayTimelineEvent}
            .footerTemplate=${this.#overflowFooterTemplate}
            @timeline-event-move=${(event: Event) =>
              this.#handleTimelineMoveCommit(event, "all-day")}
            @timeline-event-resize=${(event: Event) =>
              this.#handleTimelineResizeCommit(event, "all-day")}
            @timeline-event-create=${(event: Event) => this.#handleTimelineCreate(event, "all-day")}
          ></time-line>
        `
      : nothing;

    const nowFraction = this.#nowIndicatorDayFraction;
    const nowBadgeLabel =
      nowFraction == null ? undefined : formatShortTime(this.lang, this.#currentDateTime);

    return html`
      ${this.#renderWeekNumberCorner()}
      <calendar-time-sidebar
        class="timeline-sidebar"
        .lang=${this.lang}
        .hours=${24}
        .startHour=${0}
        .nowTimeLabel=${nowBadgeLabel}
        style=${styleMap(
          nowFraction == null
            ? {}
            : { "--_lc-now-badge-top": `${(nowFraction * 100).toFixed(4)}%` },
        )}
      ></calendar-time-sidebar>
      <swipe-container
        class="timeline-swipe"
        .currentIndex=${this.#currentDayIndex}
        scroll-snap-stop="normal"
        .disabled=${this.#activeGestureLocks.size > 0 || numDays === 1}
        @change=${this.#handleSwipeIndexChange}
        dir=${direction}
      >
        <div
          class="timeline-stack"
          @timeline-gesture-start=${this.#handleTimelineGestureStart}
          @timeline-gesture-end=${this.#handleTimelineGestureEnd}
        >
          <div class="timeline-all-day-shell">${dayHeaderRowTemplate}${allDayRowTemplate}</div>
          <time-line
            class="timeline-timed"
            .events=${timedEvents}
            .cells=${numDays}
            .columns=${numDays}
            .max=${unitsPerDay}
            .step=${this.#resolvedTimelineStep}
            .flow=${"vertical" as const}
            .layout=${this.#resolvedLayout}
            .gridInterval=${unitsPerDay / 24}
            .markers=${this.#currentTimeMarkers}
            .markerTodayCell=${this.#nowMarkerTodayCell ?? -1}
            .eventTemplate=${this.#renderTimedTimelineEvent}
            @timeline-event-move=${(event: Event) => this.#handleTimelineMoveCommit(event, "timed")}
            @timeline-event-resize=${(event: Event) =>
              this.#handleTimelineResizeCommit(event, "timed")}
            @timeline-event-create=${(event: Event) => this.#handleTimelineCreate(event, "timed")}
          ></time-line>
        </div>
      </swipe-container>
    `;
  }

  /**
   * Top-start corner cell where the time-sidebar column meets the day-header row: the visible
   * week's number (day mode: the week containing that day). Same computation as
   * CalendarViewGroup's toolbar `weekNumber` (shared via utils/WeekNumber). Overlaps the
   * sidebar's grid cell and sticks above the shell; all static styling (including the logical
   * start-corner placement that flips under RTL) lives in CalendarTimelineView.css.
   */
  #renderWeekNumberCorner(): TemplateResult {
    const weekNumber = weekNumberForDate(
      this.#gridStartDate,
      this.resolveWeekStart(this.weekStart, this.lang),
    );
    return html`
      <div class="timeline-week-number" .ariaLabel=${`Week ${weekNumber}`}>
        W${new Intl.NumberFormat(this.#locale).format(weekNumber)}
      </div>
    `;
  }

  /** TimeLine gesture lock (grid-week `interaction-lock-change` parity): suspends swipe. */
  #handleTimelineGestureStart = (event: Event) => {
    const detail = (event as CustomEvent<TimelineGestureSignalDetail>).detail;
    if (!detail?.kind) return;
    this.#activeGestureLocks.add(`${detail.kind}:${detail.gestureId}`);
    this.requestUpdate();
  };

  #handleTimelineGestureEnd = (event: Event) => {
    const detail = (event as CustomEvent<TimelineGestureSignalDetail>).detail;
    if (!detail?.kind) return;
    this.#activeGestureLocks.delete(`${detail.kind}:${detail.gestureId}`);
    this.requestUpdate();
  };

  /** Swipe pager committed a new day column (grid-week `active-date-changed` parity). */
  #handleSwipeIndexChange = (event: Event) => {
    if (this.#resolvedNumDays === 1) return;
    const target = event.currentTarget as { currentIndex?: number } | null;
    const nextIndex = Math.max(0, target?.currentIndex ?? 0);
    this.#currentDayIndex = nextIndex;
    const activeDate = this.#gridStartDate.add({ days: nextIndex }).toString();
    this.dispatchEvent(
      new CustomEvent("active-date-changed", {
        detail: { date: activeDate, dayIndex: nextIndex },
      }),
    );
  };

  /**
   * Observes the composed scroll layout and its all-day shell: the shell's measured height
   * feeds `--_lc-timeline-all-day-height` (the timed viewport is the remaining `100cqb`), and
   * layout size changes re-derive the hour height. Dynamic measurements only — all static
   * sizing rules live in CalendarTimelineView.css.
   */
  #syncComposedLayout() {
    if (!this.#composedVertical) {
      this.#composedResizeObserver?.disconnect();
      this.#observedComposedElements.clear();
      return;
    }
    const layout = this.renderRoot.querySelector<HTMLElement>(".timeline-layout--composed");
    const shell = this.renderRoot.querySelector<HTMLElement>(".timeline-all-day-shell");
    if (!layout || !shell) return;
    if (!this.#composedResizeObserver && typeof ResizeObserver !== "undefined") {
      this.#composedResizeObserver = new ResizeObserver(() => this.#syncComposedMetrics());
    }
    for (const element of [layout, shell]) {
      if (this.#observedComposedElements.has(element)) continue;
      this.#composedResizeObserver?.observe(element);
      this.#observedComposedElements.add(element);
    }
    this.#syncComposedMetrics();
  }

  #syncComposedMetrics() {
    const layout = this.renderRoot.querySelector<HTMLElement>(".timeline-layout--composed");
    const shell = this.renderRoot.querySelector<HTMLElement>(".timeline-all-day-shell");
    if (!layout || !shell) return;
    const shellHeightPx = shell.getBoundingClientRect().height;
    if (Number.isFinite(shellHeightPx) && shellHeightPx >= 0) {
      layout.style.setProperty("--_lc-timeline-all-day-height", `${shellHeightPx}px`);
    }
    if (this.#pendingInitialScroll) {
      requestAnimationFrame(() => this.#applyInitialScrollPosition());
    }
  }

  /**
   * One-shot scroll for the composed timed grid: center the current-time marker when today is
   * in the visible range; otherwise align to `visibleHoursStart`. Instant `scrollTop` (no
   * smooth scroll) so reduced-motion preferences are respected. Does not re-run on the now
   * tick — only when `#pendingInitialScroll` is set (mount / view / zoom / today-in-range
   * date change).
   */
  #applyInitialScrollPosition() {
    if (!this.#composedVertical || !this.#pendingInitialScroll) return;
    const layout = this.renderRoot.querySelector<HTMLElement>(".timeline-layout--composed");
    const shell = this.renderRoot.querySelector<HTMLElement>(".timeline-all-day-shell");
    const timed = this.renderRoot.querySelector<HTMLElement>("time-line.timeline-timed");
    if (!layout || !shell || !timed) return;
    // The shell strips (weekday-header row + optional all-day row) render asynchronously;
    // until they all have, the shell measurement (and with it the derived hour height) is
    // stale — keep the scroll pending, the ResizeObserver re-triggers when the shell settles.
    const shellStrips = Array.from(
      shell.querySelectorAll("time-line, calendar-weekday-header"),
    ) as {
      hasUpdated?: boolean;
    }[];
    if (shellStrips.some((strip) => strip.hasUpdated === false)) return;
    // Re-measure synchronously so the scroll target never uses a stale shell height.
    const shellHeightPx = shell.getBoundingClientRect().height;
    layout.style.setProperty("--_lc-timeline-all-day-height", `${shellHeightPx}px`);
    const timedHeightPx = timed.getBoundingClientRect().height;
    if (!(timedHeightPx > 0)) return;
    const timedGapPx =
      Number.parseFloat(getComputedStyle(layout).getPropertyValue("--_lc-timeline-timed-gap")) || 0;
    const timedViewportPx = Math.max(0, layout.clientHeight - shellHeightPx - timedGapPx);
    const maxScrollTop = Math.max(0, layout.scrollHeight - layout.clientHeight);
    layout.scrollTop = composedTimedScrollTop({
      timedHeightPx,
      timedViewportPx,
      timedGapPx,
      nowDayFraction: this.#nowIndicatorDayFraction,
      fallbackStartHour: this.#resolvedVisibleHours?.startHour ?? 0,
      maxScrollTop,
    });
    this.#pendingInitialScroll = false;
  }

  /**
   * Year mode: twelve month-mode instances (January … December of `startDate`'s year) composed
   * into the grid year view's responsive layout. Each instance brings the full month machinery
   * (42-cell window, day chips, overflow popovers) and degrades to the compact treatment on its
   * own via the container query, so this stays chrome-free: no sidebar, no all-day row, and the
   * compact cells expose no drag surface. Each card composes the shared
   * <calendar-weekday-header> above its day grid (same chrome the view group composes above
   * the regular timeline month), forced narrow so the one-letter variant shows at any card
   * width; both align on the same 7-column geometry.
   */
  #renderYearGrid(direction: "ltr" | "rtl"): TemplateResult {
    const monthFormatter = new Intl.DateTimeFormat(this.#locale, { month: "long" });
    return html`
      <div class="year-grid" dir=${direction}>
        ${yearMonthStarts(this.#parsedStartDate).map(
          (firstOfMonth) => html`
            <section class="month-card">
              <h3 class="month-title">
                ${monthFormatter.format(
                  new Date(Date.UTC(firstOfMonth.year, firstOfMonth.month - 1, 1)),
                )}
              </h3>
              <calendar-weekday-header
                narrow
                .lang=${this.lang}
                .weekStart=${this.weekStart}
                .daysPerWeek=${7}
                ?rtl=${this.rtl}
              ></calendar-weekday-header>
              <calendar-timeline-view
                mode="month"
                force-compact
                .startDate=${firstOfMonth.toString()}
                .events=${this.events}
                .lang=${this.lang}
                .timezone=${this.timezone}
                .currentTime=${this.currentTime}
                .weekStart=${this.weekStart}
                .selectedCalendarId=${this.selectedCalendarId}
                ?rtl=${this.rtl}
                @day-selection=${this.forwardCalendarEvent}
                @event-create-requested=${this.forwardCalendarEvent}
                @event-created=${this.forwardCalendarEvent}
                @event-selected=${this.forwardCalendarEvent}
                @event-updated=${this.forwardCalendarEvent}
                @event-deleted=${this.forwardCalendarEvent}
              ></calendar-timeline-view>
            </section>
          `,
        )}
      </div>
    `;
  }

  render() {
    const direction = this.resolveDirection(this.rtl);
    if (this.mode === "year") {
      return this.#renderYearGrid(direction);
    }
    if (this.#composedVertical) {
      // Hour height (grid-week parity): with visibleHours the viewport divides evenly into
      // that many hours; otherwise hours shrink to fit down to a 72px floor. The timed
      // viewport (100cqb minus the measured all-day shell) resolves in
      // CalendarTimelineView.css; only the visibleHours-dependent division is dynamic here.
      const visible = this.#resolvedVisibleHours;
      const hourHeight = visible
        ? `calc(var(--_lc-timeline-timed-viewport) / ${visible.hours})`
        : `max(var(--_lc-timeline-min-hour-height, 72px), calc(var(--_lc-timeline-timed-viewport) / 24))`;
      return html`
        <div
          class="timeline-layout timeline-layout--composed"
          dir=${direction}
          style=${styleMap({
            "--_lc-timeline-hour-height": hourHeight,
            "--_lc-timeline-days": String(this.#resolvedNumDays),
          })}
        >
          ${this.#renderComposedVertical(direction)}
        </div>
      `;
    }
    const monthClass = this.mode === "month" ? " timeline-layout--month" : "";
    return html`
      <div class="timeline-layout${monthClass}" dir=${direction}>
        ${this.#renderSingleTimeline(this.#resolvedVariant)}
      </div>
    `;
  }
}
