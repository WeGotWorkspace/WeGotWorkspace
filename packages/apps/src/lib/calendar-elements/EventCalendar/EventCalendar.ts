import { Temporal } from "@js-temporal/polyfill";
import { ContextProvider } from "@lit/context";
import { html, nothing, unsafeCSS } from "lit";
import { customElement } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement.js";
import "../Button/Button.js";
import { CalendarsSidebar } from "../CalendarsSidebar/CalendarsSidebar.js";
import "../CalendarViewGroup/CalendarViewGroup.js";
import type { CalendarViewGroup } from "../CalendarViewGroup/CalendarViewGroup.js";
import type { CalendarPresentationMode, CalendarViewMode } from "../types/CalendarViewGroup.js";
import type {
  CalendarEventPendingByCalendarId,
  CalendarEventPendingByOperation,
  CalendarEventPendingGroups,
  CalendarEventPendingOptions,
  CalendarEventPendingResult,
} from "../types/calendarEventPending.js";
import type { TabSwitchOption } from "../types/TabSwitch.js";
import type { WeekdayNumber } from "../types/Weekday.js";
import "../TabSwitch/TabSwitch.js";
import {
  type CalendarEvent as ApiCalendarEvent,
  type ApplyResult,
  type CalendarAccounts,
  type CalendarEventPendingOperation,
  type CalendarEventsMap,
  type CalendarsMap,
  type EventOperation,
  EventsAPI,
} from "@/lib/calendar-engine";
import { calendarIdsInSidebarOrder } from "../CalendarsSidebar/calendarIdsInSidebarOrder.js";
import { type EventsAPIContextValue, eventsAPIContext } from "../context/EventsAPIContext.js";
import { renderCalendarIcon } from "../icons/CalendarIcon.js";
import { renderGridIcon } from "../icons/GridIcon.js";
import { renderHamburgerIcon } from "../icons/HamburgerIcon.js";
import { renderListIcon } from "../icons/ListIcon.js";
import { getLocaleDirection, resolveLocale } from "../utils/Locale.js";
import componentStyle from "./EventCalendar.css?inline";

type EventsMap = CalendarEventsMap;

type ViewUnit = Extract<CalendarViewMode, "day" | "week" | "month" | "year">;
type PresentationUnit = CalendarPresentationMode;

const VIEW_OPTIONS_BASE: Array<{ value: ViewUnit; hotkey: string }> = [
  { value: "day", hotkey: "d" },
  { value: "week", hotkey: "w" },
  { value: "month", hotkey: "m" },
  { value: "year", hotkey: "y" },
];

const PRESENTATION_OPTIONS_BASE: Array<{ value: PresentationUnit; hotkey: string }> = [
  { value: "grid", hotkey: "g" },
  { value: "list", hotkey: "l" },
];

const VIEW_DATE_TIME_FIELDS: Record<ViewUnit, string> = {
  day: "day",
  week: "weekOfYear",
  month: "month",
  year: "year",
};

/** Matches prev/next toolbar controls: compact ghost icon buttons. */
const EVENT_CALENDAR_GHOST_ICON_BUTTON_STYLE =
  "--lc-button-bg: transparent; --lc-button-hover-bg: transparent; --lc-button-border-color: transparent; --_lc-button-border-color: transparent; --_lc-grid-line-color: transparent;";

/**
 * Outlined icon control (hamburger, Today, panel close). Border tokens only are not enough: the
 * toolbar sets transparent `--lc-button-bg` on its wrapper so menu/Today match prev/next; the close
 * control lives outside that wrapper, so we set the same transparent fill here explicitly.
 */
const EVENT_CALENDAR_MENU_BUTTON_STYLE =
  "--lc-button-bg: transparent; --lc-button-hover-bg: transparent; --_lc-grid-line-color: light-dark(rgb(15 23 42 / 14%), rgb(255 255 255 / 16%)); --lc-button-border-color: light-dark(rgb(15 23 42 / 14%), rgb(255 255 255 / 16%)); --_lc-button-border-color: light-dark(rgb(15 23 42 / 14%), rgb(255 255 255 / 16%));";

