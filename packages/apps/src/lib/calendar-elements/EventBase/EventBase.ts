import { Temporal } from "@js-temporal/polyfill";
import { ContextConsumer } from "@lit/context";
import type { PropertyValues } from "lit";
import { unsafeCSS } from "lit";
import { property } from "lit/decorators.js";
import { BaseElement } from "../BaseElement/BaseElement";
import { type CalendarViewContextValue, calendarViewContext } from "../context/CalendarViewContext";
import { TimedEventInteractionController } from "../controllers/TimedEventInteractionController";
import { resolveLocale } from "../utils/Locale";
import componentStyle from "./EventBase.css?inline";

export abstract class EventBase extends BaseElement {
  #start?: string;
  #end?: string;
  #currentTime?: string;
  #timezone?: string;
  #lang?: string;
  #justDroppedTimeout: ReturnType<typeof setTimeout> | null = null;
  #calendarView?: CalendarViewContextValue;
  #calendarViewConsumer = new ContextConsumer(this, {
    context: calendarViewContext,
    subscribe: true,
    callback: (value: CalendarViewContextValue | undefined) => {
      this.#calendarView = value;
      this.requestUpdate();
    },
  });

  protected interactionController: TimedEventInteractionController;
  protected dragOffsetX = 0;
  protected dragOffsetY = 0;

  /** Dates visible in the parent calendar strip (e.g. overflow popover day). */
  @property({ type: Array })
  viewDays: Temporal.PlainDate[] = [];

  @property({ type: String })
  summary = "";

  @property({ type: String })
  color = "";

  @property({ type: String, attribute: "event-id" })
  eventId = "";

  @property({ type: Boolean, attribute: "is-recurring" })
  isRecurring = false;

  @property({ type: Boolean, attribute: "is-exception" })
  isException = false;

  static get properties() {
    return {
      start: { type: String },
      end: { type: String },
      lang: { type: String },
      timezone: { type: String },
      currentTime: { type: String, attribute: "current-time" },
      eventId: { type: String, attribute: "event-id" },
      isRecurring: { type: Boolean, attribute: "is-recurring" },
      isException: { type: Boolean, attribute: "is-exception" },
    } as const;
  }

  static get styles() {
    return [...BaseElement.styles, unsafeCSS(componentStyle)];
  }

  constructor(options?: ConstructorParameters<typeof TimedEventInteractionController>[1]) {
    super();
    this.interactionController = new TimedEventInteractionController(this, options);
  }

  connectedCallback() {
    super.connectedCallback();
    void this.#calendarViewConsumer;
    this.addEventListener("click", this.#handleSelectClick as EventListener);
    this.addEventListener("keydown", this.#handleSelectKeydown as EventListener);
    this.addEventListener(
      "interaction-drag-state",
      this.#handleInteractionDragState as EventListener,
    );
    this.addEventListener(
      "interaction-drag-offset",
      this.#handleInteractionDragOffset as EventListener,
    );
    this.addEventListener(
      "interaction-touch-active",
      this.#handleInteractionTouchActive as EventListener,
    );
  }

  disconnectedCallback() {
    if (this.#justDroppedTimeout) clearTimeout(this.#justDroppedTimeout);
    this.removeEventListener("click", this.#handleSelectClick as EventListener);
    this.removeEventListener("keydown", this.#handleSelectKeydown as EventListener);
    this.removeEventListener(
      "interaction-drag-state",
      this.#handleInteractionDragState as EventListener,
    );
    this.removeEventListener(
      "interaction-drag-offset",
      this.#handleInteractionDragOffset as EventListener,
    );
    this.removeEventListener(
      "interaction-touch-active",
      this.#handleInteractionTouchActive as EventListener,
    );
    super.disconnectedCallback();
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
  }

  get start(): Temporal.PlainDateTime | null {
    return this.#toPlainDateTimeOrNull(this.#start);
  }

  set start(start: Temporal.PlainDateTime | Temporal.ZonedDateTime | string | null) {
    const oldValue = this.#start;
    this.#start = start?.toString() ?? undefined;
    this.requestUpdate("start", oldValue);
  }

  get end(): Temporal.PlainDateTime | null {
    return this.#toPlainDateTimeOrNull(this.#end);
  }

  set end(end: Temporal.PlainDateTime | Temporal.ZonedDateTime | string | null) {
    const oldValue = this.#end;
    this.#end = end?.toString() ?? undefined;
    this.requestUpdate("end", oldValue);
  }

  setStartFromPlainDateTime(value: Temporal.PlainDateTime) {
    this.start = this.#serializeUpdatedDateTime(value, this.#start);
  }

  setEndFromPlainDateTime(value: Temporal.PlainDateTime) {
    this.end = this.#serializeUpdatedDateTime(value, this.#end);
  }

  get currentTime(): Temporal.PlainDateTime {
    if (this.#currentTime) return this.#toPlainDateTime(this.#currentTime);
    const contextCurrentTime = this.#calendarView?.currentTime;
    if (contextCurrentTime) return this.#toPlainDateTime(contextCurrentTime);
    return Temporal.Now.zonedDateTimeISO(this.timezone).toPlainDateTime();
  }

  set currentTime(
    currentTime: Temporal.PlainDateTime | Temporal.ZonedDateTime | string | null | undefined,
  ) {
    this.#currentTime = currentTime?.toString() ?? undefined;
  }

  get timezone(): string {
    return this.#timezone ?? this.#calendarView?.timezone ?? Temporal.Now.timeZoneId();
  }

  set timezone(timezone: string | null | undefined) {
    this.#timezone = timezone ?? undefined;
  }

  get lang(): string {
    return resolveLocale(this.#lang ?? this.#calendarView?.lang);
  }

  set lang(lang: string | null | undefined) {
    this.#lang = lang ?? undefined;
  }

  get startDate(): Temporal.PlainDate | null {
    const start = this.start;
    return start ? start.toPlainDate() : null;
  }

  // NOTE: AllDayEvent overrides this to apply exclusive-end semantics.
  get endDate(): Temporal.PlainDate | null {
    const end = this.end;
    return end ? end.toPlainDate() : null;
  }

  get startTime(): Temporal.PlainTime | null {
    const start = this.start;
    return start ? start.toPlainTime() : null;
  }

  get endTime(): Temporal.PlainTime | null {
    const end = this.end;
    return end ? end.toPlainTime() : null;
  }

  get isPast(): boolean {
    const end = this.end;
    return end ? Temporal.PlainDateTime.compare(end, this.currentTime) <= 0 : false;
  }

  /** This event’s span on the calendar: one plain date per day from start through end (inclusive). */
  get renderedDays(): Temporal.PlainDate[] {
    const span: Temporal.PlainDate[] = [];
    const startDate = this.startDate;
    const endDate = this.endDate;
    if (!startDate || !endDate) return span;

    let current: Temporal.PlainDate = startDate;
    while (Temporal.PlainDate.compare(current, endDate) <= 0) {
      span.push(current);
      current = current.add({ days: 1 });
    }
    return span;
  }

  protected get startInputValue(): string | null {
    return this.#start ?? null;
  }

  protected get endInputValue(): string | null {
    return this.#end ?? null;
  }

  protected get startHasTimeComponent(): boolean {
    return this.#hasTimeComponent(this.#start);
  }

  protected get endHasTimeComponent(): boolean {
    return this.#hasTimeComponent(this.#end);
  }

  protected get originalStartZonedDateTime(): Temporal.ZonedDateTime | null {
    if (!this.#start || !this.#isTimezonedString(this.#start)) return null;
    return Temporal.ZonedDateTime.from(this.#start);
  }

  protected get originalEndZonedDateTime(): Temporal.ZonedDateTime | null {
    if (!this.#end || !this.#isTimezonedString(this.#end)) return null;
    return Temporal.ZonedDateTime.from(this.#end);
  }

  protected get renderedDayBounds(): {
    firstDay: Temporal.PlainDate;
    lastDay: Temporal.PlainDate;
  } | null {
    if (!this.viewDays.length) return null;

    let firstDay = this.viewDays[0];
    let lastDay = this.viewDays[0];
    for (const day of this.viewDays) {
      if (Temporal.PlainDate.compare(day, firstDay) < 0) firstDay = day;
      if (Temporal.PlainDate.compare(day, lastDay) > 0) lastDay = day;
    }

    return { firstDay, lastDay };
  }

  get siblings(): EventBase[] {
    return [...(this.parentElement?.querySelectorAll(this.localName) ?? [])] as EventBase[];
  }

  protected onDragStart() {
    // Hook for subclasses.
  }

  protected onDragEnd() {
    // Hook for subclasses.
  }

  #handleInteractionDragState = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const isDragging = Boolean(event.detail?.isDragging);
    const pointerType =
      typeof event.detail?.pointerType === "string"
        ? (event.detail.pointerType as string)
        : undefined;
    if (isDragging) {
      this.setAttribute("data-dragging", "");
      if (pointerType === "touch") {
        this.setAttribute("data-dragging-touch", "");
      } else {
        this.removeAttribute("data-dragging-touch");
      }
      this.onDragStart();
    } else {
      if (this.#justDroppedTimeout) clearTimeout(this.#justDroppedTimeout);
      this.setAttribute("data-just-dropped", "");
      this.#justDroppedTimeout = setTimeout(() => {
        this.removeAttribute("data-just-dropped");
        this.#justDroppedTimeout = null;
      }, 150);
      this.removeAttribute("data-dragging");
      this.removeAttribute("data-dragging-touch");
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      this.onDragEnd();
    }
    this.requestUpdate();
  };

  #handleInteractionDragOffset = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const { offsetX, offsetY } = event.detail || {};
    this.dragOffsetX = offsetX ?? 0;
    this.dragOffsetY = offsetY ?? 0;
    this.requestUpdate();
  };

  #handleInteractionTouchActive = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const active = Boolean(event.detail?.active);
    if (active) {
      this.setAttribute("data-touch-interacting", "");
    } else {
      this.removeAttribute("data-touch-interacting");
    }
    this.requestUpdate();
  };

  #handleSelectClick = (event: Event) => {
    if (!(event instanceof MouseEvent)) return;
    if (this.hasAttribute("data-suppress-next-select-click")) {
      this.removeAttribute("data-suppress-next-select-click");
      return;
    }
    if (this.interactionController.isDragging || this.hasAttribute("data-just-dropped")) return;
    const path = event.composedPath();
    if (
      path.some((target) => target instanceof HTMLElement && target.tagName === "RESIZE-HANDLE")
    ) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("select", {
        detail: {
          trigger: event.detail === 0 ? "keyboard" : "click",
          pointerType: event.detail === 0 ? "keyboard" : "mouse",
          sourceEvent: event,
        },
        bubbles: true,
        composed: true,
      }),
    );
  };

  #handleSelectKeydown = (event: Event) => {
    if (!(event instanceof KeyboardEvent)) return;
    if (event.defaultPrevented) return;
    if (this.interactionController.isDragging || this.hasAttribute("data-just-dropped")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as EventTarget | null;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      const tagName = target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
    }
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent("select", {
        detail: {
          trigger: "keyboard",
          pointerType: "keyboard",
          sourceEvent: event,
        },
        bubbles: true,
        composed: true,
      }),
    );
  };

  #toPlainDateTimeOrNull(value: string | undefined): Temporal.PlainDateTime | null {
    if (!value) return null;
    return this.#toPlainDateTime(value);
  }

  #toPlainDateTime(value: string): Temporal.PlainDateTime {
    if (this.#isTimezonedString(value)) {
      return Temporal.ZonedDateTime.from(value).withTimeZone(this.timezone).toPlainDateTime();
    }
    if (!value.includes("T")) {
      return Temporal.PlainDate.from(value).toPlainDateTime({
        hour: 0,
        minute: 0,
        second: 0,
      });
    }
    return Temporal.PlainDateTime.from(value);
  }

  #isTimezonedString(value: string): boolean {
    return value.includes("[") && value.includes("]");
  }

  #hasTimeComponent(value: string | undefined): boolean {
    if (!value) return false;
    return value.includes("T");
  }

  #serializeUpdatedDateTime(
    value: Temporal.PlainDateTime,
    originalValue: string | undefined,
  ): string {
    if (originalValue && !this.#hasTimeComponent(originalValue)) {
      return value.toPlainDate().toString();
    }

    if (!originalValue || !this.#isTimezonedString(originalValue)) {
      return value.toString();
    }

    const originalTimeZone = Temporal.ZonedDateTime.from(originalValue).timeZoneId;
    const displayZonedDateTime = value.toZonedDateTime(this.timezone);
    return displayZonedDateTime.withTimeZone(originalTimeZone).toString();
  }
}
