/**
 * Ported verbatim from lit-calendar `TimeLine/StaggerLayout.ts` (UX reference
 * for the timed grids): calendar-style overlap placement for one column's
 * events, intervals `[start, end)` in any consistent unit.
 */

export type StaggerEventLayout = {
  groupIndex: number;
  groupSize: number;
  indent: number;
};

type StaggerInterval = { start: number; end: number };

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
 * Events sharing the exact same start split the width evenly
 * (`groupIndex`/`groupSize`, no indent); an event with a unique start keeps
 * near-full width with `indent` = number of earlier-starting events still
 * running. Single sweep with a min-heap of active ends — O(n log n).
 */
export function computeStaggerLayout(events: readonly StaggerInterval[]): StaggerEventLayout[] {
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

  const activeEnds: number[] = [];

  let groupBegin = 0;
  while (groupBegin < n) {
    const start = events[order[groupBegin] ?? 0]?.start ?? 0;
    let groupEnd = groupBegin + 1;
    while (groupEnd < n && (events[order[groupEnd] ?? 0]?.start ?? 0) === start) groupEnd++;

    while (activeEnds.length && (activeEnds[0] ?? Infinity) <= start) heapPop(activeEnds);
    const depth = activeEnds.length;
    const groupSize = groupEnd - groupBegin;

    for (let k = groupBegin; k < groupEnd; k++) {
      const index = order[k] ?? 0;
      const placement = result[index];
      if (placement) {
        placement.groupIndex = k - groupBegin;
        placement.groupSize = groupSize;
        placement.indent = groupSize > 1 ? 0 : depth;
      }
      const end = events[index]?.end ?? start;
      if (end > start) heapPush(activeEnds, end);
    }
    groupBegin = groupEnd;
  }

  return result;
}