function capitalizeLabel(value: string, lang?: string): string {
  const resolvedLang = resolveLocale(lang);
  return value.replace(/^\p{L}/u, (character) => character.toLocaleUpperCase(resolvedLang));
}

function getUnitLabel(unit: ViewUnit, lang?: string): string {
  const resolvedLang = resolveLocale(lang);
  try {
    const displayNames = new Intl.DisplayNames(resolvedLang, { type: "dateTimeField" });
    const label = displayNames.of(VIEW_DATE_TIME_FIELDS[unit]) ?? unit;
    return capitalizeLabel(label, resolvedLang);
  } catch {
    return capitalizeLabel(unit, resolvedLang);
  }
}

function getViewOptions(lang?: string): TabSwitchOption[] {
  return VIEW_OPTIONS_BASE.map(({ value, hotkey }) => ({
    label: getUnitLabel(value, lang),
    value,
    hotkey,
  }));
}

function getPresentationOptions(): TabSwitchOption[] {
  return PRESENTATION_OPTIONS_BASE.map(({ value }) => ({
    label:
      value === "list"
        ? renderListIcon({ className: "event-calendar-presentation-icon" })
        : renderGridIcon({ className: "event-calendar-presentation-icon" }),
    ariaLabel: value === "list" ? "List" : "Grid",
    value,
  }));
}

function getTodayLabel(lang?: string): string {
  const resolvedLang = resolveLocale(lang);
  try {
    const relativeTimeFormat = new Intl.RelativeTimeFormat(resolvedLang, { numeric: "auto" });
    return capitalizeLabel(relativeTimeFormat.format(0, "day"), resolvedLang);
  } catch {
    return "Today";
  }
}

/** Accessible name for the calendars menu control (icon-only on screen). */
function getCalendarsMenuLabel(lang?: string): string {
  const resolvedLang = resolveLocale(lang);
  return capitalizeLabel("Calendars", resolvedLang);
}

/** Landmark name for the scrollable calendar body (keyboard scroll + screen readers). */
function getCalendarContentRegionLabel(lang?: string): string {
  const resolvedLang = resolveLocale(lang);
  return capitalizeLabel("Calendar content", resolvedLang);
}

