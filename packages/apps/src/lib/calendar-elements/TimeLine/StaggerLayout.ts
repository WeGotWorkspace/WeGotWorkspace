import type { StaggerEventLayout, TimelineEvent } from "../types/TimeLine";

function heapPush(heap: number[], value: number): void {
  heap.push(value);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const parentValue = heap[parent] ?? Infinity;
    const childValue = heap[i] ?? Infinity;
    if (parentValue <= childValue) break;
    heap[parent] = childValue;
    heap[i] = parentValue;
    i = parent;
  }
}

function heapPop(heap: number[]): void {
  const last = heap.pop();
  if (last === undefined || heap.length === 0) return;
  heap[0] = last;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < heap.length && (heap[left] ?? Infinity) < (heap[smallest] ?? Infinity)) {
      smallest = left;
    }
    if (right < heap.length && (heap[right] ?? Infinity) < (heap[smallest] ?? Infinity)) {
      smallest = right;
    }
    if (smallest === i) break;
    const tmp = heap[i] ?? Infinity;
    heap[i] = heap[smallest] ?? Infinity;
    heap[smallest] = tmp;
    i = smallest;
  }
}

/**
 * Calendar-style overlap placement for one cell's events (intervals are `[start, end)`, already
 * clamped to the cell). Matches the reference grid behavior (TimedEvent):
 *
 * - Events sharing the exact same start form a group that splits the width evenly
 *   (`groupIndex` / `groupSize`), with no indent.
 * - An event whose start differs from every concurrent event keeps near-full width and gets
 *   `indent` = number of earlier-starting events still running at its start; it renders indented
 *   at the inline start and above them (z-order), cascading per overlap level.
 *
 * Single pass: sort by start (stable by index), then sweep with a min-heap of active end values —
 * O(n log n), no DOM access, no pairwise sibling scans. Results are positional (index-aligned
 * with the input).
 */
export function computeStaggerLayout(
  events: readonly Pick<TimelineEvent, "start" | "end">[],
): StaggerEventLayout[] {
  const n = events.length;
  const result: StaggerEventLayout[] = new Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = { groupIndex: 0, groupSize: 1, indent: 0 };
  }
  if (n < 2) return result;

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const startA = events[a]?.start ?? 0;
    const startB = events[b]?.start ?? 0;
    return startA - startB || a - b;
  });

  /** Min-heap of end values of already-started events (the sweep's active set). */
  const activeEnds: number[] = [];

  let groupBegin = 0;
  while (groupBegin < n) {
    const start = events[order[groupBegin] ?? 0]?.start ?? 0;
    let groupEnd = groupBegin + 1;
    while (groupEnd < n && (events[order[groupEnd] ?? 0]?.start ?? 0) === start) groupEnd++;

    // Drop earlier events that ended at or before this start; the rest all overlap this group.
    while (activeEnds.length && (activeEnds[0] ?? Infinity) <= start) heapPop(activeEnds);
    const depth = activeEnds.length;
    const groupSize = groupEnd - groupBegin;

    for (let k = groupBegin; k < groupEnd; k++) {
      const index = order[k] ?? 0;
      const placement = result[index];
      if (placement) {
        placement.groupIndex = k - groupBegin;
        placement.groupSize = groupSize;
        // Reference grid behavior: a same-start group splits the width and is never indented.
        placement.indent = groupSize > 1 ? 0 : depth;
      }
      const end = events[index]?.end ?? start;
      if (end > start) heapPush(activeEnds, end);
    }
    groupBegin = groupEnd;
  }

  return result;
}
