import { Temporal } from "@js-temporal/polyfill";
import type { PropertyValues } from "lit";
import { html, unsafeCSS } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { formatShortTime } from "../utils/TimeFormatting";
import "../EventCard/EventCard";
import "../ResizeHandle/ResizeHandle";
import { EventBase } from "../EventBase/EventBase.js";
import componentStyle from "./AllDayEvent.css?inline";

// Module-level (was a static private field; TS 5.9 disallows class decorators
// alongside static private identifiers — same lifetime and visibility).
const stackIndexCache = new WeakMap<HTMLElement, Map<string, Map<AllDayEvent, number>>>();

@customElement("all-day-event")
export class AllDayEvent extends EventBase {
  #lockedStackIndex: number | null = null;
  #previewDisplayTime: string | null = null;
  #keyboardHintId = `all-day-event-kbd-${Math.random().toString(36).slice(2, 9)}`;

  @property({ type: Number })
  daysPerRow: number = 0;

  @property({ type: Number })
  gridRows: number = 1;

  @property({ type: Number })
  maxVisibleRows: number = Number.POSITIVE_INFINITY;

  @property({ attribute: false })
  maxVisibleRowsByDay: Map<number, number> = new Map();

  @property({ type: Boolean, attribute: "interaction-disabled" })
  interactionDisabled = false;

  constructor() {
    super({ mode: "all-day" });
  }

  static get styles() {
    return [...EventBase.styles, unsafeCSS(componentStyle)];
  }

  connectedCallback() {
    super.connectedCallback();
    this.#clearStackIndexCache();
    this.addEventListener(
      "interaction-drag-hover",
      this.#handleInteractionDragHover as EventListener,
    );
  }

  disconnectedCallback() {
    this.#clearStackIndexCache();
    this.removeEventListener(
      "interaction-drag-hover",
      this.#handleInteractionDragHover as EventListener,
    );
    super.disconnectedCallback();
  }