@customElement("event-calendar")
export class EventCalendar extends BaseElement {
  #view: CalendarViewMode = "month";
  #presentation: CalendarPresentationMode = "grid";
  #startDate?: string;
  daysPerWeek = 7;
  #threeDayRangeEnabled = false;
  #rangeLabelText = "";
  #rangeLabelParts: Array<{ text: string; isYear: boolean }> = [];
  weekStart?: WeekdayNumber;
  declare events?: EventsMap;
  lang = "";
  timezone?: string;
  currentTime?: string;
  snapInterval = 15;
  visibleHours?: number;
  rtl = false;
  selectedCalendarId?: string;
  /** When set and non-empty, shows a calendar list beside the grid; on narrow containers it opens as an overlay. */
  declare calendars?: CalendarsMap;
  /**
   * Calendar ids whose events are visible in the grid (sidebar color checkboxes).
   * When unset while `calendars` is set, all calendars are visible. Use `[]` to hide all.
   */
  visibleCalendarIds?: string[];
  #calendarsOverlayOpen = false;
  /** While true, exit animation is running; avoids re-entrancy and duplicate listeners. */
  #calendarsDialogExitInProgress = false;
  #previousCalendarKeySet = new Set<string>();
  #eventsAPIProvider = new ContextProvider(this, {
    context: eventsAPIContext,
  });
  #eventsAPIContextValue: EventsAPIContextValue = {
    getEvents: () => this.events ?? new Map(),
    getCalendars: () => this.calendars ?? new Map(),
    getCalendarAccounts: (): CalendarAccounts => {
      const accounts = new Set() as CalendarAccounts;
      for (const cal of (this.calendars ?? new Map()).values()) {
        accounts.add(cal.accountId);
      }
      return accounts;
    },
    getVisibleCalendarIds: () => this.visibleCalendarIds,
    getSelectedCalendarId: () => this.#effectiveSelectedCalendarId(),
    getApi: () =>
      new EventsAPI(this.events ?? new Map(), {
        timezone: this.timezone,
        trackPending: true,
      }),
    apply: (operation) => this.#applyOperation(operation),
    create: (input) => this.#applyOperation({ type: "create", input }),
    update: (input) => this.#applyOperation({ type: "update", input }),
    move: (input) => this.#applyOperation({ type: "move", input }),
    resizeStart: (input) => this.#applyOperation({ type: "resize-start", input }),
    resizeEnd: (input) => this.#applyOperation({ type: "resize-end", input }),
    remove: (input) => this.#applyOperation({ type: "remove", input }),
    addExclusion: (input) => this.#applyOperation({ type: "add-exclusion", input }),
    removeExclusion: (input) => this.#applyOperation({ type: "remove-exclusion", input }),
    addException: (input) => this.#applyOperation({ type: "add-exception", input }),
    removeException: (input) => this.#applyOperation({ type: "remove-exception", input }),
  };

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  static get properties() {
    return {
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
      events: {
        type: Object,
      },
      lang: { type: String },
      timezone: { type: String },
      currentTime: { type: String, attribute: "current-time" },
      snapInterval: { type: Number, attribute: "snap-interval" },
      visibleHours: { type: Number, attribute: "visible-hours" },
      rtl: { type: Boolean, reflect: true },
      selectedCalendarId: {
        type: String,
        attribute: "selected-calendar-id",
        dispatchChangeEvent: { bubbles: true, composed: true },
      },
      calendars: { type: Object, attribute: false },
      visibleCalendarIds: {
        type: Array,
        attribute: false,
        dispatchChangeEvent: { bubbles: true, composed: true },
      },
    } as const;
  }

  override disconnectedCallback(): void {
    const dialog = this.#getCalendarsDialog();
    dialog?.classList.remove("event-calendar-calendars-dialog--closing");
    dialog?.close();
    super.disconnectedCallback();
  }

  get #hasCalendars(): boolean {
    const map = this.calendars;
    return map !== undefined && map.size > 0;
  }

  get #visibleEvents(): EventsMap {
    const raw = this.events ?? new Map();
    if (!this.#hasCalendars) {
      return raw;
    }
    const selected = this.visibleCalendarIds;
    if (selected === undefined) {
      return raw;
    }
    if (selected.length === 0) {
      return new Map();
    }
    const allowed = new Set(selected);
    const filtered: EventsMap = new Map();
    for (const [key, event] of raw) {
      const calendarId = event.calendarId;
      if (!calendarId || allowed.has(calendarId)) {
        filtered.set(key, event);
      }
    }
    return filtered;
  }

  #handlevisibleCalendarIdsChanged = (event: Event) => {
    const el = event.target;
    if (!(el instanceof CalendarsSidebar)) return;
    const next = el.visibleCalendarIds;
    if (!Array.isArray(next)) return;
    const prev = this.visibleCalendarIds;
    if (
      prev !== undefined &&
      prev.length === next.length &&
      prev.every((id, index) => id === next[index])
    ) {
      return;
    }
    this.visibleCalendarIds = [...next];
  };

  #handleSelectedCalendarIdChanged = (event: Event) => {
    const el = event.target;
    if (!(el instanceof CalendarsSidebar)) return;
    const next = el.selectedCalendarId;
    if (next === this.selectedCalendarId) return;
    this.selectedCalendarId = next;
  };

  #mergeSelectionWhenCalendarsMapChanges(): void {
    const map = this.calendars;
    const currentKeys = new Set(map?.keys() ?? []);
    const prev = this.#previousCalendarKeySet;
    const isInitialCalendarKeys = prev.size === 0 && currentKeys.size > 0;
    this.#previousCalendarKeySet = currentKeys;

    const selected = this.visibleCalendarIds;
    if (selected === undefined) {
      return;
    }

    let next = selected.filter((id) => currentKeys.has(id));
    if (!isInitialCalendarKeys && selected.length > 0) {
      const added = [...currentKeys].filter((id) => !prev.has(id));
      if (added.length > 0) {
        next = [...new Set([...next, ...added])];
      }
    }
    if (next.length !== selected.length || !next.every((id, index) => id === selected[index])) {
      this.visibleCalendarIds = next;
    }
  }

  #normalizedSelectedCalendarId(): string | undefined {
    const raw = this.selectedCalendarId;
    if (raw === undefined || raw === null) return undefined;
    const trimmed = String(raw).trim();
    return trimmed === "" ? undefined : trimmed;
  }

  /**
   * Resolved calendar for new events: explicit selection when valid, otherwise first visible calendar
   * in sidebar order (matches {@link #mergeSelectedCalendarIdWhenCalendarsMapChanges}).
   */
  #effectiveSelectedCalendarId(): string | undefined {
    const map = this.calendars;
    const normalized = this.#normalizedSelectedCalendarId();
    if (!map || map.size === 0) {
      return normalized;
    }
    const keys = new Set(map.keys());
    if (normalized !== undefined && keys.has(normalized)) {
      return normalized;
    }
    return this.#firstSelectedCalendarCandidate(map);
  }

  #firstSelectedCalendarCandidate(map: CalendarsMap): string | undefined {
    const ordered = calendarIdsInSidebarOrder(map);
    if (ordered.length === 0) return undefined;
    const selected = this.visibleCalendarIds;
    if (selected === undefined) {
      return ordered[0];
    }
    if (selected.length === 0) {
      return undefined;
    }
    const allow = new Set(selected);
    return ordered.find((id) => allow.has(id));
  }

  #mergeSelectedCalendarIdWhenCalendarsMapChanges(): void {
    const map = this.calendars;
    if (!map || map.size === 0) {
      return;
    }

    const next = this.#effectiveSelectedCalendarId();

    if (next !== this.selectedCalendarId) {
      this.selectedCalendarId = next;
    }
  }

  #getCalendarsDialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector("#event-calendar-calendars-dialog");
  }

  #onCalendarsDialogClose = (): void => {
    this.#calendarsDialogExitInProgress = false;
    if (!this.#calendarsOverlayOpen) return;
    this.#calendarsOverlayOpen = false;
    this.requestUpdate();
  };

  #onCalendarsDialogCancel = (event: Event): void => {
    event.preventDefault();
    this.#beginCalendarsDialogExit();
  };

  /**
   * Runs slide/fade-out, then `close()`. `<dialog>` leaves the top layer immediately on `close()`,
   * so exit motion is CSS on `[open]` + a `--closing` class until `transitionend`.
   */
  #beginCalendarsDialogExit = (): void => {
    if (!this.#calendarsOverlayOpen || this.#calendarsDialogExitInProgress) return;
    const dialog = this.#getCalendarsDialog();
    if (!dialog?.open) {
      this.#calendarsOverlayOpen = false;
      this.requestUpdate();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.classList.remove("event-calendar-calendars-dialog--closing");
      dialog.close();
      return;
    }

    const panel = dialog.querySelector(".event-calendar-calendars-panel");
    if (!(panel instanceof HTMLElement)) {
      dialog.close();
      return;
    }

    this.#calendarsDialogExitInProgress = true;

    let exitFinished = false;
    const finish = (): void => {
      if (exitFinished) return;
      exitFinished = true;
      panel.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(fallbackTimer);
      dialog.classList.remove("event-calendar-calendars-dialog--closing");
      this.#calendarsDialogExitInProgress = false;
      dialog.close();
    };

    const onTransitionEnd = (e: TransitionEvent): void => {
      if (e.target !== panel || e.propertyName !== "transform") return;
      finish();
    };

    const fallbackTimer = window.setTimeout(finish, 280);

    panel.addEventListener("transitionend", onTransitionEnd);
    dialog.classList.add("event-calendar-calendars-dialog--closing");
  };

  #closeCalendarsOverlay = (): void => {
    this.#beginCalendarsDialogExit();
  };

  #toggleCalendarsOverlay = (): void => {
    const nextOpen = !this.#calendarsOverlayOpen;
    if (!nextOpen) {
      this.#beginCalendarsDialogExit();
      return;
    }
    this.#calendarsOverlayOpen = true;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!this.#calendarsOverlayOpen) return;
      const dialog = this.#getCalendarsDialog();
      if (dialog && !dialog.open) {
        dialog.classList.remove("event-calendar-calendars-dialog--closing");
        dialog.showModal();
      }
    });
  };

  get view(): CalendarViewMode {
    return this.#view;
  }

  set view(value: CalendarViewMode | string | null | undefined) {
    if (value === "agenda") {
      this.presentation = "list";
      this.requestUpdate();
      return;
    }
    const nextValue =
      value === "day" || value === "week" || value === "month" || value === "year"
        ? value
        : "month";
    if (this.#view === nextValue) return;
    this.#view = nextValue;
    this.requestUpdate();
  }

  get presentation(): CalendarPresentationMode {
    return this.#presentation;
  }

  set presentation(value: CalendarPresentationMode | string | null | undefined) {
    const nextValue: CalendarPresentationMode = value === "list" ? "list" : "grid";
    if (this.#presentation === nextValue) return;
    this.#presentation = nextValue;
    this.requestUpdate();
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
    if (this.#startDate === nextValue) return;
    this.#startDate = nextValue;
    this.requestUpdate();
  }

  get pendingByCalendarId(): CalendarEventPendingByCalendarId {
    return this.getPendingEvents({ groupBy: "calendarId" });
  }

  getPendingEvents(options: { groupBy: "pendingOp" }): CalendarEventPendingGroups;
  getPendingEvents(options: { groupBy: "calendarId" }): CalendarEventPendingByCalendarId;
  getPendingEvents(options: CalendarEventPendingOptions = {}): CalendarEventPendingResult {
    if (options.groupBy === "calendarId") return this.#collectPendingByCalendarId();
    return this.#collectPendingByOperation();
  }

  #collectPendingByOperation(): CalendarEventPendingGroups {
    const grouped: CalendarEventPendingGroups = this.#createPendingGroupsMap();
    for (const [id, event] of this.events ?? []) {
      const pendingOp = this.#resolvePendingOperation(event);
      if (!pendingOp) continue;
      const bucket = grouped.get(pendingOp);
      if (!bucket) continue;
      bucket.set(id, event);
    }
    return grouped;
  }

  #collectPendingByCalendarId(): CalendarEventPendingByCalendarId {
    const grouped: CalendarEventPendingByCalendarId = new Map();
    for (const [id, event] of this.events ?? []) {
      const pendingOp = this.#resolvePendingOperation(event);
      if (!pendingOp) continue;
      if (!event.calendarId || !event.eventId) continue;

      const byEventId =
        grouped.get(event.calendarId) ?? new Map<string, CalendarEventPendingByOperation>();
      const byOperation = byEventId.get(event.eventId) ?? this.#createPendingOperationMap();
      const bucket = byOperation.get(pendingOp);
      if (!bucket) continue;
      bucket.set(id, event);
      byEventId.set(event.eventId, byOperation);
      grouped.set(event.calendarId, byEventId);
    }
    return grouped;
  }

  get #calendarViewGroup(): CalendarViewGroup | null {
    return this.renderRoot.querySelector("calendar-view-group");
  }

  #disableThreeDayRange() {
    if (!this.#threeDayRangeEnabled) return;
    this.#threeDayRangeEnabled = false;
    this.daysPerWeek = 7;
  }

  goBack() {
    const viewGroup = this.#calendarViewGroup;
    if (!viewGroup) return;
    viewGroup.goBack();
    this.#syncFromViewGroupElement(viewGroup);
  }

  goForward() {
    const viewGroup = this.#calendarViewGroup;
    if (!viewGroup) return;
    viewGroup.goForward();
    this.#syncFromViewGroupElement(viewGroup);
  }

  goToday() {
    const viewGroup = this.#calendarViewGroup;
    if (!viewGroup) return;
    viewGroup.goToday();
    this.#syncFromViewGroupElement(viewGroup);
  }

  render() {
    const headerDirection = this.rtl || getLocaleDirection(this.lang) === "rtl" ? "rtl" : "ltr";
    const isHeaderRtl = headerDirection === "rtl";
    const hasCalendars = this.#hasCalendars;
    return html`
      <div
        class="event-calendar-shell ${hasCalendars ? "event-calendar-has-calendars" : ""}"
        dir=${headerDirection}
      >
        ${hasCalendars
          ? html`
              <div
                id="event-calendar-calendars-mount"
                class="event-calendar-calendars event-calendar-calendars--docked"
                dir=${headerDirection}
              >
                <div class="event-calendar-calendars-panel">
                  <calendars-sidebar
                    class="event-calendar-calendars-sidebar"
                    dir=${headerDirection}
                    .calendars=${this.calendars}
                    .visibleCalendarIds=${this.visibleCalendarIds}
                    .selectedCalendarId=${this.selectedCalendarId}
                    @visibleCalendarIds-changed=${this.#handlevisibleCalendarIdsChanged}
                    @selectedCalendarId-changed=${this.#handleSelectedCalendarIdChanged}
                  ></calendars-sidebar>
                </div>
              </div>
              <dialog
                id="event-calendar-calendars-dialog"
                class="event-calendar-calendars-dialog"
                dir=${headerDirection}
                aria-label=${getCalendarsMenuLabel(this.lang)}
                @cancel=${this.#onCalendarsDialogCancel}
                @close=${this.#onCalendarsDialogClose}
              >
                <div
                  class="event-calendar-calendars-backdrop"
                  aria-hidden="true"
                  @click=${this.#closeCalendarsOverlay}
                ></div>
                <div class="event-calendar-calendars-panel">
                  <div class="event-calendar-calendars-panel-header">
                    <lc-button
                      label="Close calendars"
                      style=${EVENT_CALENDAR_MENU_BUTTON_STYLE}
                      @click=${this.#closeCalendarsOverlay}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        aria-hidden="true"
                        class="event-calendar-nav-icon"
                      >
                        <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"></path>
                      </svg>
                    </lc-button>
                  </div>
                  <calendars-sidebar
                    class="event-calendar-calendars-sidebar"
                    dir=${headerDirection}
                    .calendars=${this.calendars}
                    .visibleCalendarIds=${this.visibleCalendarIds}
                    .selectedCalendarId=${this.selectedCalendarId}
                    @visibleCalendarIds-changed=${this.#handlevisibleCalendarIdsChanged}
                    @selectedCalendarId-changed=${this.#handleSelectedCalendarIdChanged}
                  ></calendars-sidebar>
                </div>
              </dialog>
            `
          : nothing}
        <div class="event-calendar-main">
          <header class="event-calendar-header" dir=${headerDirection}>
            <div class="event-calendar-toolbar" style=${EVENT_CALENDAR_GHOST_ICON_BUTTON_STYLE}>
              ${hasCalendars
                ? html`
                    <lc-button
                      class="event-calendar-calendars-toggle"
                      .label=${getCalendarsMenuLabel(this.lang)}
                      .disclosureExpanded=${this.#calendarsOverlayOpen}
                      .hasPopup=${"dialog"}
                      style=${EVENT_CALENDAR_MENU_BUTTON_STYLE}
                      @click=${this.#toggleCalendarsOverlay}
                    >
                      ${renderHamburgerIcon({ className: "event-calendar-nav-icon" })}
                    </lc-button>
                  `
                : nothing}
              <div class="event-calendar-heading-row" dir=${headerDirection}>
                <div class="event-calendar-nav-buttons">
                  <lc-button
                    compact
                    label="Previous range"
                    hotkey="special+left"
                    @click=${() => this.goBack()}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      aria-hidden="true"
                      class="event-calendar-nav-icon"
                    >
                      <path
                        d=${isHeaderRtl ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      ></path>
                    </svg>
                  </lc-button>
                  <lc-button
                    compact
                    label="Next range"
                    hotkey="special+right"
                    @click=${() => this.goForward()}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      aria-hidden="true"
                      class="event-calendar-nav-icon"
                    >
                      <path
                        d=${isHeaderRtl ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      ></path>
                    </svg>
                  </lc-button>
                </div>
                <span class="event-calendar-divider" aria-hidden="true"></span>
                <h2 class="event-calendar-range-label" aria-live="polite" dir=${headerDirection}>
                  ${this.#rangeLabelParts.length
                    ? this.#rangeLabelParts.map((part) =>
                        part.isYear
                          ? html`<span class="event-calendar-range-year">${part.text}</span>`
                          : part.text,
                      )
                    : this.#rangeLabelText}
                </h2>
              </div>
              <lc-button
                .label=${getTodayLabel(this.lang)}
                style=${EVENT_CALENDAR_MENU_BUTTON_STYLE}
                @click=${() => this.goToday()}
              >
                ${renderCalendarIcon({ className: "event-calendar-nav-icon" })}
                <span class="event-calendar-today-label">${getTodayLabel(this.lang)}</span>
              </lc-button>
            </div>
            <div class="event-calendar-controls-row">
              <tab-switch
                class="event-calendar-switch"
                .showHotkeys=${false}
                .options=${getViewOptions(this.lang)}
                .value=${this.view}
                name="event-calendar-grid-view-tabs"
                group-label="Calendar view"
                @value-changed=${this.#handleViewTabChanged}
              ></tab-switch>
              <span
                class="event-calendar-divider event-calendar-divider--controls"
                aria-hidden="true"
              ></span>
              <tab-switch
                class="event-calendar-switch"
                compact
                .showHotkeys=${false}
                .options=${getPresentationOptions()}
                .value=${this.presentation}
                name="event-calendar-presentation-tabs"
                group-label="Calendar layout"
                @value-changed=${this.#handlePresentationChanged}
              ></tab-switch>
            </div>
          </header>
          <calendar-view-group
            class="event-calendar-content"
            role="region"
            tabindex="0"
            aria-label=${getCalendarContentRegionLabel(this.lang)}
            .view=${this.view}
            .presentation=${this.presentation}
            .startDate=${this.#startDate}
            .weekStart=${this.weekStart}
            .daysPerWeek=${this.daysPerWeek}
            .events=${this.#visibleEvents}
            .lang=${this.lang}
            .timezone=${this.timezone}
            .currentTime=${this.currentTime}
            .snapInterval=${this.snapInterval}
            .visibleHours=${this.visibleHours}
            .rtl=${isHeaderRtl}
            @view-changed=${this.#syncFromViewGroup}
            @start-date-changed=${this.#syncFromViewGroup}
            @day-selection=${this.#syncFromViewGroup}
            @event-create-requested=${this.#reemit}
            @event-created=${this.#reemit}
            @event-selected=${this.#reemit}
            @event-updated=${this.#reemit}
            @event-deleted=${this.#reemit}
          ></calendar-view-group>
        </div>
      </div>
    `;
  }

  #handleViewTabChanged = (event: Event) => {
    const target = event.currentTarget as { value?: string } | null;
    const nextView = target?.value as CalendarViewMode | undefined;
    if (!nextView || nextView === this.view) return;

    this.#disableThreeDayRange();
    this.view = nextView;
    const viewGroup = this.#calendarViewGroup;
    if (!viewGroup) return;
    viewGroup.view = nextView;
    viewGroup.daysPerWeek = this.daysPerWeek;
    this.#syncFromViewGroupElement(viewGroup);
  };

  #handlePresentationChanged = (event: Event) => {
    const target = event.currentTarget as { value?: string } | null;
    const nextPresentation = target?.value as CalendarPresentationMode | undefined;
    if (!nextPresentation || nextPresentation === this.presentation) return;
    this.presentation = nextPresentation;
    const viewGroup = this.#calendarViewGroup;
    if (!viewGroup) return;
    viewGroup.presentation = nextPresentation;
    this.#syncFromViewGroupElement(viewGroup);
  };

  #syncFromViewGroup = (event: Event) => {
    const target = event.target as CalendarViewGroup | null;
    if (!target) return;
    this.#syncFromViewGroupElement(target);
  };

  #syncFromViewGroupElement(target: CalendarViewGroup) {
    this.view = target.view;
    this.presentation = target.presentation;
    this.startDate = target.startDate;
    this.currentTime = target.currentTime;
    this.daysPerWeek = target.daysPerWeek;
    this.#threeDayRangeEnabled = this.view === "week" && this.daysPerWeek === 3;
    this.#rangeLabelText = target.rangeLabel;
    this.#rangeLabelParts = target.rangeLabelParts;
  }

  #applyOperation(operation: EventOperation): ApplyResult {
    const api = new EventsAPI(this.events ?? new Map(), {
      timezone: this.timezone,
      trackPending: true,
    });
    const result = api.apply(operation);
    this.events = result.nextState;
    return result;
  }

  #resolvePendingOperation(event: ApiCalendarEvent): CalendarEventPendingOperation | undefined {
    if (
      event.pendingOp === "created" ||
      event.pendingOp === "updated" ||
      event.pendingOp === "deleted"
    ) {
      return event.pendingOp;
    }
    return undefined;
  }

  #createPendingGroupsMap(): CalendarEventPendingGroups {
    return new Map([
      ["created", new Map()],
      ["updated", new Map()],
      ["deleted", new Map()],
    ]);
  }

  #createPendingOperationMap(): CalendarEventPendingByOperation {
    return new Map([
      ["created", new Map()],
      ["updated", new Map()],
      ["deleted", new Map()],
    ]);
  }

  #reemit = (event: Event) => {
    event.stopPropagation();
    const forwardedEvent = new CustomEvent(event.type, {
      detail: (event as CustomEvent).detail,
      bubbles: true,
      composed: true,
      cancelable: event.cancelable,
    });
    const notCancelled = this.dispatchEvent(forwardedEvent);
    if (!notCancelled && event.cancelable) {
      event.preventDefault();
    }
  };

  override updated(changedProperties: Map<PropertyKey, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has("calendars")) {
      this.#mergeSelectionWhenCalendarsMapChanges();
    }
    if (changedProperties.has("calendars") || changedProperties.has("visibleCalendarIds")) {
      this.#mergeSelectedCalendarIdWhenCalendarsMapChanges();
    }
    this.#eventsAPIProvider.setValue(this.#eventsAPIContextValue, true);
    const viewGroup = this.#calendarViewGroup;
    if (!viewGroup) return;
    const nextRangeLabel = viewGroup.rangeLabel;
    if (nextRangeLabel !== this.#rangeLabelText) {
      this.#rangeLabelText = nextRangeLabel;
      this.#rangeLabelParts = viewGroup.rangeLabelParts;
      this.requestUpdate();
    }
  }
}
