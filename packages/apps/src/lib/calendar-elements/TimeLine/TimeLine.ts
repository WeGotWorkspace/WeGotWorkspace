import {
  html,
  LitElement,
  nothing,
  type PropertyValues,
  type TemplateResult,
  unsafeCSS,
} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import componentStyle from "./TimeLine.css?inline";
import "../ResizeHandle/ResizeHandle";
import type {
  TimeLineLayout,
  TimelineEvent,
  TimelineEventCreateDetail,
  TimelineEventMoveCommitDetail,
  TimelineEventPreviewRange,
  TimelineEventResizeCommitDetail,
  TimelineGestureKind,
  TimelineGestureSignalDetail,
  TimelineResizeEdge,
} from "../types/TimeLine";
import { computeStaggerLayout } from "./StaggerLayout";

type TimelineResizeSession = {
  pointerId: number;
  handle: HTMLElement;
  eventIndex: number;
  edge: TimelineResizeEdge;
  /** Absolute grid time under the pointer at pointerdown (same basis as `ev.start` / `ev.end`). */
  originPointerGridT: number;
  initialStart: number;
  initialEnd: number;
  horiz: boolean;
  gridMax: number;
  gestureId: number;
};

type TimelineMoveSession = {
  pointerId: number;
  /** Host element so capture survives re-renders while the preview geometry updates. */
  captureTarget: HTMLElement;
  /**
   * Mouse sessions defer pointer capture until the first real pointermove: capturing on
   * pointerdown would retarget the trailing `click` to the host, so a plain click would never
   * reach the event card (breaking click-to-select). Touch-activated sessions capture
   * immediately — they only start after the long-press, when the gesture is unambiguous.
   */
  captured: boolean;
  eventIndex: number;
  originPointerGridT: number;
  /** Pointer position at pointerdown; raw deltas from here drive the free-following card. */
  originClientX: number;
  originClientY: number;
  initialStart: number;
  initialEnd: number;
  horiz: boolean;
  gridMax: number;
  gestureId: number;
};

type TimelineCreateSession = {
  pointerId: number;
  /** Host element so capture survives re-renders while the preview updates. */
  captureTarget: HTMLElement;
  originClientX: number;
  originClientY: number;
  /** Absolute grid time under the pointer at pointerdown (unsnapped). */
  originT: number;
  horiz: boolean;
  gridMax: number;
  /** Becomes true once the pointer travels past the drag threshold; plain clicks never commit. */
  dragging: boolean;
  gestureId: number;
};

/**
 * Touch pointer waiting for long-press activation of a move/create gesture. Until the timer
 * fires the pointer is untouched (no capture, no preventDefault), so composed interactions —
 * native panning where `--time-line-touch-action` allows it, or a wrapper's swipe handling —
 * keep working; travelling past the cancel distance abandons the gesture in their favour.
 */
type PendingTouchGesture = {
  pointerId: number;
  kind: "move" | "create";
  /** Event index for a pending move; unused for create. */
  eventIndex: number;
  originClientX: number;
  originClientY: number;
  timerId: number;
};

/** Pointer travel (px) required before a create gesture starts producing a preview. */
const CREATE_DRAG_THRESHOLD_PX = 4;

/** Touch hold (ms) before a move/create gesture activates (grid-view parity). */
const TOUCH_GESTURE_ACTIVATION_MS = 160;

/** Touch travel (px) before activation that abandons the pending gesture (pan/swipe wins). */
const TOUCH_GESTURE_CANCEL_DISTANCE_PX = 10;

type TimelineCellEventSegment = {
  ev: TimelineEvent;
  index: number;
  segIndex: number;
  segStart: number;
  segEnd: number;
  rowSpan: number;
  showResizeStart: boolean;
  showResizeEnd: boolean;
};

type LaneLayout = {
  laneCount: number;
  laneByEventIndex: number[];
  /** `stagger` only: per-event same-start group size (width divisor; overrides the cell value). */
  laneCountByEventIndex?: number[];
  /** `stagger` only: per-event indent depth (earlier-starting events still running). */
  indentByEventIndex?: number[];
};

/** Non-`default` layouts that assign lanes / placement per event. */
type LaneMode = Exclude<TimeLineLayout, "default">;

type TimeLineGridLayout = {
  horiz: boolean;
  span: number;
  cellCount: number;
  gridMax: number;
};

/**
 * Structural shadow elements are exposed as CSS shadow parts for external styling:
 * `viewport`, `cells`, `cell`, `cell-header`, `cell-main`, `cell-footer`, `event`,
 * `marker`, `create-preview`, `move-ghost`. Content rendered by the header/footer/event
 * template properties lives in this shadow root too, so those templates can carry their own
 * `part` attributes and be styled by the composing component via `time-line::part(...)`.
 *
 * Besides the commit events (`timeline-event-move` / `-resize` / `-create`), active pointer
 * gestures are signalled generically via `timeline-gesture-start` / `timeline-gesture-end`
 * (bubbling + composed, detail `{ kind, gestureId }`) so wrappers can suspend conflicting
 * interactions (e.g. swipe navigation) while a drag is live. Touch pointers activate
 * move/create gestures with a short hold (mirroring the calendar grid views); before
 * activation the pointer is left alone so panning/swiping keeps working where
 * `--time-line-touch-action` allows it.
 */
@customElement("time-line")
export class TimeLine extends LitElement {
  @property({ type: Number }) accessor max = 100;
  @property({ type: Number }) accessor step = 10;

  // number of cells
  @property({ type: Number }) accessor cells = 3;

  @property({ type: Number }) accessor columns = 7;

  @property({ attribute: false })
  accessor headerTemplate: ((i: number) => TemplateResult) | undefined;

  /**
   * Renders event content. While a move/resize gesture is in progress, the dragged event is
   * invoked with `preview` carrying the live numeric range so templates can show live labels;
   * `ev` keeps the committed range.
   */
  @property({ attribute: false })
  accessor eventTemplate: (
    ev: TimelineEvent,
    preview?: TimelineEventPreviewRange,
  ) => TemplateResult = () => html``;

  @property({ attribute: false })
  accessor footerTemplate:
    | ((
        cellIndex: number,
        visibleEvents: TimelineEvent[],
        allCellEvents: TimelineEvent[],
      ) => TemplateResult)
    | undefined;

  @property({ type: String, reflect: true })
  accessor flow: "vertical" | "horizontal" = "vertical";

  /**
   * `timeline`: each overlapping event gets its own track (swimlane).
   * Horizontal: vertical lanes by time; vertical: horizontal columns by time.
   * `masonry`: pack overlaps into the fewest tracks — each event takes the lowest free lane at its
   * start (still-active intervals `end > start` share space evenly across that lane count).
   * `stagger` (vertical flow): calendar-style overlaps — events with identical starts split the
   * cell width evenly; a later-starting overlap keeps near-full width, indented at its inline
   * start by `--time-line-stagger-indent` (default 12px) per still-active earlier event and
   * stacked above it, so the earlier event's summary stays readable. Horizontal flow has no
   * stagger geometry and falls back to `masonry` lanes.
   */
  @property({ type: String, reflect: true })
  accessor layout: TimeLineLayout = "default";

  /** With horizontal `timeline` / `masonry`, omit event lanes that do not fit the cell (ResizeObserver). */
  @property({ type: String, reflect: true })
  accessor height: "auto" | undefined = undefined;

  @property({ type: Array })
  accessor events: TimelineEvent[] = [];

  /**
   * Marker values on the absolute axis (same coordinate space as event `start`/`end`; cell `i`
   * spans `[i * max, (i + 1) * max)`). Each renders a thin line inside its cell, themeable via
   * `--time-line-marker-color`. Values outside `[0, cells * max)` are ignored. Pass one value
   * per cell at the same local time (see `currentTimeMarkersAcrossDays`) for a full-width
   * now-indicator. The cell in `markerTodayCell` gets full emphasis + a lead dot
   * (`.marker--anchor`); every other marker is dimmed (`.marker--dimmed`).
   */
  @property({ type: Array })
  accessor markers: number[] = [];

  /**
   * Day-column index whose marker is today’s (full color + lead dot). Other markers render
   * dimmed. `-1` (default) means today is not in view — every marker is dimmed, no lead dot.
   */
  @property({ type: Number, attribute: "marker-today-cell" })
  accessor markerTodayCell = -1;

  /**
   * Axis units between subdivision gridlines inside each cell, drawn perpendicular to the flow
   * (horizontal lines in vertical flow, vertical lines in horizontal flow). `0` (default)
   * disables them. Lines land on multiples of `gridInterval` on each cell's local `[0, max]`
   * axis and respect the axis window, so they stay aligned with any composed axis labels.
   * Themeable via `--time-line-grid-color`; they render behind events, markers and previews.
   */
  @property({ type: Number, attribute: "grid-interval" })
  accessor gridInterval = 0;

