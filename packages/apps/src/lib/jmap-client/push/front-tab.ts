/** What a tab reports to the hub about where the user is (docs/architecture/notifications.md). */
export type TabActivity = {
  /** Epoch ms of the tab's last window focus; 0 when it never had focus. */
  focusedAt: number;
  /** The screen the tab shows: path plus query, or null before the app reported one. */
  route: string | null;
};

/** The tab the user is looking at, as the hub elected it. */
export type FrontTab = TabActivity & { tabId: string; self: boolean };

/** Window focus as the hub reads it (injected for tests). */
export type FocusSource = {
  focusedAt: () => number;
  subscribe: (listener: () => void) => () => void;
};

/**
 * The most recently focused of the visible tabs; ties go to the lowest tab id,
 * so every tab that runs this on the same reports elects the same one. A
 * visible tab that has not reported yet counts as never focused. Null when no
 * tab is visible.
 */
export function pickFrontTab(
  visibleTabIds: Iterable<string>,
  activity: ReadonlyMap<string, TabActivity>,
  selfId: string,
): FrontTab | null {
  let front: FrontTab | null = null;
  for (const tabId of visibleTabIds) {
    const reported = activity.get(tabId) ?? { focusedAt: 0, route: null };
    const candidate: FrontTab = { ...reported, tabId, self: tabId === selfId };
    if (
      !front ||
      candidate.focusedAt > front.focusedAt ||
      (candidate.focusedAt === front.focusedAt && tabId < front.tabId)
    ) {
      front = candidate;
    }
  }
  return front;
}