  override updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (changedProperties.has("summary")) {
      this.#clearStackIndexCache();
    }
    // When start/end change outside of a drag (e.g. keyboard move), refresh all siblings
    // so stacking is recalculated. Pointer drag already does this in onDragEnd().
    if (
      (changedProperties.has("start") || changedProperties.has("end")) &&
      !this.interactionController.isDragging
    ) {
      this.#refreshSiblingsStacking();
    }
  }

  /** Clear lock and request re-render of all all-day siblings so stacking is recalculated. */
  #refreshSiblingsStacking(): void {
    this.#clearStackIndexCache();
    this.#lockedStackIndex = null;
    const parent = this.parentElement;
    if (parent) {
      const siblings = parent.querySelectorAll<AllDayEvent>("all-day-event");
      siblings.forEach((event) => {
        event.requestUpdate();
      });
    }
  }

  get endDate(): Temporal.PlainDate | null {
    if (!this.end) return null;
    const endDateTime = Temporal.PlainDateTime.from(this.end.toString());
    const exclusiveEnd = endDateTime.subtract({ nanoseconds: 1 });
    return exclusiveEnd.toPlainDate();
  }

  get siblings(): AllDayEvent[] {
    const siblings = super.siblings as AllDayEvent[];
    return siblings.sort((a, b) => {
      const aStart = a.startDate?.toString() ?? "";
      const bStart = b.startDate?.toString() ?? "";
      if (aStart !== bStart) {
        return aStart.localeCompare(bStart);
      }
      const aEnd = a.endDate?.toString() ?? "";
      const bEnd = b.endDate?.toString() ?? "";
      if (aEnd !== bEnd) {
        // Prefer longer all-day spans when start date is equal.
        return bEnd.localeCompare(aEnd);
      }
      return a.summary.localeCompare(b.summary);
    });
  }

  #clearStackIndexCache() {
    const parent = this.parentElement;
    if (!parent) return;
    stackIndexCache.delete(parent);
  }

  #stackCacheKey(renderedDays: string[], rowIndex: number | null): string {
    const rowToken = rowIndex === null ? "all" : String(rowIndex);
    return `${rowToken}|${this.daysPerRow}|${this.gridRows}|${renderedDays.join(",")}`;
  }

  #getStackIndexMap(renderedDays: string[], rowIndex: number | null): Map<AllDayEvent, number> {
    const parent = this.parentElement;
    if (!parent) {
      const fallback = new Map<AllDayEvent, number>();
      fallback.set(this, 0);
      return fallback;
    }

    const key = this.#stackCacheKey(renderedDays, rowIndex);
    let parentCache = stackIndexCache.get(parent);
    if (!parentCache) {
      parentCache = new Map();
      stackIndexCache.set(parent, parentCache);
    }
    const cached = parentCache.get(key);
    if (cached) return cached;

    const computed = this.#computeStackIndexMap(renderedDays, rowIndex);
    parentCache.set(key, computed);
    return computed;
  }

  #computeStackIndexMap(renderedDays: string[], rowIndex: number | null): Map<AllDayEvent, number> {
    const result = new Map<AllDayEvent, number>();
    const occupiedByDay = new Map<string, Set<number>>();

    for (const sibling of this.siblings) {
      const dayKeys =
        rowIndex === null
          ? sibling.#dayKeysForGlobalStack(renderedDays)
          : sibling.#dayKeysForRowStack(renderedDays, rowIndex);
      if (!dayKeys.length) {
        result.set(sibling, 0);
        continue;
      }

      const occupied = new Set<number>();
      for (const key of dayKeys) {
        const occupiedRows = occupiedByDay.get(key);
        if (!occupiedRows) continue;
        for (const row of occupiedRows) occupied.add(row);
      }

      const stackIndex = this.#findFirstFreeRow(occupied);
      result.set(sibling, stackIndex);

      for (const key of dayKeys) {
        const occupiedRows = occupiedByDay.get(key) ?? new Set<number>();
        occupiedRows.add(stackIndex);
        occupiedByDay.set(key, occupiedRows);
      }
    }

    return result;
  }

  #dayKeysForGlobalStack(renderedDays: string[]): string[] {
    return this.#getVisibleDayKeys(renderedDays);
  }

  #dayKeysForRowStack(renderedDays: string[], rowIndex: number): string[] {
    if (!this.daysPerRow || this.daysPerRow <= 0 || this.gridRows <= 0) {
      return this.#dayKeysForGlobalStack(renderedDays);
    }

    const startDayIndex = rowIndex * this.daysPerRow;
    const endDayIndex = Math.min(startDayIndex + this.daysPerRow, renderedDays.length);
    const rowDayKeys = new Set(renderedDays.slice(startDayIndex, endDayIndex));

    return this.renderedDays.map((day) => day.toString()).filter((key) => rowDayKeys.has(key));
  }

  #getVisibleDayKeys(renderedDays: string[]): string[] {
    return this.renderedDays
      .map((day) => day.toString())
      .filter((day) => renderedDays.includes(day));
  }

  #getStackIndex(renderedDays: string[], options?: { ignoreLock?: boolean }): number {
    if (!options?.ignoreLock && this.#lockedStackIndex !== null) {
      return this.#lockedStackIndex;
    }
    const stackMap = this.#getStackIndexMap(renderedDays, null);
    return stackMap.get(this) ?? 0;
  }

  #findFirstFreeRow(occupiedRows: Set<number>): number {
    let candidate = 0;
    while (occupiedRows.has(candidate)) {
      candidate += 1;
    }
    return candidate;
  }

  /** Stack index for this event on a specific grid row. Only conflicts with siblings that share a day on this row. */
  #getStackIndexForRow(renderedDays: string[], rowIndex: number): number {
    if (!this.daysPerRow || this.daysPerRow <= 0 || this.gridRows <= 0) {
      return this.#getStackIndex(renderedDays);
    }
    const stackMap = this.#getStackIndexMap(renderedDays, rowIndex);
    return stackMap.get(this) ?? 0;
  }

  // All-day events always occupy the full width of the day column they belong to.
  // When daysPerRow > 0 (month view), position by column = dayIndex % daysPerRow, row = floor(dayIndex / daysPerRow).
  #createRowInset(
    rowIndex: number,
    startColIndex: number,
    widthInColumns: number,
    cols: number,
    renderedDays: string[],
    stackIndexOverride?: number,
  ): { style: Record<string, string | number>; rowIndex: number; stackIndex: number } {
    const left = (startColIndex / cols) * 100;
    const stackIndex = stackIndexOverride ?? this.#getStackIndexForPosition(renderedDays, rowIndex);
    const top = this.#getTopPosition(rowIndex, stackIndex);
    const inlineInsetStart = this.daysPerRow > 0 ? "2px" : "1px";
    const inlineInsetEnd = this.daysPerRow > 0 ? "1px" : "2px";

    return {
      rowIndex,
      stackIndex,
      style: {
        top,
        height: `var(--_lc-event-height, 32px)`,
        "--_lc-left": `${left}%`,
        "--_lc-width": widthInColumns,
        "--_lc-margin-left": 0,
        "--_lc-indentation": "0px",
        "--_lc-inline-inset-start": inlineInsetStart,
        "--_lc-inline-inset-end": inlineInsetEnd,
        "--_lc-z-index": 1,
      },
    };
  }

  #getStackIndexForPosition(renderedDays: string[], rowIndex: number): number {
    const hasGrid = this.daysPerRow > 0 && this.gridRows > 0;
    return hasGrid
      ? this.#getStackIndexForRow(renderedDays, rowIndex)
      : this.#getStackIndex(renderedDays);
  }

  #getTopPosition(rowIndex: number, stackIndex: number): string {
    const hasGrid = this.daysPerRow > 0 && this.gridRows > 0;
    const dayNumberOffset = "var(--_lc-all-day-day-number-space)";

    if (hasGrid) {
      return `calc(var(--_lc-row-height, 100%) * ${rowIndex} + ${dayNumberOffset} + var(--_lc-event-height, 32px) * ${stackIndex})`;
    }

    return `calc(${dayNumberOffset} + var(--_lc-event-height, 32px) * ${stackIndex})`;
  }

  get dayInsets() {
    const insets: Array<{
      style: Record<string, string | number>;
      rowIndex: number;
      stackIndex: number;
    }> = [];
    const viewDayStrings = this.viewDays.map((day) => day.toString());
    if (!viewDayStrings.length) return insets;

    const visibleDayIndexes = this.renderedDays
      .map((day) => viewDayStrings.indexOf(day.toString()))
      .filter((dayIndex) => dayIndex >= 0)
      .sort((a, b) => a - b);
    if (!visibleDayIndexes.length) return insets;

    const totalCols = this.daysPerRow > 0 ? this.daysPerRow : viewDayStrings.length;
    const rowSegments = new Map<number, { startColIndex: number; endColIndex: number }>();

    visibleDayIndexes.forEach((dayIndex) => {
      const rowIndex = this.daysPerRow > 0 ? Math.floor(dayIndex / this.daysPerRow) : 0;
      const colIndex = this.daysPerRow > 0 ? dayIndex % this.daysPerRow : dayIndex;
      const existingSegment = rowSegments.get(rowIndex);

      if (!existingSegment) {
        rowSegments.set(rowIndex, { startColIndex: colIndex, endColIndex: colIndex });
        return;
      }

      existingSegment.startColIndex = Math.min(existingSegment.startColIndex, colIndex);
      existingSegment.endColIndex = Math.max(existingSegment.endColIndex, colIndex);
    });

    Array.from(rowSegments.entries())
      .sort((a, b) => a[0] - b[0])
      .forEach(([rowIndex, segment]) => {
        const stackIndex = this.#getStackIndexForPosition(viewDayStrings, rowIndex);
        let runStartColIndex: number | null = null;
        for (let colIndex = segment.startColIndex; colIndex <= segment.endColIndex; colIndex += 1) {
          const dayIndex = this.daysPerRow > 0 ? rowIndex * this.daysPerRow + colIndex : colIndex;
          const visible = this.#isStackVisibleForDay(dayIndex, stackIndex);
          if (visible && runStartColIndex === null) {
            runStartColIndex = colIndex;
          }
          const isRunEnd =
            runStartColIndex !== null && (!visible || colIndex === segment.endColIndex);
          if (!isRunEnd || runStartColIndex === null) continue;
          const runEndColIndex = visible ? colIndex : colIndex - 1;
          const widthInColumns = runEndColIndex - runStartColIndex + 1;
          insets.push(
            this.#createRowInset(
              rowIndex,
              runStartColIndex,
              widthInColumns,
              totalCols,
              viewDayStrings,
              stackIndex,
            ),
          );
          runStartColIndex = null;
        }
      });

    return insets;
  }

  get displayTime(): string {
    if (this.#previewDisplayTime != null) {
      return this.#previewDisplayTime;
    }

    if (!this.startHasTimeComponent) return "";

    const startDate = this.startDate;
    const startTime = this.startTime;
    if (!startDate || !startTime) return "";

    const isStartVisible = this.viewDays.some(
      (day) => Temporal.PlainDate.compare(day, startDate) === 0,
    );
    if (!isStartVisible) return "";

    return formatShortTime(this.lang, startTime);
  }

  #handleInteractionDragHover = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;

    if (!this.startHasTimeComponent) {
      this.#clearPreviewDisplayTime();
      return;
    }

    const hover = this.#getHoverDetail(event);
    if (!hover) {
      this.#clearPreviewDisplayTime();
      return;
    }

    const viewPortDays = this.viewDays;
    if (
      !viewPortDays ||
      !viewPortDays.length ||
      !this.#hasValidHoverDayIndex(hover, viewPortDays)
    ) {
      this.#clearPreviewDisplayTime();
      return;
    }

    const startDate = this.startDate;
    const startTime = this.startTime;
    if (!startDate || !startTime) {
      this.#clearPreviewDisplayTime();
      return;
    }

    this.#previewDisplayTime = formatShortTime(this.lang, startTime);
    this.requestUpdate();
  };

  #getHoverDetail(event: CustomEvent): {
    dayIndex: number;
    time: Temporal.PlainTime | null;
    clientX: number;
    clientY: number;
  } | null {
    return (
      (event.detail as {
        dayIndex: number;
        time: Temporal.PlainTime | null;
        clientX: number;
        clientY: number;
      } | null) ?? null
    );
  }

  #clearPreviewDisplayTime() {
    this.#previewDisplayTime = null;
    this.requestUpdate();
  }

  #hasValidHoverDayIndex(hover: { dayIndex: number }, viewPortDays: Temporal.PlainDate[]): boolean {
    const { dayIndex } = hover;
    return dayIndex != null && dayIndex >= 0 && dayIndex < viewPortDays.length;
  }

  render() {
    const dayInsets = this.dayInsets;
    const visibleDayInsets = dayInsets;
    const isFocusable = visibleDayInsets.length > 0;
    const canResizeStart = this.renderedDays.length > 1 && !this.interactionDisabled;
    const isDragging = this.interactionController.isDragging;
    const hasOffset = this.dragOffsetX !== 0 || this.dragOffsetY !== 0;
    const dragTransform =
      isDragging || hasOffset ? `translate(${this.dragOffsetX}px, ${this.dragOffsetY}px)` : "none";

    return html`
      <div
        class="interaction-surface"
        role="group"
        tabindex=${isFocusable ? "0" : "-1"}
        aria-hidden=${isFocusable ? "false" : "true"}
        ?inert=${!isFocusable}
        aria-label=${this.#interactionLabel}
        aria-describedby=${this.#keyboardHintId}
        aria-keyshortcuts=${this.interactionDisabled
          ? "Delete Backspace"
          : "Delete Backspace Control+Meta+ArrowUp Control+Meta+ArrowDown Control+Meta+ArrowLeft Control+Meta+ArrowRight Control+Shift+ArrowUp Control+Shift+ArrowDown"}
        style=${styleMap({
          transform: dragTransform,
          // Disable transform animation entirely to avoid snap/flash at drag end.
          transition: "none",
        })}
        @pointerdown=${this.interactionDisabled
          ? null
          : this.interactionController.pointerDownHandler}
        @pointermove=${this.interactionDisabled
          ? null
          : this.interactionController.pointerMoveHandler}
        @pointerup=${this.interactionDisabled ? null : this.interactionController.pointerUpHandler}
        @keydown=${this.interactionDisabled
          ? this.#handleDeleteOnlyKeydown
          : this.interactionController.keydownHandler}
      >
        <span id=${this.#keyboardHintId} class="keyboard-hint">
          Use Control Command and arrow keys to move this event. Use Control Shift and up or down
          arrow keys to resize the end date.
        </span>
        ${this.#renderEventCards(visibleDayInsets, canResizeStart)}
      </div>
    `;
  }

  #renderEventCards(
    visibleDayInsets: Array<{
      style: Record<string, string | number>;
      rowIndex: number;
      stackIndex: number;
    }>,
    canResizeStart: boolean,
  ) {
    if (!visibleDayInsets.length) return "";

    return visibleDayInsets.map((inset, index) =>
      this.#renderEventCard(inset, index, visibleDayInsets.length, canResizeStart),
    );
  }

  #isStackVisibleForDay(dayIndex: number, stackIndex: number): boolean {
    const dayCap = this.maxVisibleRowsByDay.get(dayIndex);
    if (typeof dayCap === "number" && Number.isFinite(dayCap)) {
      return stackIndex < dayCap;
    }
    return !Number.isFinite(this.maxVisibleRows) || stackIndex < this.maxVisibleRows;
  }

  #renderEventCard(
    inset: { style: Record<string, string | number>; rowIndex: number; stackIndex: number },
    index: number,
    total: number,
    canResizeStart: boolean,
  ) {
    const isFirst = index === 0;
    const isLast = index === total - 1;

    return html`
      <event-card
        .color=${this.color}
        .summary=${isFirst ? this.summary : ""}
        .time=${isFirst ? this.displayTime : ""}
        .recurring=${this.isRecurring}
        .exception=${this.isException}
        ?past=${this.isPast}
        .rsvp=${this.rsvp}
        style=${styleMap(inset.style)}
      >
        ${!this.interactionDisabled && isFirst && canResizeStart
          ? html`
              <resize-handle
                axis="horizontal"
                position="start"
                title="Resize start date"
              ></resize-handle>
            `
          : ""}
        ${!this.interactionDisabled && isLast
          ? html`
              <resize-handle
                axis="horizontal"
                position="end"
                title="Resize end date"
              ></resize-handle>
            `
          : ""}
      </event-card>
    `;
  }

  #handleDeleteOnlyKeydown = (event: KeyboardEvent) => {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as EventTarget | null;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable) return;
      const tagName = target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
    }
    event.preventDefault();
    this.dispatchEvent(
      new CustomEvent("delete", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  protected override onDragStart() {
    const viewDayStrings = this.viewDays.map((day) => day.toString());
    this.#lockedStackIndex = this.#getStackIndex(viewDayStrings, { ignoreLock: true });
  }

  protected override onDragEnd() {
    this.#refreshSiblingsStacking();
  }

  #getEventHeightPx(): number {
    const el = this.parentElement ?? this;
    const value = getComputedStyle(el).getPropertyValue("--_lc-event-height").trim();
    const px = parseFloat(value);
    return Number.isFinite(px) ? px : 32;
  }

  getInteractionStackOffsetY(): number {
    const startDate = this.startDate;
    if (!startDate) return 0;

    const viewDayStrings = this.viewDays.map((day) => day.toString());
    const dayIndex = viewDayStrings.indexOf(startDate.toString());
    if (dayIndex < 0) return 0;

    const rowIndex = this.daysPerRow > 0 ? Math.floor(dayIndex / this.daysPerRow) : 0;
    const stackIndex = this.#getStackIndexForPosition(viewDayStrings, rowIndex);
    return stackIndex * this.#getEventHeightPx();
  }

  get #interactionLabel(): string {
    const title = this.summary?.trim() || "Untitled all-day event";
    const time = this.displayTime?.trim();
    const baseLabel = time ? `${title}. ${time}` : title;
    const recurrenceLabel = this.isException
      ? "Exception to recurring series."
      : this.isRecurring
        ? "Recurring event."
        : "";
    const segments = [this.isPast ? "Past event." : "", recurrenceLabel, baseLabel].filter(Boolean);
    return segments.join(" ");
  }
}