  /**
   * Start of the visible sub-range of each cell's `[0, max]` axis. Defaults to 0.
   * Only applied in vertical flow (v1); horizontal flow always shows the full range.
   */
  @property({ type: Number, attribute: "window-start" })
  accessor windowStart = 0;

  /**
   * End of the visible sub-range of each cell's `[0, max]` axis. `null` means `max`.
   * Only applied in vertical flow (v1); horizontal flow always shows the full range.
   */
  @property({ type: Number, attribute: "window-end" })
  accessor windowEnd: number | null = null;

  /** Optional hook; the same data is also dispatched as `timeline-event-resize`. */
  @property({ attribute: false })
  accessor onTimelineEventResize: ((detail: TimelineEventResizeCommitDetail) => void) | undefined;

  /** Optional hook; the same data is also dispatched as `timeline-event-move`. */
  @property({ attribute: false })
  accessor onTimelineEventMove: ((detail: TimelineEventMoveCommitDetail) => void) | undefined;

  /** Optional hook; the same data is also dispatched as `timeline-event-create`. */
  @property({ attribute: false })
  accessor onTimelineEventCreate: ((detail: TimelineEventCreateDetail) => void) | undefined;

  @state()
  private accessor resizePreviewByIndex: ReadonlyMap<
    number,
    { start: number; end: number }
  > | null = null;

  /** While moving an event, all its segments share the dragging affordance. */
  @state()
  private accessor draggingEventIndex: number | null = null;

  /**
   * Raw pointer delta (px) since move-gesture pointerdown. The dragged card keeps its pre-drag
   * geometry and follows the pointer freely via this translate, while the snapped preview
   * renders separately as the `.move-ghost` drop target (grid-view drag feel).
   */
  @state()
  private accessor moveDragOffset: { x: number; y: number } | null = null;

  /** Snapped range shown while a drag-to-create gesture is in progress. */
  @state()
  private accessor createPreview: { start: number; end: number } | null = null;

  @state()
  private accessor cellVisibleLanes: number[] = [];

  private cellsResizeObserver: ResizeObserver | null = null;

  #resizeSession: TimelineResizeSession | null = null;

  #moveSession: TimelineMoveSession | null = null;

  #createSession: TimelineCreateSession | null = null;

  #pendingTouchGesture: PendingTouchGesture | null = null;

  /** Monotonic id pairing each `timeline-gesture-start` with its `timeline-gesture-end`. */
  #gestureIdCounter = 0;

  static styles = unsafeCSS(componentStyle);

