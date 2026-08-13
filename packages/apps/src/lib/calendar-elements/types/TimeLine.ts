export interface TimelineEvent {
  start: number;
  end: number;
  [key: string]: unknown;
}

/**
 * Track layout for `<time-line>`:
 * - `default`: events overlay each other at full width.
 * - `timeline`: each event gets its own track (swimlane) in source order.
 * - `masonry`: overlaps pack into the fewest lanes; concurrent events share space evenly.
 * - `stagger` (vertical flow): calendar-style overlaps — events starting at the same value split
 *   the width evenly; a later-starting overlapping event keeps near-full width, indented at its
 *   inline start and stacked above the earlier one. Horizontal flow falls back to `masonry`.
 */
export type TimeLineLayout = "default" | "timeline" | "masonry" | "stagger";

/** Per-event placement computed by `computeStaggerLayout` (used by `layout="stagger"`). */
export interface StaggerEventLayout {
  /** Position within the same-start group (0-based); drives the equal width split. */
  groupIndex: number;
  /** Number of events sharing this exact start (width divisor; 1 = no split). */
  groupSize: number;
  /**
   * Stagger depth: earlier-starting events still running at this event's start. Drives the
   * inline-start indent and z-order. 0 for events inside a same-start group of 2+ (those split
   * the width instead, matching the reference grid behavior).
   */
  indent: number;
}

/**
 * Live numeric range (absolute axis units) of an in-progress move/resize gesture, passed as the
 * second `eventTemplate` argument for the dragged event so templates can render live labels.
 */
export interface TimelineEventPreviewRange {
  start: number;
  end: number;
}

export type TimelineResizeEdge = "start" | "end";

export interface TimelineEventResizeCommitDetail {
  index: number;
  edge: TimelineResizeEdge;
  start: number;
  end: number;
  previousStart: number;
  previousEnd: number;
}

export interface TimelineEventMoveCommitDetail {
  index: number;
  start: number;
  end: number;
  previousStart: number;
  previousEnd: number;
}

/** Numeric range (absolute axis units) committed by the drag-to-create gesture. */
export interface TimelineEventCreateDetail {
  start: number;
  end: number;
}

export type TimelineGestureKind = "move" | "resize" | "create";

/**
 * Detail of the generic `timeline-gesture-start` / `timeline-gesture-end` signals dispatched
 * while a pointer gesture is in progress (move/resize from their activation, create once the
 * drag threshold is passed). Composing wrappers use these to suppress conflicting interactions
 * (e.g. swipe navigation) for the duration of a gesture; `gestureId` pairs each start with its
 * end.
 */
export interface TimelineGestureSignalDetail {
  kind: TimelineGestureKind;
  gestureId: number;
}
