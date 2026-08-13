import { Temporal } from "@js-temporal/polyfill";

const SECONDS_IN_DAY = 24 * 60 * 60;
const MAX_FRACTION = 0.999999;
const MOVE_DRAG_ACTIVATION_DISTANCE_PX = 4;
const TOUCH_INTERACTION_ACTIVATION_DELAY_MS = 160;
const TOUCH_INTERACTION_CANCEL_DISTANCE_PX = 10;
const INLINE_START_ANCHOR_INSET_PX = 1;

type TimedEventHost = HTMLElement & {
  start: Temporal.PlainDateTime | string | null;
  end: Temporal.PlainDateTime | string | null;
  setStartFromPlainDateTime?: (value: Temporal.PlainDateTime) => void;
  setEndFromPlainDateTime?: (value: Temporal.PlainDateTime) => void;
  viewDays?: unknown;
  daysPerRow?: number;
  gridRows?: number;
  getInteractionStackOffsetY?: () => number;
};

type InteractionOperation = "move" | "resize-start" | "resize-end";
type InteractionMode = "timed" | "all-day";

type TimedEventInteractionControllerOptions = {
  mode?: InteractionMode;
};

export class TimedEventInteractionController {
  #host: TimedEventHost;
  #isDragging = false;
  #operation: InteractionOperation = "move";
  #activePointerId?: number;
  #activePointerType?: string;
  #pointerCaptureTarget?: HTMLElement;
  #bounds: DOMRect | null = null;
  #savedY = 0;
  #savedHeight = 0;
  #savedDayIndex = 0;
  #savedStart: Temporal.PlainDateTime | null = null;
  #savedEnd: Temporal.PlainDateTime | null = null;
  #savedClientX = 0;
  #savedClientY = 0;
  #grabOffsetX = 0;
  #grabOffsetY = 0;
  #mode: InteractionMode = "timed";
  #dragOffsetX = 0;
  #dragOffsetY = 0;
  #dragGhostMaxHeightPx: number | null = null;
  #highlightedDayIndex: number | null = null;
  #highlightedTime: Temporal.PlainTime | null = null;
  #pendingTouchInteraction: {
    pointerId: number;
    operation: InteractionOperation;
    event: PointerEvent;
    startClientX: number;
    startClientY: number;
    activationTimeoutId: number;
  } | null = null;
  #clearSuppressClickTimerId: number | null = null;
  static snapInterval: number = 5;
  static renderedDayCount: number = 7;

  constructor(host: TimedEventHost, options: TimedEventInteractionControllerOptions = {}) {
    this.#host = host;
    this.#mode = options.mode ?? "timed";
  }

  get isDragging(): boolean {
    return this.#isDragging;
  }

  readonly pointerDownHandler = (e: PointerEvent) => {
    if (this.#activePointerId !== undefined || this.#pendingTouchInteraction) return;

    const operation = this.#deriveOperation(e);
    if (!operation) return;

    if (e.pointerType === "touch") {
      this.#beginPendingTouchInteraction(e, operation);
      return;
    }

    this.#beginInteraction(e, operation);
  };

  readonly pointerMoveHandler = (e: PointerEvent) => {
    if (!this.#isActivePointerEvent(e) || !this.#bounds || !this.#savedStart || !this.#savedEnd) {
      return;
    }

    if (this.#activePointerType === "touch" && e.cancelable) {
      // After long-press activation, block native scrolling while dragging/resizing.
      e.preventDefault();
    }

    if (this.#operation !== "move") {
      this.#handleResizePointerMove(e);
      return;
    }

    this.#handleMovePointerMove(e);
  };

  readonly #activeTouchMoveBlocker = (e: TouchEvent) => {
    if (this.#activePointerType !== "touch") return;
    if (e.cancelable) {
      e.preventDefault();
    }
  };

  readonly pointerUpHandler = (e: PointerEvent) => {
    if (this.#pendingTouchInteraction?.pointerId === e.pointerId) {
      const pendingOperation = this.#pendingTouchInteraction.operation;
      this.#cancelPendingTouchInteraction();
      if (pendingOperation === "move") {
        if (e.cancelable) e.preventDefault();
        this.#markSuppressNextClick();
        this.#dispatchSelect("click", "touch", e);
      }
      return;
    }

    if (this.#activePointerId === undefined || e.pointerId !== this.#activePointerId) {
      return;
    }

    window.removeEventListener("pointermove", this.pointerMoveHandler, true);

    if (
      this.#operation === "move" &&
      this.#isDragging &&
      this.#bounds &&
      this.#savedStart &&
      this.#savedEnd
    ) {
      this.#finalizeMove();
      return;
    }

    this.#finalizeNonMove();
  };

  readonly pointerCancelHandler = (e: PointerEvent) => {
    if (this.#pendingTouchInteraction?.pointerId === e.pointerId) {
      this.#cancelPendingTouchInteraction();
      return;
    }

    if (this.#activePointerId === undefined || e.pointerId !== this.#activePointerId) {
      return;
    }

    this.#finalizeNonMove();
  };

  readonly keydownHandler = (e: KeyboardEvent) => {
    if (this.#isSelectKey(e)) {
      if (this.#shouldIgnoreSelectShortcut(e)) return;
      e.preventDefault();
      this.#dispatchSelect("keyboard", "keyboard", e);
      return;
    }

    if (this.#isDeleteKey(e)) {
      if (this.#shouldIgnoreDeleteShortcut(e)) return;
      e.preventDefault();
      this.#host.dispatchEvent(
        new CustomEvent("delete", {
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }

    if (e.shiftKey === true && e.ctrlKey === true) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.#adjustEndBySingleStep(-1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.#adjustEndBySingleStep(1);
        return;
      }
    }

    if (e.ctrlKey === true && e.metaKey === true) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.#moveBySingleStep(-1);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.#moveBySingleStep(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.#moveByHours(this.#getHorizontalDayStepHours(-24));
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        this.#moveByHours(this.#getHorizontalDayStepHours(24));
      }
    }
  };

  #getHorizontalDayStepHours(baseHours: number): number {
    if (!this.#isRtlLayout()) return baseHours;
    return -baseHours;
  }

  #isDeleteKey(e: KeyboardEvent): boolean {
    return e.key === "Delete" || e.key === "Backspace";
  }

  #isSelectKey(e: KeyboardEvent): boolean {
    return e.key === "Enter" || e.key === " ";
  }

  #shouldIgnoreSelectShortcut(e: KeyboardEvent): boolean {
    if (this.#isDragging) return true;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
    const target = e.target as EventTarget | null;
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tagName = target.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
  }

  #shouldIgnoreDeleteShortcut(e: KeyboardEvent): boolean {
    if (this.#isDragging) return true;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return true;
    const target = e.target as EventTarget | null;
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tagName = target.tagName;
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
  }

  #moveBySingleStep(direction: -1 | 1) {
    const start = this.#toPlainDateTimeOrNull(this.#host.start);
    const end = this.#toPlainDateTimeOrNull(this.#host.end);
    if (!start || !end) return;

    if (this.#mode === "all-day") {
      const delta = Temporal.Duration.from({ days: direction });
      this.#setHostStart(start.add(delta));
      this.#setHostEnd(end.add(delta));
      this.#dispatchUpdate("keyboard");
      return;
    }

    const ctor = this.constructor as typeof TimedEventInteractionController;
    const minutes = ctor.snapInterval * direction;
    const delta = Temporal.Duration.from({ minutes });
    this.#setHostStart(start.add(delta));
    this.#setHostEnd(end.add(delta));
    this.#dispatchUpdate("keyboard");
  }

  #moveByHours(hours: number) {
    const start = this.#toPlainDateTimeOrNull(this.#host.start);
    const end = this.#toPlainDateTimeOrNull(this.#host.end);
    if (!start || !end) return;

    const delta = Temporal.Duration.from({ hours });
    this.#setHostStart(start.add(delta));
    this.#setHostEnd(end.add(delta));
    this.#dispatchUpdate("keyboard");
  }

  #adjustEndBySingleStep(direction: -1 | 1) {
    const start = this.#toPlainDateTimeOrNull(this.#host.start);
    const end = this.#toPlainDateTimeOrNull(this.#host.end);
    if (!start || !end) return;

    let nextEnd: Temporal.PlainDateTime;
    let minEnd: Temporal.PlainDateTime;

    if (this.#mode === "all-day") {
      // All-day events use exclusive-end semantics: min 1-day span means end = startDate + 1 day at 00:00.
      const startDate = start.toPlainDate();
      const endDate = end.toPlainDate();
      nextEnd = endDate
        .add(Temporal.Duration.from({ days: direction }))
        .toPlainDateTime({ hour: 0, minute: 0, second: 0 });
      minEnd = startDate
        .add(Temporal.Duration.from({ days: 1 }))
        .toPlainDateTime({ hour: 0, minute: 0, second: 0 });
    } else {
      const ctor = this.constructor as typeof TimedEventInteractionController;
      const minutes = ctor.snapInterval * direction;
      nextEnd = end.add(Temporal.Duration.from({ minutes }));
      minEnd = start.add(Temporal.Duration.from({ minutes: ctor.snapInterval }));
    }

    if (Temporal.PlainDateTime.compare(nextEnd, minEnd) < 0) {
      nextEnd = minEnd;
    }

    this.#setHostEnd(nextEnd);
    this.#dispatchUpdate("keyboard");
  }

  #deriveOperation(event: PointerEvent): InteractionOperation | null {
    const target = event.target as EventTarget | null;
    const allowedElement = this.#getAllowedTarget(target, event.composedPath());

    if (!allowedElement) {
      return null;
    }

    if (allowedElement.tagName === "RESIZE-HANDLE") {
      const position = allowedElement.getAttribute("position");
      if (position === "start") return "resize-start";
      if (position === "end") return "resize-end";
    }

    return "move";
  }

  #beginInteraction(e: PointerEvent, operation: InteractionOperation) {
    this.#isDragging = operation !== "move";
    this.#operation = operation;
    this.#activePointerId = e.pointerId;
    this.#activePointerType = e.pointerType;
    this.#pointerCaptureTarget = (e.currentTarget as HTMLElement | null) ?? undefined;
    this.#pointerCaptureTarget?.setPointerCapture(e.pointerId);
    window.addEventListener("pointerup", this.pointerUpHandler, true);
    window.addEventListener("pointercancel", this.pointerCancelHandler, true);

    this.#savedY = e.clientY;
    this.#savedHeight = this.#host.clientHeight;
    this.#savedStart = this.#toPlainDateTimeOrNull(this.#host.start);
    this.#savedEnd = this.#toPlainDateTimeOrNull(this.#host.end);
    this.#dragGhostMaxHeightPx = this.#resolveDragGhostMaxHeightPx(e);

    this.#initializeBoundsAndDayIndex(e);
    this.#initializeGrabOffsets(e);

    window.addEventListener("pointermove", this.pointerMoveHandler, true);
    if (this.#activePointerType === "touch") {
      window.addEventListener("touchmove", this.#activeTouchMoveBlocker, {
        capture: true,
        passive: false,
      });
      this.#dispatchTouchInteractionActive(true);
    }
    if (this.#isDragging) {
      this.#dispatchDragStateChange(true, this.#activePointerType);
    }
  }

  #beginPendingTouchInteraction(e: PointerEvent, operation: InteractionOperation) {
    const activationTimeoutId = window.setTimeout(() => {
      const pending = this.#pendingTouchInteraction;
      if (!pending || pending.pointerId !== e.pointerId) return;
      this.#cancelPendingTouchInteraction(false);
      this.#beginInteraction(pending.event, pending.operation);
    }, TOUCH_INTERACTION_ACTIVATION_DELAY_MS);

    this.#pendingTouchInteraction = {
      pointerId: e.pointerId,
      operation,
      event: e,
      startClientX: e.clientX,
      startClientY: e.clientY,
      activationTimeoutId,
    };

    window.addEventListener("pointermove", this.#pendingTouchMoveHandler, true);
    window.addEventListener("pointerup", this.pointerUpHandler, true);
    window.addEventListener("pointercancel", this.pointerCancelHandler, true);
  }

  readonly #pendingTouchMoveHandler = (e: PointerEvent) => {
    const pending = this.#pendingTouchInteraction;
    if (!pending || e.pointerId !== pending.pointerId) return;

    const deltaX = e.clientX - pending.startClientX;
    const deltaY = e.clientY - pending.startClientY;
    const pointerDistance = Math.hypot(deltaX, deltaY);
    if (pointerDistance >= TOUCH_INTERACTION_CANCEL_DISTANCE_PX) {
      this.#cancelPendingTouchInteraction();
    }
  };

  #cancelPendingTouchInteraction(resetTimeout = true) {
    const pending = this.#pendingTouchInteraction;
    if (!pending) return;

    if (resetTimeout) {
      window.clearTimeout(pending.activationTimeoutId);
    }

    this.#pendingTouchInteraction = null;
    window.removeEventListener("pointermove", this.#pendingTouchMoveHandler, true);
    window.removeEventListener("pointerup", this.pointerUpHandler, true);
    window.removeEventListener("pointercancel", this.pointerCancelHandler, true);
  }

  #initializeBoundsAndDayIndex(e: PointerEvent) {
    this.#bounds = this.#host.getBoundingClientRect();
    const bounds = this.#bounds;
    if (!bounds) return;

    const clientX = e.clientX - bounds.left;
    const clientY = e.clientY - bounds.top;
    const fractionX = bounds.width === 0 ? 0 : clientX / bounds.width;
    const fractionY = bounds.height === 0 ? 0 : clientY / bounds.height;
    this.#savedDayIndex = this.#computeDayIndex(fractionX, fractionY);
    this.#savedClientX = e.clientX;
    this.#savedClientY = e.clientY;
    this.#dragOffsetX = 0;
    this.#dragOffsetY = 0;
  }

  #initializeGrabOffsets(e: PointerEvent) {
    if (this.#operation !== "move") return;

    const sectionEl = this.#host.parentElement;
    if (!sectionEl) return;

    const sectionBounds = sectionEl.getBoundingClientRect();
    const { left: startLeft, top: startTop } = this.#getEventStartPosition(sectionBounds);
    this.#grabOffsetX = e.clientX - startLeft;
    this.#grabOffsetY = e.clientY - startTop;
  }

  #toPlainDateTimeOrNull(
    value: Temporal.PlainDateTime | string | null | undefined,
  ): Temporal.PlainDateTime | null {
    if (value == null) return null;
    if (typeof value === "string") return Temporal.PlainDateTime.from(value);
    return value;
  }

  #isActivePointerEvent(e: PointerEvent): boolean {
    return this.#activePointerId !== undefined && e.pointerId === this.#activePointerId;
  }

  #handleResizePointerMove(e: PointerEvent) {
    const resizeContext = this.#getResizeContext(e);
    if (!resizeContext) return;

    const { savedStart, savedEnd, adjustedSeconds } = resizeContext;
    const { newStart, newEnd } = this.#getResizedRange(savedStart, savedEnd, adjustedSeconds);

    this.#applyResizeResult(newStart, newEnd);
  }

  #getResizeContext(e: PointerEvent): {
    savedStart: Temporal.PlainDateTime;
    savedEnd: Temporal.PlainDateTime;
    adjustedSeconds: number;
  } | null {
    const bounds = this.#bounds;
    const savedStart = this.#savedStart;
    const savedEnd = this.#savedEnd;

    if (!bounds || !savedStart || !savedEnd) return null;

    const deltaY = e.clientY - this.#savedY;
    const deltaYFraction = this.#savedHeight === 0 ? 0 : deltaY / this.#savedHeight;

    const clientX = e.clientX - bounds.left;
    const clientY = e.clientY - bounds.top;
    const fractionX = bounds.width === 0 ? 0 : clientX / bounds.width;
    const fractionY = bounds.height === 0 ? 0 : clientY / bounds.height;
    const dayIndex = this.#computeDayIndex(fractionX, fractionY);

    const changedSecondsWithinDay =
      this.#mode === "all-day" ? 0 : Math.round(deltaYFraction * SECONDS_IN_DAY);
    const changedDays = dayIndex - this.#savedDayIndex;
    const changedSeconds = changedSecondsWithinDay + changedDays * SECONDS_IN_DAY;

    const adjustedSeconds = this.#snapSeconds(changedSeconds);

    return { savedStart, savedEnd, adjustedSeconds };
  }

  #getResizedRange(
    savedStart: Temporal.PlainDateTime,
    savedEnd: Temporal.PlainDateTime,
    adjustedSeconds: number,
  ): { newStart: Temporal.PlainDateTime; newEnd: Temporal.PlainDateTime } {
    const changedDuration = Temporal.Duration.from({ seconds: adjustedSeconds });
    let newStart = savedStart.add(changedDuration);
    let newEnd = savedEnd.add(changedDuration);

    const ctor = this.constructor as typeof TimedEventInteractionController;
    const minDurationSeconds = ctor.snapInterval * 60;

    if (this.#operation === "resize-start") {
      const maxStart = savedEnd.subtract({ seconds: minDurationSeconds });
      if (Temporal.PlainDateTime.compare(newStart, maxStart) > 0) {
        newStart = maxStart;
      }
    }

    if (this.#operation === "resize-end") {
      const minEnd = savedStart.add({ seconds: minDurationSeconds });
      if (Temporal.PlainDateTime.compare(newEnd, minEnd) < 0) {
        newEnd = minEnd;
      }
    }

    return { newStart, newEnd };
  }

  #applyResizeResult(newStart: Temporal.PlainDateTime, newEnd: Temporal.PlainDateTime) {
    if (this.#operation !== "resize-end") {
      this.#setHostStart(newStart);
    }

    if (this.#operation !== "resize-start") {
      this.#setHostEnd(newEnd);
    }
  }

  #handleMovePointerMove(e: PointerEvent) {
    const sectionElement = this.#host.parentElement;
    if (!sectionElement) return;

    if (!this.#isDragging) {
      const deltaX = e.clientX - this.#savedClientX;
      const deltaY = e.clientY - this.#savedClientY;
      const pointerDistance = Math.hypot(deltaX, deltaY);
      if (pointerDistance < MOVE_DRAG_ACTIVATION_DISTANCE_PX) {
        return;
      }

      this.#isDragging = true;
      this.#dispatchDragStateChange(true, this.#activePointerType);
    }

    const sectionBounds = sectionElement.getBoundingClientRect();
    const { fractionX, fractionY, eventStartVisualLeft, eventStartVisualTop } =
      this.#getMovePointerFractions(e, sectionBounds);

    const hoveredDayIndex = this.#computeDayIndex(fractionX, fractionY);
    const hoveredTime = this.#getHoveredTimeFromFraction(fractionY);

    this.#updateHoverState(hoveredDayIndex, hoveredTime);
    this.#dispatchDragHover({
      dayIndex: hoveredDayIndex,
      time: hoveredTime,
      clientX: eventStartVisualLeft,
      clientY: eventStartVisualTop,
    });

    this.#updateDragOffset(e, sectionBounds);
  }

  #getMovePointerFractions(
    e: PointerEvent,
    sectionBounds: DOMRect,
  ): {
    fractionX: number;
    fractionY: number;
    eventStartVisualLeft: number;
    eventStartVisualTop: number;
  } {
    const eventStartVisualLeft = e.clientX - this.#grabOffsetX;
    const eventStartVisualTop = e.clientY - this.#grabOffsetY;
    const relativeX = eventStartVisualLeft - sectionBounds.left;
    const relativeY = eventStartVisualTop - sectionBounds.top;
    const fractionX = sectionBounds.width === 0 ? 0 : relativeX / sectionBounds.width;
    const fractionY = sectionBounds.height === 0 ? 0 : relativeY / sectionBounds.height;

    return { fractionX, fractionY, eventStartVisualLeft, eventStartVisualTop };
  }

  #getHoveredTimeFromFraction(fractionY: number): Temporal.PlainTime | null {
    if (this.#mode !== "timed") return null;
    return this.#getSnappedTimeFromFraction(fractionY);
  }

  #updateHoverState(dayIndex: number, time: Temporal.PlainTime | null) {
    this.#highlightedDayIndex = dayIndex;
    this.#highlightedTime = time;
  }

  #updateDragOffset(e: PointerEvent, sectionBounds: DOMRect) {
    const { left: currentStartLeft, top: currentStartTop } =
      this.#getEventStartPosition(sectionBounds);
    this.#dragOffsetX = e.clientX - this.#grabOffsetX - currentStartLeft;
    this.#dragOffsetY = e.clientY - this.#grabOffsetY - currentStartTop;

    this.#dispatchDragOffset({
      offsetX: this.#dragOffsetX,
      offsetY: this.#dragOffsetY,
    });
  }

  #finalizeMove() {
    const context = this.#getFinalizeMoveContext();
    if (!context) {
      this.#cleanupAfterFinalMove();
      return;
    }

    const { dayIndex, time, savedStart, savedEnd, viewDays } = context;
    const { targetStart, targetEnd } = this.#getFinalTargetRange(
      dayIndex,
      time,
      savedStart,
      savedEnd,
      viewDays,
    );

    if (this.#isUnchangedMove(savedStart, savedEnd, targetStart, targetEnd)) {
      this.#cleanupAfterFinalMove();
      return;
    }

    this.#applyFinalMove(targetStart, targetEnd);
    this.#cleanupAfterFinalMove();
  }

  #isUnchangedMove(
    originalStart: Temporal.PlainDateTime,
    originalEnd: Temporal.PlainDateTime,
    targetStart: Temporal.PlainDateTime,
    targetEnd: Temporal.PlainDateTime,
  ): boolean {
    return (
      Temporal.PlainDateTime.compare(originalStart, targetStart) === 0 &&
      Temporal.PlainDateTime.compare(originalEnd, targetEnd) === 0
    );
  }

  #getFinalizeMoveContext(): {
    dayIndex: number;
    time: Temporal.PlainTime | null;
    savedStart: Temporal.PlainDateTime;
    savedEnd: Temporal.PlainDateTime;
    viewDays: Temporal.PlainDate[];
  } | null {
    const bounds = this.#bounds;
    const savedStart = this.#savedStart;
    const savedEnd = this.#savedEnd;
    const viewDays = (this.#host as { viewDays?: Temporal.PlainDate[] }).viewDays;

    if (!bounds || !savedStart || !savedEnd || !viewDays || !viewDays.length) {
      return null;
    }

    const dayIndex = this.#getFinalDayIndex();
    const time = this.#getFinalTime();

    if (dayIndex === null || dayIndex < 0 || dayIndex >= viewDays.length) {
      return null;
    }

    return { dayIndex, time, savedStart, savedEnd, viewDays };
  }

  #getFinalDayIndex(): number | null {
    if (this.#highlightedDayIndex !== null) return this.#highlightedDayIndex;

    const sectionElement = this.#host.parentElement;
    if (!sectionElement) return null;
    const sectionBounds = sectionElement.getBoundingClientRect();
    const { left: eventStartLeft, top: eventStartTop } = this.#getEventStartPosition(sectionBounds);
    const eventStartVisualLeft = eventStartLeft + this.#dragOffsetX;
    const eventStartVisualTop = eventStartTop + this.#dragOffsetY;
    const relativeX = eventStartVisualLeft - sectionBounds.left;
    const relativeY = eventStartVisualTop - sectionBounds.top;
    const fractionX = sectionBounds.width === 0 ? 0 : relativeX / sectionBounds.width;
    const fractionY = sectionBounds.height === 0 ? 0 : relativeY / sectionBounds.height;
    return this.#computeDayIndex(fractionX, fractionY);
  }

  #getFinalTime(): Temporal.PlainTime | null {
    if (this.#highlightedTime) return this.#highlightedTime;

    if (this.#mode !== "timed") return null;

    const sectionElement = this.#host.parentElement;
    if (!sectionElement) return null;
    const sectionBounds = sectionElement.getBoundingClientRect();
    const { top: eventStartTop } = this.#getEventStartPosition(sectionBounds);
    const eventStartVisualTop = eventStartTop + this.#dragOffsetY;
    const relativeY = eventStartVisualTop - sectionBounds.top;
    const fractionY = sectionBounds.height === 0 ? 0 : relativeY / sectionBounds.height;

    return this.#getSnappedTimeFromFraction(fractionY);
  }

  #getFinalTargetRange(
    dayIndex: number,
    time: Temporal.PlainTime | null,
    savedStart: Temporal.PlainDateTime,
    savedEnd: Temporal.PlainDateTime,
    viewDays: Temporal.PlainDate[],
  ): { targetStart: Temporal.PlainDateTime; targetEnd: Temporal.PlainDateTime } {
    const targetDay = viewDays[dayIndex];

    if (this.#mode === "all-day") {
      const startTime = savedStart.toPlainTime();
      const targetStart = targetDay.toPlainDateTime({
        hour: startTime.hour,
        minute: startTime.minute,
        second: startTime.second,
        millisecond: startTime.millisecond,
        microsecond: startTime.microsecond,
        nanosecond: startTime.nanosecond,
      });
      const duration = savedStart.until(savedEnd);
      const targetEnd = targetStart.add(duration);

      return { targetStart, targetEnd };
    }

    if (!time) {
      throw new Error("Timed move requires a time value.");
    }

    const targetStart = targetDay.toPlainDateTime({
      hour: time.hour,
      minute: time.minute,
      second: 0,
    });

    const duration = savedStart.until(savedEnd);
    const targetEnd = targetStart.add(duration);

    return { targetStart, targetEnd };
  }

  #applyFinalMove(targetStart: Temporal.PlainDateTime, targetEnd: Temporal.PlainDateTime) {
    this.#setHostStart(targetStart);
    this.#setHostEnd(targetEnd);
    this.#dispatchUpdate();
  }

  #setHostStart(value: Temporal.PlainDateTime) {
    if (typeof this.#host.setStartFromPlainDateTime === "function") {
      this.#host.setStartFromPlainDateTime(value);
      return;
    }
    this.#host.start = value.toString();
  }

  #setHostEnd(value: Temporal.PlainDateTime) {
    if (typeof this.#host.setEndFromPlainDateTime === "function") {
      this.#host.setEndFromPlainDateTime(value);
      return;
    }
    this.#host.end = value.toString();
  }

  #cleanupAfterFinalMove() {
    window.removeEventListener("pointerup", this.pointerUpHandler, true);
    window.removeEventListener("pointercancel", this.pointerCancelHandler, true);
    window.removeEventListener("pointermove", this.pointerMoveHandler, true);
    window.removeEventListener("touchmove", this.#activeTouchMoveBlocker, true);
    this.#highlightedDayIndex = null;
    this.#highlightedTime = null;
    this.#dispatchDragHover(null);

    const oldPointerId = this.#activePointerId;
    const oldPointerType = this.#activePointerType;
    this.#activePointerId = undefined;
    this.#activePointerType = undefined;
    this.#bounds = null;
    this.#savedStart = null;
    this.#savedEnd = null;
    this.#dragGhostMaxHeightPx = null;

    if (oldPointerId !== undefined) {
      this.#pointerCaptureTarget?.releasePointerCapture(oldPointerId);
    }
    if (oldPointerType === "touch") {
      this.#dispatchTouchInteractionActive(false);
    }
    this.#pointerCaptureTarget = undefined;

    requestAnimationFrame(() => {
      this.#dragOffsetX = 0;
      this.#dragOffsetY = 0;
      this.#dispatchDragOffset({ offsetX: 0, offsetY: 0 });
      this.#isDragging = false;
      this.#dispatchDragStateChange(false, oldPointerType);
    });
  }

  #finalizeNonMove() {
    const wasDragging = this.#isDragging;
    window.removeEventListener("pointerup", this.pointerUpHandler, true);
    window.removeEventListener("pointercancel", this.pointerCancelHandler, true);
    window.removeEventListener("pointermove", this.pointerMoveHandler, true);
    window.removeEventListener("touchmove", this.#activeTouchMoveBlocker, true);
    if (this.#activePointerId !== undefined) {
      this.#pointerCaptureTarget?.releasePointerCapture(this.#activePointerId);
    }
    this.#pointerCaptureTarget = undefined;
    this.#activePointerId = undefined;
    const oldPointerType = this.#activePointerType;
    this.#activePointerType = undefined;
    if (oldPointerType === "touch") {
      this.#dispatchTouchInteractionActive(false);
    }
    this.#isDragging = false;
    this.#highlightedDayIndex = null;
    this.#highlightedTime = null;
    this.#dragGhostMaxHeightPx = null;

    this.#dispatchDragHover(null);

    if (this.#operation !== "move") {
      this.#dragOffsetX = 0;
      this.#dragOffsetY = 0;
      this.#dispatchDragOffset({ offsetX: 0, offsetY: 0 });
    }

    if (this.#shouldDispatchNonMoveUpdate()) {
      this.#dispatchUpdate();
    }

    if (wasDragging) {
      this.#dispatchDragStateChange(false, oldPointerType);
    }
  }

  #shouldDispatchNonMoveUpdate(): boolean {
    if (this.#operation === "move") {
      return false;
    }

    const originalStart = this.#savedStart;
    const originalEnd = this.#savedEnd;
    const currentStart = this.#toPlainDateTimeOrNull(this.#host.start);
    const currentEnd = this.#toPlainDateTimeOrNull(this.#host.end);

    if (!originalStart || !originalEnd || !currentStart || !currentEnd) {
      return true;
    }

    return !this.#isUnchangedMove(originalStart, originalEnd, currentStart, currentEnd);
  }

  #getAllowedTarget(target: EventTarget | null, composedPath: EventTarget[]): HTMLElement | null {
    const candidates = [target, ...composedPath];

    for (const candidate of candidates) {
      if (!(candidate instanceof HTMLElement)) continue;

      if (candidate.tagName === "RESIZE-HANDLE") {
        return candidate;
      }

      if (this.#isEventCardDiv(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  #isEventCardDiv(element: HTMLElement): boolean {
    if (element.tagName !== "DIV") {
      return false;
    }

    const rootNode = element.getRootNode();
    if (!(rootNode instanceof ShadowRoot)) {
      return false;
    }

    const host = rootNode.host;
    return host instanceof HTMLElement && host.tagName === "EVENT-CARD";
  }

  #resolveDragGhostMaxHeightPx(event: PointerEvent): number | null {
    const targets = [event.target, ...event.composedPath()];
    for (const target of targets) {
      const eventCard = this.#toEventCardHost(target);
      if (!eventCard) continue;
      const height = eventCard.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) continue;
      return height;
    }
    return null;
  }

  #toEventCardHost(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof HTMLElement)) return null;
    if (target.tagName === "EVENT-CARD") return target;
    const rootNode = target.getRootNode();
    if (!(rootNode instanceof ShadowRoot)) return null;
    const host = rootNode.host;
    return host instanceof HTMLElement && host.tagName === "EVENT-CARD" ? host : null;
  }

  #dispatchUpdate(inputMethod: "keyboard" | "pointer" = "pointer") {
    this.#host.dispatchEvent(
      new CustomEvent("update", {
        detail: {
          source: "interaction" as const,
          inputMethod,
        },
      }),
    );
  }

  #computeDayIndex(fractionX: number, fractionY?: number): number {
    const dayCount = this.#getRenderedDayCount();
    if (dayCount <= 1) return 0;
    const isRtl = this.#isRtlLayout();
    const daysPerRow = this.#getDaysPerRow();
    if (daysPerRow > 0 && daysPerRow < dayCount && fractionY !== undefined) {
      const totalRows = Math.ceil(dayCount / daysPerRow);
      const clampedX = Math.max(0, Math.min(MAX_FRACTION, fractionX));
      const clampedY = Math.max(0, Math.min(MAX_FRACTION, fractionY));
      const row = Math.floor(clampedY * totalRows);
      const visualCol = Math.floor(clampedX * daysPerRow);
      const col = isRtl ? daysPerRow - visualCol - 1 : visualCol;
      const index = row * daysPerRow + col;
      return Math.min(index, dayCount - 1);
    }
    const clampedFraction = Math.max(0, Math.min(MAX_FRACTION, fractionX));
    const visualIndex = Math.floor(clampedFraction * dayCount);
    return isRtl ? dayCount - visualIndex - 1 : visualIndex;
  }

  #getDaysPerRow(): number {
    const host = this.#host as { daysPerRow?: number };
    return host.daysPerRow ?? 0;
  }

  #getRenderedDayCount(): number {
    const viewDays = this.#host.viewDays;
    if (Array.isArray(viewDays)) return viewDays.length;
    const ctor = this.constructor as typeof TimedEventInteractionController;
    return ctor.renderedDayCount;
  }

  /** Get the pixel position (left, top) of the event's start within the section. */
  #getEventStartPosition(sectionBounds: DOMRect): { left: number; top: number } {
    const viewDays = (this.#host as { viewDays?: Temporal.PlainDate[] }).viewDays;
    if (!this.#savedStart || !viewDays?.length) {
      return { left: sectionBounds.left, top: sectionBounds.top };
    }

    const startDayIndex = this.#getStartDayIndex(viewDays, this.#savedStart);
    if (startDayIndex < 0) {
      return { left: sectionBounds.left, top: sectionBounds.top };
    }

    if (this.#mode === "all-day") {
      return this.#getAllDayStartPosition(sectionBounds, startDayIndex, viewDays.length);
    }

    return this.#getTimedStartPosition(sectionBounds, startDayIndex, viewDays.length);
  }

  #getStartDayIndex(viewDays: Temporal.PlainDate[], savedStart: Temporal.PlainDateTime): number {
    const startDate = savedStart.toPlainDate();
    return viewDays.findIndex(
      (d) => (typeof d === "string" ? d : d.toString()) === startDate.toString(),
    );
  }

  #getAllDayStartPosition(
    sectionBounds: DOMRect,
    startDayIndex: number,
    dayCount: number,
  ): { left: number; top: number } {
    const daysPerRow = this.#getDaysPerRow();
    const stackOffsetY = this.#getAllDayStackOffsetY();
    const dayNumberOffsetY = this.#getAllDayDayNumberOffsetY();

    if (daysPerRow > 0 && daysPerRow < dayCount) {
      const gridRows = (this.#host as { gridRows?: number }).gridRows ?? 1;
      const logicalColIndex = startDayIndex % daysPerRow;
      const colIndex = this.#toVisualColumnIndex(logicalColIndex, daysPerRow);
      const rowIndex = Math.floor(startDayIndex / daysPerRow);
      const left = this.#getColumnInlineStartX(sectionBounds, colIndex, daysPerRow);
      const top =
        sectionBounds.top +
        (rowIndex / gridRows) * sectionBounds.height +
        dayNumberOffsetY +
        stackOffsetY;
      return { left, top };
    }

    const visualDayIndex = this.#toVisualColumnIndex(startDayIndex, dayCount);
    const left = this.#getColumnInlineStartX(sectionBounds, visualDayIndex, dayCount);
    return { left, top: sectionBounds.top + dayNumberOffsetY + stackOffsetY };
  }

  #getAllDayStackOffsetY(): number {
    const getter = this.#host.getInteractionStackOffsetY;
    if (typeof getter !== "function") return 0;
    const offset = getter.call(this.#host);
    return Number.isFinite(offset) ? offset : 0;
  }

  #getAllDayDayNumberOffsetY(): number {
    const value = getComputedStyle(this.#host)
      .getPropertyValue("--_lc-all-day-day-number-space")
      .trim();
    const px = parseFloat(value);
    return Number.isFinite(px) ? px : 0;
  }

  #getTimedStartPosition(
    sectionBounds: DOMRect,
    startDayIndex: number,
    dayCount: number,
  ): { left: number; top: number } {
    const visualDayIndex = this.#toVisualColumnIndex(startDayIndex, dayCount);
    const left = sectionBounds.left + ((visualDayIndex + 0.5) / dayCount) * sectionBounds.width;
    const savedStart = this.#savedStart;
    if (!savedStart) {
      return { left, top: sectionBounds.top };
    }
    const startTime = savedStart.toPlainTime();
    const seconds = startTime.hour * 3600 + startTime.minute * 60 + startTime.second;
    const fractionY = seconds / SECONDS_IN_DAY;
    const top = sectionBounds.top + fractionY * sectionBounds.height;
    return { left, top };
  }

  #toVisualColumnIndex(logicalIndex: number, columnCount: number): number {
    if (!this.#isRtlLayout()) return logicalIndex;
    return columnCount - logicalIndex - 1;
  }

  #isRtlLayout(): boolean {
    return getComputedStyle(this.#host).direction === "rtl";
  }

  #getColumnInlineStartX(sectionBounds: DOMRect, visualColIndex: number, colCount: number): number {
    const colWidth = sectionBounds.width / colCount;
    const colLeft = sectionBounds.left + visualColIndex * colWidth;
    if (this.#isRtlLayout()) {
      // Keep the anchor inside the column so flooring maps to this same day.
      return colLeft + colWidth - INLINE_START_ANCHOR_INSET_PX;
    }
    return colLeft + INLINE_START_ANCHOR_INSET_PX;
  }

  #snapSeconds(seconds: number): number {
    const ctor = this.constructor as typeof TimedEventInteractionController;
    const increment = ctor.snapInterval * 60;
    return Math.round(seconds / increment) * increment;
  }

  #getSnappedTimeFromFraction(fractionY: number): Temporal.PlainTime {
    const targetTimeFraction = Math.max(0, Math.min(1, fractionY));
    const targetSecondsWithinDay = Math.round(targetTimeFraction * SECONDS_IN_DAY);
    const adjustedSeconds = this.#snapSeconds(targetSecondsWithinDay);
    const hours = Math.floor(adjustedSeconds / 3600);
    const minutes = Math.floor((adjustedSeconds % 3600) / 60);
    return Temporal.PlainTime.from({ hour: hours, minute: minutes, second: 0 });
  }

  #dispatchDragStateChange(isDragging: boolean, pointerType?: string) {
    this.#host.dispatchEvent(
      new CustomEvent("interaction-drag-state", {
        detail: { isDragging, pointerType },
        bubbles: false,
        composed: false,
      }),
    );
  }

  #dispatchTouchInteractionActive(active: boolean) {
    this.#host.dispatchEvent(
      new CustomEvent("interaction-touch-active", {
        detail: { active },
        bubbles: false,
        composed: false,
      }),
    );
  }

  #dispatchDragHover(
    hover: {
      dayIndex: number;
      time: Temporal.PlainTime | null;
      clientX: number;
      clientY: number;
      ghostMaxHeightPx?: number | null;
    } | null,
  ) {
    const detail = hover
      ? {
          ...hover,
          ghostMaxHeightPx: this.#dragGhostMaxHeightPx,
        }
      : null;
    this.#host.dispatchEvent(
      new CustomEvent("interaction-drag-hover", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #dispatchDragOffset(offset: { offsetX: number; offsetY: number }) {
    this.#host.dispatchEvent(
      new CustomEvent("interaction-drag-offset", {
        detail: offset,
        bubbles: false,
        composed: false,
      }),
    );
  }

  #dispatchSelect(trigger: "click" | "keyboard", pointerType: string, sourceEvent: Event) {
    this.#host.dispatchEvent(
      new CustomEvent("select", {
        detail: {
          trigger,
          pointerType,
          sourceEvent,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #markSuppressNextClick() {
    this.#host.setAttribute("data-suppress-next-select-click", "");
    if (this.#clearSuppressClickTimerId !== null) {
      window.clearTimeout(this.#clearSuppressClickTimerId);
    }
    this.#clearSuppressClickTimerId = window.setTimeout(() => {
      this.#host.removeAttribute("data-suppress-next-select-click");
      this.#clearSuppressClickTimerId = null;
    }, 400);
  }

  get dragOffset(): { x: number; y: number } {
    return { x: this.#dragOffsetX, y: this.#dragOffsetY };
  }
}