  /**
   * While a touch-activated gesture is live, block native touch scrolling (consumers may relax
   * `--time-line-touch-action` to allow panning; an active gesture must still own the pointer).
   */
  readonly #onGestureTouchMove = (e: TouchEvent) => {
    if (e.cancelable) e.preventDefault();
  };

  #attachGestureTouchMoveBlocker() {
    window.addEventListener("touchmove", this.#onGestureTouchMove, {
      passive: false,
      capture: true,
    });
  }

  #detachGestureTouchMoveBlocker() {
    window.removeEventListener("touchmove", this.#onGestureTouchMove, true);
  }

  #emitGestureSignal(phase: "start" | "end", kind: TimelineGestureKind, gestureId: number) {
    this.dispatchEvent(
      new CustomEvent<TimelineGestureSignalDetail>(`timeline-gesture-${phase}`, {
        bubbles: true,
        composed: true,
        detail: { kind, gestureId },
      }),
    );
  }

  readonly #onPendingTouchPointerMove = (e: PointerEvent) => {
    const pending = this.#pendingTouchGesture;
    if (!pending || e.pointerId !== pending.pointerId) return;
    const dx = e.clientX - pending.originClientX;
    const dy = e.clientY - pending.originClientY;
    if (dx * dx + dy * dy >= TOUCH_GESTURE_CANCEL_DISTANCE_PX * TOUCH_GESTURE_CANCEL_DISTANCE_PX) {
      this.#cancelPendingTouchGesture();
    }
  };

  readonly #onPendingTouchPointerEnd = (e: PointerEvent) => {
    const pending = this.#pendingTouchGesture;
    if (!pending || e.pointerId !== pending.pointerId) return;
    this.#cancelPendingTouchGesture();
  };

  #attachPendingTouchListeners() {
    window.addEventListener("pointermove", this.#onPendingTouchPointerMove, true);
    window.addEventListener("pointerup", this.#onPendingTouchPointerEnd, true);
    window.addEventListener("pointercancel", this.#onPendingTouchPointerEnd, true);
  }

  #detachPendingTouchListeners() {
    window.removeEventListener("pointermove", this.#onPendingTouchPointerMove, true);
    window.removeEventListener("pointerup", this.#onPendingTouchPointerEnd, true);
    window.removeEventListener("pointercancel", this.#onPendingTouchPointerEnd, true);
  }

  #beginPendingTouchGesture(kind: "move" | "create", eventIndex: number, e: PointerEvent) {
    this.#cancelPendingTouchGesture();
    const timerId = window.setTimeout(
      () => this.#activatePendingTouchGesture(),
      TOUCH_GESTURE_ACTIVATION_MS,
    );
    this.#pendingTouchGesture = {
      pointerId: e.pointerId,
      kind,
      eventIndex,
      originClientX: e.clientX,
      originClientY: e.clientY,
      timerId,
    };
    this.#attachPendingTouchListeners();
  }

  #cancelPendingTouchGesture() {
    const pending = this.#pendingTouchGesture;
    if (!pending) return;
    clearTimeout(pending.timerId);
    this.#detachPendingTouchListeners();
    this.#pendingTouchGesture = null;
  }

  #activatePendingTouchGesture() {
    const pending = this.#pendingTouchGesture;
    if (!pending) return;
    this.#detachPendingTouchListeners();
    this.#pendingTouchGesture = null;
    if (pending.kind === "move") {
      this.#startMoveSession(
        pending.eventIndex,
        pending.pointerId,
        pending.originClientX,
        pending.originClientY,
        true,
      );
      return;
    }
    this.#startCreateSession(pending.pointerId, pending.originClientX, pending.originClientY, true);
  }

  readonly #onResizeWindowPointerMove = (e: PointerEvent) => {
    const session = this.#resizeSession;
    if (!session || e.pointerId !== session.pointerId) return;
    if (e.cancelable) e.preventDefault();
    this.#applyResizePointer(e.clientX, e.clientY, session);
  };

  readonly #onResizeWindowPointerEnd = (e: PointerEvent) => {
    const session = this.#resizeSession;
    if (!session || e.pointerId !== session.pointerId) return;
    this.#finishResizeGesture(session, e.clientX, e.clientY, e.type === "pointercancel");
  };

  readonly #onResizeWindowKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const session = this.#resizeSession;
    if (!session) return;
    e.preventDefault();
    e.stopPropagation();
    this.#finishResizeGesture(session, 0, 0, true);
  };

  readonly #onMoveWindowPointerMove = (e: PointerEvent) => {
    const session = this.#moveSession;
    if (!session || e.pointerId !== session.pointerId) return;
    if (e.cancelable) e.preventDefault();
    if (!session.captured) {
      this.#trySetPointerCapture(session.captureTarget, session.pointerId);
      session.captured = true;
    }
    this.#applyMovePointer(e.clientX, e.clientY, session);
  };

  readonly #onMoveWindowPointerEnd = (e: PointerEvent) => {
    const session = this.#moveSession;
    if (!session || e.pointerId !== session.pointerId) return;
    this.#finishMoveGesture(session, e.clientX, e.clientY, e.type === "pointercancel");
  };

  readonly #onMoveWindowKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const session = this.#moveSession;
    if (!session) return;
    e.preventDefault();
    e.stopPropagation();
    this.#finishMoveGesture(session, 0, 0, true);
  };

  readonly #onCreateWindowPointerMove = (e: PointerEvent) => {
    const session = this.#createSession;
    if (!session || e.pointerId !== session.pointerId) return;
    if (e.cancelable) e.preventDefault();
    this.#applyCreatePointer(e.clientX, e.clientY, session);
  };

  readonly #onCreateWindowPointerEnd = (e: PointerEvent) => {
    const session = this.#createSession;
    if (!session || e.pointerId !== session.pointerId) return;
    this.#finishCreateGesture(session, e.clientX, e.clientY, e.type === "pointercancel");
  };

  readonly #onCreateWindowKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const session = this.#createSession;
    if (!session) return;
    e.preventDefault();
    e.stopPropagation();
    this.#cancelCreateGesture(session);
  };

  private laneClip() {
    return (
      this.height === "auto" &&
      this.flow === "horizontal" &&
      (this.layout === "timeline" || this.layout === "masonry" || this.layout === "stagger")
    );
  }

  private measureLaneCaps() {
    if (!this.laneClip()) return;
    const n = Math.max(1, this.cells);
    const br = this.renderRoot?.querySelector(".event")?.getBoundingClientRect();
    let lh =
      br && br.height > 0
        ? br.height
        : parseFloat(getComputedStyle(this).getPropertyValue("--__event-height")) || 32;
    lh = Math.max(lh, 1);
    const next = new Array<number>(n).fill(Infinity);
    for (const node of (this.renderRoot as ShadowRoot).querySelectorAll(".cell")) {
      const i = Number((node as HTMLElement).dataset.cell);
      if (!Number.isFinite(i) || i < 0 || i >= n) continue;
      const main = (node as HTMLElement).querySelector(".cell-main") as HTMLElement | null;
      const ch = (main?.clientHeight ?? (node as HTMLElement).clientHeight) || 0;
      next[i] = ch <= 0 ? Infinity : Math.floor(ch / lh);
    }
    if (
      next.length === this.cellVisibleLanes.length &&
      next.every((v, j) => v === this.cellVisibleLanes[j])
    )
      return;
    this.cellVisibleLanes = next;
  }

  disconnectedCallback() {
    const move = this.#moveSession;
    if (move) {
      this.#releasePointerCaptureSafe(move.captureTarget, move.pointerId);
    }
    const create = this.#createSession;
    if (create) {
      this.#releasePointerCaptureSafe(create.captureTarget, create.pointerId);
    }
    this.#cancelPendingTouchGesture();
    this.#detachResizeWindowListeners();
    this.#detachMoveWindowListeners();
    this.#detachCreateWindowListeners();
    this.#detachGestureTouchMoveBlocker();
    this.#resizeSession = null;
    this.#moveSession = null;
    this.#createSession = null;
    this.resizePreviewByIndex = null;
    this.draggingEventIndex = null;
    this.moveDragOffset = null;
    this.createPreview = null;
    this.cellsResizeObserver?.disconnect();
    this.cellsResizeObserver = null;
    super.disconnectedCallback();
  }

  #detachResizeWindowListeners() {
    window.removeEventListener("pointermove", this.#onResizeWindowPointerMove, true);
    window.removeEventListener("pointerup", this.#onResizeWindowPointerEnd, true);
    window.removeEventListener("pointercancel", this.#onResizeWindowPointerEnd, true);
    window.removeEventListener("keydown", this.#onResizeWindowKeyDown, true);
  }

  #detachMoveWindowListeners() {
    window.removeEventListener("pointermove", this.#onMoveWindowPointerMove, true);
    window.removeEventListener("pointerup", this.#onMoveWindowPointerEnd, true);
    window.removeEventListener("pointercancel", this.#onMoveWindowPointerEnd, true);
    window.removeEventListener("keydown", this.#onMoveWindowKeyDown, true);
  }

  #detachCreateWindowListeners() {
    window.removeEventListener("pointermove", this.#onCreateWindowPointerMove, true);
    window.removeEventListener("pointerup", this.#onCreateWindowPointerEnd, true);
    window.removeEventListener("pointercancel", this.#onCreateWindowPointerEnd, true);
    window.removeEventListener("keydown", this.#onCreateWindowKeyDown, true);
  }

  #minGridStep(): number {
    return this.step > 0 ? this.step : 1;
  }

  #snapTime(t: number): number {
    const step = this.#minGridStep();
    return Math.round(t / step) * step;
  }

  #eventsForLayout(): TimelineEvent[] {
    const preview = this.resizePreviewByIndex;
    if (!preview?.size) return this.events;
    // The event in a MOVE gesture keeps its pre-drag geometry — the card free-follows the
    // pointer via `moveDragOffset` and the snapped preview renders as the ghost instead.
    // Resize previews still reshape the event itself (snapped, grid-view parity).
    const movingIndex = this.#moveSession?.eventIndex ?? null;
    return this.events.map((ev, i) => {
      if (i === movingIndex) return ev;
      const p = preview.get(i);
      return p ? { ...ev, start: p.start, end: p.end } : ev;
    });
  }

  #attachResizeWindowListeners() {
    window.addEventListener("pointermove", this.#onResizeWindowPointerMove, true);
    window.addEventListener("pointerup", this.#onResizeWindowPointerEnd, true);
    window.addEventListener("pointercancel", this.#onResizeWindowPointerEnd, true);
    window.addEventListener("keydown", this.#onResizeWindowKeyDown, true);
  }

  #attachMoveWindowListeners() {
    window.addEventListener("pointermove", this.#onMoveWindowPointerMove, true);
    window.addEventListener("pointerup", this.#onMoveWindowPointerEnd, true);
    window.addEventListener("pointercancel", this.#onMoveWindowPointerEnd, true);
    window.addEventListener("keydown", this.#onMoveWindowKeyDown, true);
  }

  #attachCreateWindowListeners() {
    window.addEventListener("pointermove", this.#onCreateWindowPointerMove, true);
    window.addEventListener("pointerup", this.#onCreateWindowPointerEnd, true);
    window.addEventListener("pointercancel", this.#onCreateWindowPointerEnd, true);
    window.addEventListener("keydown", this.#onCreateWindowKeyDown, true);
  }

  #readGridLayout(): TimeLineGridLayout {
    const horiz = this.flow === "horizontal";
    const span = this.max > 0 ? this.max : 1;
    const cellCount = Math.max(1, this.cells);
    return { horiz, span, cellCount, gridMax: span * cellCount };
  }

  #pointerGridTime(
    clientX: number,
    clientY: number,
    layout: TimeLineGridLayout = this.#readGridLayout(),
  ): number {
    return this.#gridTimeFromClient(
      clientX,
      clientY,
      layout.span,
      layout.cellCount,
      layout.horiz,
      layout.gridMax,
    );
  }

  #releasePointerCaptureSafe(target: Element, pointerId: number) {
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      // Ignore if capture was already released or unsupported.
    }
  }

  #beginSingleEventResizePreview(index: number, start: number, end: number) {
    const preview = new Map<number, { start: number; end: number }>();
    preview.set(index, { start, end });
    this.resizePreviewByIndex = preview;
  }

  #mergeResizePreviewRange(index: number, range: { start: number; end: number }) {
    const next = new Map(this.resizePreviewByIndex ?? []);
    next.set(index, range);
    this.resizePreviewByIndex = next;
  }

  /**
   * Effective visible sub-range of each cell's `[0, span]` axis. Returns the full range when no
   * (valid) window is set or in horizontal flow, where the window is not supported yet (v1).
   */
  #effectiveWindow(span: number): { w0: number; w1: number } {
    if (this.flow === "horizontal") return { w0: 0, w1: span };
    const w0 = Math.max(0, Math.min(this.windowStart, span));
    const w1 = Math.max(0, Math.min(this.windowEnd ?? span, span));
    if (!(Number.isFinite(w0) && Number.isFinite(w1)) || w1 <= w0) return { w0: 0, w1: span };
    return { w0, w1 };
  }

  /** Percent position of a cell-local time within the visible window (may fall outside 0–100). */
  #axisPct(tLocal: number, w0: number, w1: number): number {
    const range = w1 - w0;
    return range > 0 ? ((tLocal - w0) / range) * 100 : 0;
  }

  /** Valid `gridInterval` (subdivision gridlines enabled), or 0 when disabled. */
  #effectiveGridInterval(): number {
    const interval = Number(this.gridInterval);
    return Number.isFinite(interval) && interval > 0 ? interval : 0;
  }

  /**
   * Inline custom properties driving the pure-CSS subdivision gridlines (see `.cell-main--grid`
   * in TimeLine.css). The background tile is `gridInterval / windowRange` of the cell's axis;
   * the line sits at the end of each tile, except when the window starts off-interval — then
   * the phase shifts so lines keep landing on absolute multiples of `gridInterval`.
   */
  #gridLineVars(span: number): string {
    const interval = this.#effectiveGridInterval();
    if (!interval) return "";
    const { w0, w1 } = this.#effectiveWindow(span);
    const range = w1 - w0;
    if (range <= 0) return "";
    const sizePct = (interval / range) * 100;
    const rem = ((w0 % interval) + interval) % interval;
    const posPct = rem === 0 ? 100 : ((interval - rem) / interval) * 100;
    return `;--__grid-size:${sizePct}%;--__grid-pos:${posPct}%`;
  }

  /**
   * Maps a screen point to absolute time on the grid [0, gridMax], using each cell’s `.cell-main`
   * as that cell’s span so resizing stays correct when the pointer moves across cells. When an
   * axis window is active, the cell geometry represents `[w0, w1]` instead of `[0, span]`.
   * In horizontal flow with RTL direction, time increases towards the left (logical insets).
   */
  #gridSampleFromCellMain(
    clientX: number,
    clientY: number,
    main: HTMLElement,
    cellIndex: number,
    span: number,
    horiz: boolean,
    rtl: boolean,
  ): { distSq: number; t: number } | null {
    const r = main.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const cx = Math.min(Math.max(clientX, r.left), r.right);
    const cy = Math.min(Math.max(clientY, r.top), r.bottom);
    const dx = clientX - cx;
    const dy = clientY - cy;
    const distSq = dx * dx + dy * dy;
    const along = horiz ? (rtl ? r.right - cx : cx - r.left) / r.width : (cy - r.top) / r.height;
    const frac = Math.min(1, Math.max(0, Number.isFinite(along) ? along : 0));
    const { w0, w1 } = this.#effectiveWindow(span);
    const t = cellIndex * span + w0 + frac * (w1 - w0);
    return { distSq, t };
  }

  #gridTimeFromClient(
    clientX: number,
    clientY: number,
    span: number,
    cellCount: number,
    horiz: boolean,
    gridMax: number,
  ): number {
    const root = this.renderRoot as ShadowRoot | undefined;
    if (!root) return 0;

    const rtl = horiz && getComputedStyle(this).direction === "rtl";
    let bestT = 0;
    let bestDistSq = Infinity;

    for (const cellEl of root.querySelectorAll(".cell")) {
      if (!(cellEl instanceof HTMLElement)) continue;
      const cellIndex = Number(cellEl.dataset.cell);
      if (!Number.isFinite(cellIndex) || cellIndex < 0 || cellIndex >= cellCount) continue;
      const main = cellEl.querySelector(".cell-main");
      if (!(main instanceof HTMLElement)) continue;
      const sample = this.#gridSampleFromCellMain(
        clientX,
        clientY,
        main,
        cellIndex,
        span,
        horiz,
        rtl,
      );
      if (!sample) continue;
      if (sample.distSq < bestDistSq) {
        bestDistSq = sample.distSq;
        bestT = sample.t;
      }
    }

    if (bestDistSq === Infinity) return 0;
    return Math.max(0, Math.min(gridMax, bestT));
  }

  #clampResizeRangeToMinDuration(
    nextStart: number,
    nextEnd: number,
    minStep: number,
    edge: TimelineResizeEdge,
    gridMax: number,
  ): { start: number; end: number } {
    let start = nextStart;
    let end = nextEnd;
    if (end - start < minStep) {
      if (edge === "start") {
        start = Math.max(0, end - minStep);
      } else {
        end = Math.min(gridMax, start + minStep);
      }
    }
    if (start >= end) {
      if (edge === "start") {
        start = Math.max(0, end - minStep);
      } else {
        end = Math.min(gridMax, start + minStep);
      }
    }
    return { start, end };
  }

  #resizedRangeForPointer(
    session: TimelineResizeSession,
    pointerT: number,
  ): {
    start: number;
    end: number;
  } | null {
    const ev = this.events[session.eventIndex];
    if (!ev) return null;

    const deltaT = pointerT - session.originPointerGridT;
    let nextStart = session.initialStart;
    let nextEnd = session.initialEnd;
    if (session.edge === "start") {
      nextStart = this.#snapTime(session.initialStart + deltaT);
    } else {
      nextEnd = this.#snapTime(session.initialEnd + deltaT);
    }

    const minStep = this.#minGridStep();
    nextStart = Math.max(0, Math.min(nextStart, session.gridMax));
    nextEnd = Math.max(0, Math.min(nextEnd, session.gridMax));

    return this.#clampResizeRangeToMinDuration(
      nextStart,
      nextEnd,
      minStep,
      session.edge,
      session.gridMax,
    );
  }

  #applyResizePointer(clientX: number, clientY: number, session: TimelineResizeSession) {
    const span = this.max > 0 ? this.max : 1;
    const cellCount = Math.max(1, this.cells);
    const pointerT = this.#gridTimeFromClient(
      clientX,
      clientY,
      span,
      cellCount,
      session.horiz,
      session.gridMax,
    );
    const range = this.#resizedRangeForPointer(session, pointerT);
    if (!range) return;
    this.#mergeResizePreviewRange(session.eventIndex, range);
  }

  #emitTimelineResizeCommit(detail: TimelineEventResizeCommitDetail) {
    this.dispatchEvent(
      new CustomEvent<TimelineEventResizeCommitDetail>("timeline-event-resize", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
    this.onTimelineEventResize?.(detail);
  }

  #finishResizeGesture(
    session: TimelineResizeSession,
    clientX: number,
    clientY: number,
    cancelled: boolean,
  ) {
    this.#detachResizeWindowListeners();
    this.#detachGestureTouchMoveBlocker();
    this.#resizeSession = null;
    this.#releasePointerCaptureSafe(session.handle, session.pointerId);
    this.#emitGestureSignal("end", "resize", session.gestureId);

    if (!cancelled) {
      this.#applyResizePointer(clientX, clientY, session);
    }

    const preview = cancelled ? undefined : this.resizePreviewByIndex?.get(session.eventIndex);
    const previousStart = session.initialStart;
    const previousEnd = session.initialEnd;
    this.resizePreviewByIndex = null;

    if (cancelled || !preview) return;
    if (preview.start === previousStart && preview.end === previousEnd) return;

    this.#emitTimelineResizeCommit({
      index: session.eventIndex,
      edge: session.edge,
      start: preview.start,
      end: preview.end,
      previousStart,
      previousEnd,
    });
  }

  #movedStartBounds(session: TimelineMoveSession, duration: number, minStep: number) {
    if (duration > minStep) {
      return { minStart: -duration + minStep, maxStart: session.gridMax - minStep };
    }
    return {
      minStart: Math.min(0, session.initialStart),
      maxStart: Math.max(session.gridMax, session.initialEnd) - duration,
    };
  }

  #movedRangeForPointer(
    session: TimelineMoveSession,
    pointerT: number,
  ): {
    start: number;
    end: number;
  } | null {
    const ev = this.events[session.eventIndex];
    if (!ev) return null;

    const deltaT = pointerT - session.originPointerGridT;
    const duration = session.initialEnd - session.initialStart;
    const minStep = this.#minGridStep();
    let nextStart = this.#snapTime(session.initialStart + deltaT);
    const { minStart, maxStart } = this.#movedStartBounds(session, duration, minStep);
    nextStart = Math.max(minStart, Math.min(nextStart, maxStart));
    return { start: nextStart, end: nextStart + duration };
  }

  #applyMovePointer(clientX: number, clientY: number, session: TimelineMoveSession) {
    // Raw (unsnapped) delta for the free-following card.
    this.moveDragOffset = {
      x: clientX - session.originClientX,
      y: clientY - session.originClientY,
    };
    const span = this.max > 0 ? this.max : 1;
    const cellCount = Math.max(1, this.cells);
    const pointerT = this.#gridTimeFromClient(
      clientX,
      clientY,
      span,
      cellCount,
      session.horiz,
      session.gridMax,
    );
    const range = this.#movedRangeForPointer(session, pointerT);
    if (!range) return;
    this.#mergeResizePreviewRange(session.eventIndex, range);
  }

  #emitTimelineMoveCommit(detail: TimelineEventMoveCommitDetail) {
    this.dispatchEvent(
      new CustomEvent<TimelineEventMoveCommitDetail>("timeline-event-move", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
    this.onTimelineEventMove?.(detail);
  }

  #finishMoveGesture(
    session: TimelineMoveSession,
    clientX: number,
    clientY: number,
    cancelled: boolean,
  ) {
    this.#detachMoveWindowListeners();
    this.#detachGestureTouchMoveBlocker();
    this.#moveSession = null;
    this.#releasePointerCaptureSafe(session.captureTarget, session.pointerId);
    this.draggingEventIndex = null;
    this.#emitGestureSignal("end", "move", session.gestureId);

    if (!cancelled) {
      this.#applyMovePointer(clientX, clientY, session);
    }
    this.moveDragOffset = null;

    const preview = cancelled ? undefined : this.resizePreviewByIndex?.get(session.eventIndex);
    const previousStart = session.initialStart;
    const previousEnd = session.initialEnd;
    this.resizePreviewByIndex = null;

    if (cancelled || !preview) return;
    if (preview.start === previousStart && preview.end === previousEnd) return;

    this.#emitTimelineMoveCommit({
      index: session.eventIndex,
      start: preview.start,
      end: preview.end,
      previousStart,
      previousEnd,
    });
  }

  /**
   * Range between the gesture origin and the pointer, snapped outward to `step` with a minimum
   * duration of one `step`, clamped to the grid.
   */
  #createRangeForPointer(
    session: TimelineCreateSession,
    pointerT: number,
  ): { start: number; end: number } {
    const step = this.#minGridStep();
    const lo = Math.min(session.originT, pointerT);
    const hi = Math.max(session.originT, pointerT);
    let start = Math.floor(lo / step) * step;
    let end = Math.ceil(hi / step) * step;
    if (end - start < step) end = start + step;
    start = Math.max(0, start);
    end = Math.min(session.gridMax, end);
    if (end - start < step) start = Math.max(0, end - step);
    return { start, end };
  }

  #applyCreatePointer(clientX: number, clientY: number, session: TimelineCreateSession) {
    if (!session.dragging) {
      const dx = clientX - session.originClientX;
      const dy = clientY - session.originClientY;
      if (dx * dx + dy * dy < CREATE_DRAG_THRESHOLD_PX * CREATE_DRAG_THRESHOLD_PX) return;
      session.dragging = true;
      this.#emitGestureSignal("start", "create", session.gestureId);
    }
    const span = this.max > 0 ? this.max : 1;
    const cellCount = Math.max(1, this.cells);
    const pointerT = this.#gridTimeFromClient(
      clientX,
      clientY,
      span,
      cellCount,
      session.horiz,
      session.gridMax,
    );
    this.createPreview = this.#createRangeForPointer(session, pointerT);
  }

  #emitTimelineCreateCommit(detail: TimelineEventCreateDetail) {
    this.dispatchEvent(
      new CustomEvent<TimelineEventCreateDetail>("timeline-event-create", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
    this.onTimelineEventCreate?.(detail);
  }

  #finishCreateGesture(
    session: TimelineCreateSession,
    clientX: number,
    clientY: number,
    cancelled: boolean,
  ) {
    this.#detachCreateWindowListeners();
    this.#detachGestureTouchMoveBlocker();
    this.#createSession = null;
    this.#releasePointerCaptureSafe(session.captureTarget, session.pointerId);

    if (!cancelled) {
      this.#applyCreatePointer(clientX, clientY, session);
    }
    if (session.dragging) this.#emitGestureSignal("end", "create", session.gestureId);

    const range = cancelled || !session.dragging ? null : this.createPreview;
    this.createPreview = null;
    if (!range) return;

    this.#emitTimelineCreateCommit({ start: range.start, end: range.end });
  }

  #cancelCreateGesture(session: TimelineCreateSession) {
    this.#detachCreateWindowListeners();
    this.#detachGestureTouchMoveBlocker();
    this.#createSession = null;
    this.#releasePointerCaptureSafe(session.captureTarget, session.pointerId);
    if (session.dragging) this.#emitGestureSignal("end", "create", session.gestureId);
    this.createPreview = null;
  }

  #interactiveControlUnderPointer(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        'a[href], button:not([disabled]), input, textarea, select, [contenteditable="true"]',
      ),
    );
  }

  #composedPathContainsResizeHandle(path: EventTarget[]): boolean {
    return path.some((n) => n instanceof Element && n.localName === "resize-handle");
  }

  #trySetPointerCapture(target: Element, pointerId: number) {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Synthetic pointers may not support capture.
    }
  }

  #resizeHandleFromComposedPath(path: EventTarget[]): HTMLElement | null {
    const handle = path.find((n) => n instanceof HTMLElement && n.localName === "resize-handle");
    return handle instanceof HTMLElement ? handle : null;
  }

  #resizeEdgeFromHandle(handle: HTMLElement): TimelineResizeEdge | null {
    const position = handle.getAttribute("position");
    return position === "start" || position === "end" ? position : null;
  }

  #onEventBodyPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.#resizeSession || this.#moveSession || this.#pendingTouchGesture) return;
    if (this.#interactiveControlUnderPointer(e.target)) return;
    if (this.#composedPathContainsResizeHandle(e.composedPath())) return;

    const eventEl = e.currentTarget;
    if (!(eventEl instanceof HTMLElement)) return;

    const index = Number(eventEl.dataset.index);
    if (!Number.isFinite(index) || index < 0 || index >= this.events.length) return;

    const ev = this.events[index];
    if (!ev) return;

    // Touch: hold to activate (grid-view parity); before activation the pointer stays free
    // for native panning / a wrapper's swipe handling, and travelling cancels the gesture.
    if (e.pointerType === "touch") {
      this.#beginPendingTouchGesture("move", index, e);
      return;
    }

    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    this.#startMoveSession(index, e.pointerId, e.clientX, e.clientY, false);
  };

  #startMoveSession(
    index: number,
    pointerId: number,
    clientX: number,
    clientY: number,
    touchActivated: boolean,
  ) {
    const ev = this.events[index];
    if (!ev) return;

    // Mouse: capture is deferred to the first pointermove (see TimelineMoveSession.captured)
    // so a movement-free click still reaches the event card for click-to-select.
    if (touchActivated) this.#trySetPointerCapture(this, pointerId);

    const layout = this.#readGridLayout();
    const originPointerGridT = this.#pointerGridTime(clientX, clientY, layout);
    const gestureId = ++this.#gestureIdCounter;

    this.#moveSession = {
      pointerId,
      captureTarget: this,
      captured: touchActivated,
      eventIndex: index,
      originPointerGridT,
      originClientX: clientX,
      originClientY: clientY,
      initialStart: ev.start,
      initialEnd: ev.end,
      horiz: layout.horiz,
      gridMax: layout.gridMax,
      gestureId,
    };

    this.draggingEventIndex = index;
    this.moveDragOffset = { x: 0, y: 0 };
    this.#beginSingleEventResizePreview(index, ev.start, ev.end);
    this.#attachMoveWindowListeners();
    if (touchActivated) this.#attachGestureTouchMoveBlocker();
    this.#emitGestureSignal("start", "move", gestureId);
  }

  #onResizeHandlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;

    const handle = this.#resizeHandleFromComposedPath(e.composedPath());
    if (!handle) return;

    const eventEl = handle.closest(".event");
    if (!(eventEl instanceof HTMLElement)) return;

    const index = Number(eventEl.dataset.index);
    if (!Number.isFinite(index) || index < 0 || index >= this.events.length) return;

    const edge = this.#resizeEdgeFromHandle(handle);
    if (!edge) return;

    const ev = this.events[index];
    if (!ev) return;

    e.stopPropagation();
    if (e.cancelable) e.preventDefault();

    this.#trySetPointerCapture(handle, e.pointerId);

    const layout = this.#readGridLayout();
    const originPointerGridT = this.#pointerGridTime(e.clientX, e.clientY, layout);
    const gestureId = ++this.#gestureIdCounter;

    this.#resizeSession = {
      pointerId: e.pointerId,
      handle,
      eventIndex: index,
      edge,
      originPointerGridT,
      initialStart: ev.start,
      initialEnd: ev.end,
      horiz: layout.horiz,
      gridMax: layout.gridMax,
      gestureId,
    };

    this.#beginSingleEventResizePreview(index, ev.start, ev.end);
    this.#attachResizeWindowListeners();
    // Resize handles are explicit affordances, so touch activates immediately — but native
    // scrolling must not hijack the drag.
    if (e.pointerType === "touch") this.#attachGestureTouchMoveBlocker();
    this.#emitGestureSignal("start", "resize", gestureId);
  };

  /**
   * Drag on empty cell background creates a snapped range preview and commits it as
   * `timeline-event-create` on pointerup. Events and resize handles stop propagation of their own
   * pointerdown, so this only fires for the cell background; the composed-path checks are a
   * safety net.
   */
  #onCellMainPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (this.#resizeSession || this.#moveSession || this.#createSession) return;
    if (this.#pendingTouchGesture) return;
    if (this.#interactiveControlUnderPointer(e.target)) return;
    const path = e.composedPath();
    if (this.#composedPathContainsResizeHandle(path)) return;
    if (path.some((n) => n instanceof Element && n.classList.contains("event"))) return;

    // Touch: long-press to start drag-to-create (grid-view parity); see the move handler.
    if (e.pointerType === "touch") {
      this.#beginPendingTouchGesture("create", -1, e);
      return;
    }

    if (e.cancelable) e.preventDefault();
    this.#startCreateSession(e.pointerId, e.clientX, e.clientY, false);
  };

  #startCreateSession(
    pointerId: number,
    clientX: number,
    clientY: number,
    touchActivated: boolean,
  ) {
    this.#trySetPointerCapture(this, pointerId);

    const layout = this.#readGridLayout();
    const originT = this.#pointerGridTime(clientX, clientY, layout);

    const session: TimelineCreateSession = {
      pointerId,
      captureTarget: this,
      originClientX: clientX,
      originClientY: clientY,
      originT,
      horiz: layout.horiz,
      gridMax: layout.gridMax,
      dragging: false,
      gestureId: ++this.#gestureIdCounter,
    };
    this.#createSession = session;

    this.#attachCreateWindowListeners();
    if (touchActivated) {
      // The long-press itself activates the gesture: show a one-step preview at the hold
      // point right away, and commit it on release even without further travel.
      session.dragging = true;
      this.#attachGestureTouchMoveBlocker();
      this.#emitGestureSignal("start", "create", session.gestureId);
      this.createPreview = this.#createRangeForPointer(session, session.originT);
    }
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (!this.laneClip()) {
      this.cellsResizeObserver?.disconnect();
      this.cellsResizeObserver = null;
      if (this.cellVisibleLanes.length) this.cellVisibleLanes = [];
      return;
    }
    const cellsEl = this.renderRoot?.querySelector(".cells");
    const rebind =
      !this.cellsResizeObserver ||
      changed.has("height") ||
      changed.has("flow") ||
      changed.has("layout") ||
      changed.has("cells") ||
      changed.has("columns");
    if (rebind && cellsEl) {
      this.cellsResizeObserver?.disconnect();
      this.cellsResizeObserver = new ResizeObserver(() => this.measureLaneCaps());
      this.cellsResizeObserver.observe(cellsEl);
    }
    queueMicrotask(() => this.measureLaneCaps());
  }

  /** Resize UI belongs only on the event’s first and last grid segments (not row/cell continuations). */
  private segmentResizeHandleFlags(
    segmentAbsStart: number,
    segmentAbsEnd: number,
    evStart: number,
    evEndClamped: number,
    evEndRaw: number,
    gridMax: number,
  ): { showResizeStart: boolean; showResizeEnd: boolean } {
    const eps = 1e-6;
    const atLogicalStart = Math.abs(segmentAbsStart - evStart) < eps;
    const atClampedEnd = Math.abs(segmentAbsEnd - evEndClamped) < eps;
    return {
      showResizeStart: atLogicalStart && evStart >= 0,
      showResizeEnd: atClampedEnd && evEndRaw <= gridMax + eps,
    };
  }

  /** Whether `ev` overlaps this cell’s absolute time range (includes continuations from earlier cells). */
  private eventOverlapsCell(
    ev: TimelineEvent,
    cell: number,
    span: number,
    gridMax: number,
  ): boolean {
    const t0 = cell * span;
    const t1 = Math.min((cell + 1) * span, gridMax);
    const evEnd = Math.min(ev.end, gridMax);
    return ev.start < t1 && evEnd > t0;
  }

  /**
   * Smallest per-cell lane cap along a horizontal segment (cells `cellStart` … `cellStart + rowSpan`),
   * clamped to the row. Hides the bar if any spanned cell cannot fit the lane.
   */
  private minLaneCapAcrossSpan(
    cellStart: number,
    rowSpan: number,
    cols: number,
    cellCount: number,
  ): number {
    const C = Math.max(1, cols);
    const row = Math.floor(cellStart / C);
    const rowFirst = row * C;
    const rowLast = Math.min((row + 1) * C, cellCount) - 1;
    if (rowLast < rowFirst) return Infinity;
    const cellEnd = Math.min(cellStart + rowSpan, rowLast);
    let minCap = Infinity;
    for (let k = Math.max(cellStart, rowFirst); k <= cellEnd; k++) {
      minCap = Math.min(minCap, this.cellVisibleLanes[k] ?? Infinity);
    }
    return minCap;
  }

  /** Smallest lane cap among all cells in `row` that `ev` overlaps (that row’s time band only). */
  private minLaneCapForEventInRow(
    ev: TimelineEvent,
    row: number,
    cols: number,
    span: number,
    gridMax: number,
    cellCount: number,
  ): number {
    const C = Math.max(1, cols);
    const rowFirst = row * C;
    const rowLast = Math.min((row + 1) * C, cellCount) - 1;
    if (rowLast < rowFirst) return Infinity;

    const tRow0 = rowFirst * span;
    const tRow1 = Math.min((row + 1) * C * span, gridMax);
    const evEnd = Math.min(ev.end, gridMax);
    const t0 = Math.max(ev.start, tRow0);
    const t1 = Math.min(evEnd, tRow1);
    if (t0 >= t1) return Infinity;

    const cStart = Math.floor(t0 / span);
    const cEnd = Math.min(Math.floor((t1 - Number.EPSILON) / span), rowLast);

    let minCap = Infinity;
    for (let k = Math.max(cStart, rowFirst); k <= Math.min(cEnd, rowLast); k++) {
      minCap = Math.min(minCap, this.cellVisibleLanes[k] ?? Infinity);
    }
    return minCap;
  }

  /** Greedy lowest-lane packing; intervals are [start, end). */
  private masonryLanes(events: TimelineEvent[]): number[] {
    const order = events
      .map((ev, i) => ({ ev, i }))
      .sort((a, b) => a.ev.start - b.ev.start || a.i - b.i);
    const ends: number[] = [];
    const lanes = new Array<number>(events.length);
    for (const { ev, i } of order) {
      let L = 0;
      while (L < ends.length && (ends[L] ?? 0) > ev.start) L++;
      if (L === ends.length) ends.push(ev.end);
      else ends[L] = ev.end;
      lanes[i] = L;
    }
    return lanes;
  }

  /** Per grid row: dense lanes and count, using only events that overlap that row’s time span. */
  private rowLaneLayouts(
    events: TimelineEvent[],
    mode: "timeline" | "masonry",
    cellCount: number,
    cols: number,
    span: number,
    gridMax: number,
  ): LaneLayout[] {
    const C = Math.max(1, cols);
    const rows: LaneLayout[] = [];
    for (let r = 0, n = Math.ceil(cellCount / C); r < n; r++) {
      const t0 = r * C * span;
      const t1 = Math.min((r + 1) * C, cellCount) * span;
      const inRow = events
        .map((ev, i) => ({ ev, i }))
        .filter(({ ev }) => ev.start < t1 && Math.min(ev.end, gridMax) > t0);
      if (!inRow.length) {
        rows.push({ laneCount: 1, laneByEventIndex: [] });
        continue;
      }
      const laneByEventIndex = new Array<number>(events.length);
      let laneCount: number;
      if (mode === "timeline") {
        inRow.sort((a, b) => a.i - b.i);
        for (let L = 0; L < inRow.length; L++) {
          const item = inRow[L];
          if (item) laneByEventIndex[item.i] = L;
        }
        laneCount = inRow.length;
      } else {
        const subLanes = this.masonryLanes(inRow.map((x) => x.ev));
        for (let j = 0; j < inRow.length; j++) {
          const item = inRow[j];
          if (item) laneByEventIndex[item.i] = subLanes[j] ?? 0;
        }
        laneCount = Math.max(...subLanes, 0) + 1;
      }
      rows.push({ laneCount: Math.max(1, laneCount), laneByEventIndex });
    }
    return rows;
  }

  /** Per cell (vertical flow): lane index and count for splitting width between overlapping events. */
  private verticalCellLaneLayouts(
    events: TimelineEvent[],
    mode: "timeline" | "masonry",
    cellCount: number,
    span: number,
    gridMax: number,
  ): LaneLayout[] {
    const layouts: LaneLayout[] = [];
    for (let cell = 0; cell < cellCount; cell++) {
      const inCell = events
        .map((ev, i) => ({ ev, i }))
        .filter(({ ev }) => this.eventOverlapsCell(ev, cell, span, gridMax));
      const laneByEventIndex = new Array<number>(events.length);
      if (!inCell.length) {
        layouts.push({ laneCount: 1, laneByEventIndex });
        continue;
      }
      let laneCount: number;
      if (mode === "timeline") {
        inCell.sort((a, b) => a.i - b.i);
        for (let L = 0; L < inCell.length; L++) {
          const item = inCell[L];
          if (item) laneByEventIndex[item.i] = L;
        }
        laneCount = inCell.length;
      } else {
        const subLanes = this.masonryLanes(inCell.map((x) => x.ev));
        for (let j = 0; j < inCell.length; j++) {
          const item = inCell[j];
          if (item) laneByEventIndex[item.i] = subLanes[j] ?? 0;
        }
        laneCount = Math.max(...subLanes, 0) + 1;
      }
      layouts.push({ laneCount: Math.max(1, laneCount), laneByEventIndex });
    }
    return layouts;
  }

  /**
   * Per cell (vertical flow, `layout="stagger"`): same-start group split + stagger indent per
   * event, computed on cell-clamped ranges so continuations from earlier cells behave like
   * events starting at the cell boundary (grid-view parity). One `computeStaggerLayout` sweep
   * per cell — O(k log k) in that cell's event count.
   */
  private verticalCellStaggerLayouts(
    events: TimelineEvent[],
    cellCount: number,
    span: number,
    gridMax: number,
  ): LaneLayout[] {
    const layouts: LaneLayout[] = [];
    for (let cell = 0; cell < cellCount; cell++) {
      const t0 = cell * span;
      const t1 = Math.min((cell + 1) * span, gridMax);
      const indexes: number[] = [];
      const clamped: { start: number; end: number }[] = [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (!ev || !this.eventOverlapsCell(ev, cell, span, gridMax)) continue;
        indexes.push(i);
        clamped.push({ start: Math.max(ev.start, t0), end: Math.min(ev.end, t1) });
      }
      const laneByEventIndex = new Array<number>(events.length);
      const laneCountByEventIndex = new Array<number>(events.length);
      const indentByEventIndex = new Array<number>(events.length);
      const placements = computeStaggerLayout(clamped);
      for (let j = 0; j < indexes.length; j++) {
        const eventIndex = indexes[j] ?? 0;
        const placement = placements[j];
        if (!placement) continue;
        laneByEventIndex[eventIndex] = placement.groupIndex;
        laneCountByEventIndex[eventIndex] = placement.groupSize;
        indentByEventIndex[eventIndex] = placement.indent;
      }
      layouts.push({ laneCount: 1, laneByEventIndex, laneCountByEventIndex, indentByEventIndex });
    }
    return layouts;
  }

  #laneIndexForEvent(
    horiz: boolean,
    rl: LaneLayout | null | undefined,
    vl: LaneLayout | null | undefined,
    eventIndex: number,
  ): number {
    return (horiz ? rl?.laneByEventIndex[eventIndex] : vl?.laneByEventIndex[eventIndex]) ?? 0;
  }

  #collectSegmentsForEventInCell(
    ev: TimelineEvent,
    eventIndex: number,
    cell: number,
    horiz: boolean,
    cols: number,
    span: number,
    gridMax: number,
  ): TimelineCellEventSegment[] {
    const segments: TimelineCellEventSegment[] = [];
    const evEnd = Math.min(ev.end, gridMax);
    let t = ev.start;
    let segIndex = 0;
    while (t < evEnd) {
      const c0 = Math.floor(t / span);
      const row = Math.floor(c0 / cols);
      const segEndAbs = horiz
        ? Math.min(evEnd, (row + 1) * cols * span)
        : Math.min(evEnd, (c0 + 1) * span);
      const c1 = horiz
        ? Math.min(Math.floor((segEndAbs - Number.EPSILON) / span), (row + 1) * cols - 1)
        : c0;
      if (c0 === cell) {
        const { showResizeStart, showResizeEnd } = this.segmentResizeHandleFlags(
          t,
          segEndAbs,
          ev.start,
          evEnd,
          ev.end,
          gridMax,
        );
        segments.push({
          ev,
          index: eventIndex,
          segIndex,
          segStart: t - c0 * span,
          segEnd: segEndAbs - c1 * span,
          rowSpan: horiz ? c1 - c0 : 0,
          showResizeStart,
          showResizeEnd,
        });
      }
      t = segEndAbs;
      segIndex++;
    }
    return segments;
  }

  #segmentsInCell(
    layoutEvents: TimelineEvent[],
    cell: number,
    horiz: boolean,
    cols: number,
    span: number,
    gridMax: number,
  ): TimelineCellEventSegment[] {
    return layoutEvents.flatMap((ev, i) =>
      this.#collectSegmentsForEventInCell(ev, i, cell, horiz, cols, span, gridMax),
    );
  }

  #segmentVisibleUnderLaneClip(
    clip: boolean,
    horiz: boolean,
    eventIndex: number,
    rowSpan: number,
    cell: number,
    cols: number,
    cellCount: number,
    rl: LaneLayout | null | undefined,
    vl: LaneLayout | null | undefined,
  ): boolean {
    if (!clip) return true;
    const lane = this.#laneIndexForEvent(horiz, rl, vl, eventIndex);
    const effectiveCap = horiz
      ? this.minLaneCapAcrossSpan(cell, rowSpan, cols, cellCount)
      : (this.cellVisibleLanes[cell] ?? Infinity);
    return lane < effectiveCap;
  }

  #eventVisibleUnderLaneClipForFooter(
    ev: TimelineEvent,
    eventIndex: number,
    cell: number,
    row: number,
    clip: boolean,
    horiz: boolean,
    cols: number,
    cellCount: number,
    span: number,
    gridMax: number,
    rl: LaneLayout | null | undefined,
    vl: LaneLayout | null | undefined,
  ): boolean {
    if (!this.eventOverlapsCell(ev, cell, span, gridMax)) return false;
    if (!clip) return true;
    const lane = this.#laneIndexForEvent(horiz, rl, vl, eventIndex);
    const effectiveCap = horiz
      ? this.minLaneCapForEventInRow(ev, row, cols, span, gridMax, cellCount)
      : (this.cellVisibleLanes[cell] ?? Infinity);
    return lane < effectiveCap;
  }

  #cellLaneStackStyle(horiz: boolean, laneMode: LaneMode | null, laneCount: number): string {
    return horiz && laneMode ? ` --__lane-stack: calc(${laneCount} * var(--__event-height))` : "";
  }

  #resizeHandleFragment(position: "start" | "end", title: string) {
    return html`<resize-handle
      .axis=${this.flow}
      position=${position}
      title=${title}
      @pointerdown=${this.#onResizeHandlePointerDown}
    ></resize-handle>`;
  }

  #eventSegmentFragment(
    seg: TimelineCellEventSegment,
    laneMode: LaneMode | null,
    horiz: boolean,
    rl: LaneLayout | null | undefined,
    vl: LaneLayout | null | undefined,
  ) {
    const { ev, index, segIndex, segStart, segEnd, rowSpan, showResizeStart, showResizeEnd } = seg;
    const draggingClass = this.draggingEventIndex === index ? " event--dragging" : "";
    // Template contract: `templateEv` carries the committed range; the live gesture range (if
    // any) travels separately so templates can render live-updating labels.
    const preview = this.resizePreviewByIndex?.get(index);
    const templateEv = this.events[index] ?? ev;
    const lane = laneMode ? this.#laneIndexForEvent(horiz, rl, vl, index) : 0;
    const span = this.max > 0 ? this.max : 1;
    const { w0, w1 } = this.#effectiveWindow(span);
    const endPct = this.#axisPct(segEnd, w0, w1);
    const endInset =
      rowSpan > 0 ? `calc(-${rowSpan * 100}% + ${100 - endPct}%)` : `${100 - endPct}%`;
    // Stagger (vertical only): per-event width divisor and indent depth; the per-event
    // --__lane-count overrides the cell-level value.
    const staggerVars =
      !horiz && laneMode === "stagger"
        ? `--__lane-count:${vl?.laneCountByEventIndex?.[index] ?? 1};--__indent:${
            vl?.indentByEventIndex?.[index] ?? 0
          };`
        : "";
    // Free-follow: the moving card keeps its pre-drag geometry and translates 1:1 with the raw
    // pointer delta (grid-view drag feel); the snapped position renders as `.move-ghost`.
    const dragOffset = this.draggingEventIndex === index ? this.moveDragOffset : null;
    const dragTransform = dragOffset
      ? `transform:translate(${dragOffset.x}px, ${dragOffset.y}px);`
      : "";

    return html`
      <div
        class="event${draggingClass}"
        part="event"
        data-index=${index}
        data-segment=${segIndex}
        @pointerdown=${this.#onEventBodyPointerDown}
        style="
        --__lane:${lane};
        ${staggerVars}${dragTransform}
        --__start:${this.#axisPct(segStart, w0, w1)}%;
        --__end:${endInset};
      "
      >
        ${showResizeStart ? this.#resizeHandleFragment("start", "Resize start") : nothing}
        ${this.renderEventTemplate(templateEv, preview)}
        ${showResizeEnd ? this.#resizeHandleFragment("end", "Resize end") : nothing}
      </div>
    `;
  }

  /** Marker lines for values falling inside this cell's absolute range. */
  #markerFragments(cell: number, span: number, gridMax: number, w0: number, w1: number) {
    const markers = this.markers;
    if (!markers?.length) return nothing;
    const frags: TemplateResult[] = [];
    for (const m of markers) {
      if (!Number.isFinite(m) || m < 0 || m >= gridMax) continue;
      if (Math.floor(m / span) !== cell) continue;
      const pct = this.#axisPct(m - cell * span, w0, w1);
      if (pct < 0 || pct > 100) continue;
      const isToday = this.markerTodayCell === cell;
      const emphasisClass = isToday ? " marker--anchor" : " marker--dimmed";
      frags.push(
        html`<div
          class="marker${emphasisClass}"
          part="marker${isToday ? "" : " marker-dimmed"}"
          style="--__marker-pos:${pct}%"
        ></div>`,
      );
    }
    return frags;
  }

  /** Drag-to-create preview segments for this cell (same segment math as events). */
  #createPreviewFragments(
    cell: number,
    horiz: boolean,
    cols: number,
    span: number,
    gridMax: number,
    w0: number,
    w1: number,
  ) {
    const preview = this.createPreview;
    if (!preview) return nothing;
    const segs = this.#collectSegmentsForEventInCell(
      { start: preview.start, end: preview.end },
      -1,
      cell,
      horiz,
      cols,
      span,
      gridMax,
    );
    return segs.map((seg) => {
      const endPct = this.#axisPct(seg.segEnd, w0, w1);
      const endInset =
        seg.rowSpan > 0 ? `calc(-${seg.rowSpan * 100}% + ${100 - endPct}%)` : `${100 - endPct}%`;
      return html`<div
        class="create-preview"
        part="create-preview"
        style="--__start:${this.#axisPct(seg.segStart, w0, w1)}%;--__end:${endInset};"
      ></div>`;
    });
  }

  /**
   * Snapped drop-target ghost for the active move gesture (same segment math as events). Shown
   * once the pointer has actually moved; the free-following card floats above it. In horizontal
   * lane layouts the ghost sits on the dragged event's (frozen) lane.
   */
  #moveGhostFragments(
    cell: number,
    horiz: boolean,
    cols: number,
    span: number,
    gridMax: number,
    w0: number,
    w1: number,
    laneMode: LaneMode | null,
    rl: LaneLayout | null,
    vl: LaneLayout | null,
  ) {
    const session = this.#moveSession;
    if (!session) return nothing;
    const offset = this.moveDragOffset;
    if (!offset || (offset.x === 0 && offset.y === 0)) return nothing;
    const preview = this.resizePreviewByIndex?.get(session.eventIndex);
    if (!preview) return nothing;
    const lane = horiz && laneMode ? this.#laneIndexForEvent(horiz, rl, vl, session.eventIndex) : 0;
    const segs = this.#collectSegmentsForEventInCell(
      { start: preview.start, end: preview.end },
      -1,
      cell,
      horiz,
      cols,
      span,
      gridMax,
    );
    return segs.map((seg) => {
      const endPct = this.#axisPct(seg.segEnd, w0, w1);
      const endInset =
        seg.rowSpan > 0 ? `calc(-${seg.rowSpan * 100}% + ${100 - endPct}%)` : `${100 - endPct}%`;
      return html`<div
        class="move-ghost"
        part="move-ghost"
        style="--__lane:${lane};--__start:${this.#axisPct(
          seg.segStart,
          w0,
          w1,
        )}%;--__end:${endInset};"
      ></div>`;
    });
  }

  #renderCell(
    cell: number,
    layoutEvents: TimelineEvent[],
    cellCount: number,
    span: number,
    gridMax: number,
    cols: number,
    horiz: boolean,
    clip: boolean,
    laneMode: LaneMode | null,
    rl: LaneLayout | null,
    vl: LaneLayout | null,
  ) {
    const row = Math.floor(cell / cols);
    const cellEvents = this.#segmentsInCell(layoutEvents, cell, horiz, cols, span, gridMax);
    const laneCount = horiz ? (rl?.laneCount ?? 1) : (vl?.laneCount ?? 1);
    const laneStack = this.#cellLaneStackStyle(horiz, laneMode, laneCount);

    const visibleCellEvents = cellEvents.filter(({ index, rowSpan }) =>
      this.#segmentVisibleUnderLaneClip(clip, horiz, index, rowSpan, cell, cols, cellCount, rl, vl),
    );

    const allCellEvents = layoutEvents.filter((ev) =>
      this.eventOverlapsCell(ev, cell, span, gridMax),
    );

    const visibleEvents = layoutEvents.filter((ev, index) =>
      this.#eventVisibleUnderLaneClipForFooter(
        ev,
        index,
        cell,
        row,
        clip,
        horiz,
        cols,
        cellCount,
        span,
        gridMax,
        rl,
        vl,
      ),
    );

    const laneVars = laneMode
      ? `--__lane-count: ${laneCount};${laneStack}`
      : `--__lane-count: ${laneCount}`;

    const { w0, w1 } = this.#effectiveWindow(span);
    const windowed = w0 > 0 || w1 < span;
    const gridClass = this.#effectiveGridInterval() > 0 && w1 > w0 ? " cell-main--grid" : "";

    return html`
      <div class="cell" part="cell" data-cell=${cell} style="${laneVars}">
        ${this.headerTemplate
          ? html`<div class="cell-header" part="cell-header">
              ${this.renderHeaderTemplate(cell)}
            </div>`
          : nothing}
        <div
          class="cell-main${windowed ? " cell-main--windowed" : ""}${gridClass}"
          part="cell-main"
          @pointerdown=${this.#onCellMainPointerDown}
        >
          ${visibleCellEvents.map((seg) =>
            this.#eventSegmentFragment(seg, laneMode, horiz, rl, vl),
          )}
          ${this.#markerFragments(cell, span, gridMax, w0, w1)}
          ${this.#createPreviewFragments(cell, horiz, cols, span, gridMax, w0, w1)}
          ${this.#moveGhostFragments(cell, horiz, cols, span, gridMax, w0, w1, laneMode, rl, vl)}
        </div>
        ${this.footerTemplate
          ? html`<div class="cell-footer" part="cell-footer">
              ${this.renderFooterTemplate(cell, visibleEvents, allCellEvents)}
            </div>`
          : nothing}
      </div>
    `;
  }

  renderHeaderTemplate(i: number) {
    return this.headerTemplate?.(i);
  }

  renderEventTemplate(ev: TimelineEvent, preview?: TimelineEventPreviewRange) {
    return this.eventTemplate?.(ev, preview);
  }

  renderFooterTemplate(
    cellIndex: number,
    visibleEvents: TimelineEvent[],
    allCellEvents: TimelineEvent[],
  ) {
    return this.footerTemplate
      ? this.footerTemplate?.(cellIndex, visibleEvents, allCellEvents)
      : html``;
  }

  render() {
    const cellCount = Math.max(1, this.cells);
    const cellIndexes = Array.from({ length: cellCount }, (_, i) => i);
    const span = this.max > 0 ? this.max : 1;
    const gridMax = span * cellCount;
    const cols = Math.max(1, this.columns);
    const horiz = this.flow === "horizontal";
    const layoutEvents = this.#eventsForLayout();
    // While a move/resize gesture is active, lane packing runs on the pre-drag ranges
    // (`this.events`), which stay unchanged until the commit on pointerup. Every event —
    // including the dragged one — keeps its gesture-start lane; only the geometry
    // (layoutEvents) follows the live preview. Lanes recompute normally after commit/cancel.
    const gestureActive = this.#resizeSession !== null || this.#moveSession !== null;
    const laneEvents = gestureActive ? this.events : layoutEvents;
    const laneMode: LaneMode | null =
      layoutEvents.length > 0 &&
      (this.layout === "timeline" || this.layout === "masonry" || this.layout === "stagger")
        ? this.layout
        : null;
    // Stagger has no horizontal geometry (lanes are stacked rows there); fall back to masonry.
    const horizLaneMode = laneMode === "stagger" ? "masonry" : laneMode;
    const rowLayouts =
      horiz && horizLaneMode
        ? this.rowLaneLayouts(laneEvents, horizLaneMode, cellCount, cols, span, gridMax)
        : [];
    const verticalCellLayouts =
      !horiz && laneMode
        ? laneMode === "stagger"
          ? this.verticalCellStaggerLayouts(laneEvents, cellCount, span, gridMax)
          : this.verticalCellLaneLayouts(laneEvents, laneMode, cellCount, span, gridMax)
        : [];
    const clip = this.laneClip();

    return html`
      <div
        class="viewport"
        part="viewport"
        style="--time-line-grid-rows: repeat(${this.columns}, 1fr)${this.#gridLineVars(span)}"
      >
        <div class="cells" part="cells">
          ${cellIndexes.map((cell) => {
            const rl = horiz && laneMode ? rowLayouts[Math.floor(cell / cols)] : null;
            const vl = !horiz && laneMode ? verticalCellLayouts[cell] : null;
            return this.#renderCell(
              cell,
              layoutEvents,
              cellCount,
              span,
              gridMax,
              cols,
              horiz,
              clip,
              laneMode,
              rl,
              vl,
            );
          })}
        </div>
      </div>
    `;
  }
}
