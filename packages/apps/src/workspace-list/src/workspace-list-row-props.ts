/**
 * Props `react-swipeable-list`'s `SwipeableList` adds to every child on every render
 * (react-swipeable-list@1.10.0, `SwipeableList.render`). `resetState` is a new
 * function each time and `id` is index based, so a row that compared them would
 * re-render on every list render on touch (#1714). Rows never read them: `ListItem`
 * builds its own `SwipeableListItem`.
 */
export const SWIPEABLE_LIST_INJECTED_PROPS: ReadonlySet<string> = new Set([
  "actionDelay",
  "destructiveCallbackDelay",
  "fullSwipe",
  "listType",
  "optOutMouseEvents",
  "scrollStartThreshold",
  "swipeStartThreshold",
  "threshold",
  "clickedCallback",
  "id",
  "resetState",
]);

/**
 * The one props comparison for memoized list rows: shallow, over the row's own
 * props, ignoring what `SwipeableList` injects. Use as `memo(Row, workspaceListRowPropsEqual)`.
 * Handlers passed to a row must keep their identity, or every row re-renders.
 */
export function workspaceListRowPropsEqual<P extends object>(prev: P, next: P): boolean {
  const prevProps = prev as Record<string, unknown>;
  const nextProps = next as Record<string, unknown>;
  for (const key of Object.keys(prevProps)) {
    if (SWIPEABLE_LIST_INJECTED_PROPS.has(key)) continue;
    if (!(key in nextProps) || !Object.is(prevProps[key], nextProps[key])) return false;
  }
  for (const key of Object.keys(nextProps)) {
    if (SWIPEABLE_LIST_INJECTED_PROPS.has(key)) continue;
    if (!(key in prevProps)) return false;
  }
  return true;
}
