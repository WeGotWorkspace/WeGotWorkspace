import { cloneElement, isValidElement, useMemo, type ReactElement, type ReactNode } from "react";
import { useListReorderAnimation } from "@/hooks/use-list-reorder-animation";
import {
  WorkspaceSwipeList,
  type WorkspaceSwipeListProps,
} from "@/workspace-swipe-list/src/workspace-swipe-list";
import { useWorkspaceListWindow } from "@/workspace-list/src/use-workspace-list-window";
import {
  WORKSPACE_LIST_SECTION_ATTR,
  WORKSPACE_LIST_SPACER_ATTR,
} from "@/workspace-list/src/use-workspace-list-measure";
import { useWorkspaceListReveal } from "@/workspace-list/src/use-workspace-list-reveal";
import "./workspace-list.css";

export type WorkspaceListProps<T> = Omit<WorkspaceSwipeListProps, "children"> & {
  /** In display order: sorting and filtering stay with the app (keyboard ranges read the same order). */
  items: readonly T[];
  /** The entity id. It is also the row's `data-list-item-id`. */
  getKey: (item: T) => string;
  /**
   * One row. Runs only for mounted rows. Return a component memoized with
   * `workspaceListRowPropsEqual`, rendering exactly one root element.
   */
  renderItem: (item: T) => ReactElement;
  /** Row height in px before it has been measured (the gap under the row included). */
  estimateSize: (item: T) => number;
  /** Sticky section headers: kept mounted while rows of their section are. */
  isHeader?: (item: T) => boolean;
  /**
   * Wraps a section: its header row, then the mounted rows (and spacers) up to the
   * next header. Return one DOM element (a `<section>`), so a sticky header sticks
   * for exactly its section. Needs `isHeader`.
   */
  renderSection?: (header: T, content: ReactNode[]) => ReactElement;
  /** Scroll a newly active row into view once (Contacts). Keyboard moves scroll anyway. */
  revealActive?: boolean;
  /** Extra ids to keep mounted out of view (the active row always is). */
  pinnedKeys?: readonly string[];
  className?: string;
};

/**
 * Stands in for rows that are not mounted. A component, not a bare `div`:
 * `SwipeableList` clones every child with its own props, which a DOM node would
 * receive as unknown attributes.
 */
function WorkspaceListSpacer({ size }: { size: number }) {
  return (
    <div
      aria-hidden
      className="workspace-list__spacer"
      {...{ [WORKSPACE_LIST_SPACER_ATTR]: "" }}
      style={{ blockSize: size }}
    />
  );
}

function keyedRow(element: ReactElement, key: string): ReactNode {
  if (!isValidElement(element) || element.key === key) return element;
  return cloneElement(element, { key });
}

type ListEntry<T> = { node: ReactNode; header: T | null; key: string };

/** Puts each run that starts at a header into that header's section element. */
function groupSections<T>(
  entries: readonly ListEntry<T>[],
  renderSection: (header: T, content: ReactNode[]) => ReactElement,
): ReactNode[] {
  const out: ReactNode[] = [];
  let open: { header: T; key: string; content: ReactNode[] } | null = null;
  const close = () => {
    if (!open) return;
    const section = renderSection(open.header, open.content);
    out.push(
      cloneElement(section, {
        key: `section-${open.key}`,
        [WORKSPACE_LIST_SECTION_ATTR]: "",
      } as Record<string, unknown>),
    );
    open = null;
  };
  for (const entry of entries) {
    if (entry.header !== null) {
      close();
      open = { header: entry.header, key: entry.key, content: [entry.node] };
    } else if (open) {
      open.content.push(entry.node);
    } else {
      out.push(entry.node);
    }
  }
  close();
  return out;
}

/**
 * The suite's one list (#1641 step d). An app binds to it with its items in
 * display order and its row; the list memoizes nothing itself but mounts only the
 * rows near the viewport once there are more than 80, keeps the active, focused
 * and dragged rows mounted, and runs the reorder animation. Selection, keyboard,
 * swipe and drag events are `WorkspaceSwipeList`'s, unchanged.
 */
export function WorkspaceList<T>({
  items,
  getKey,
  renderItem,
  estimateSize,
  isHeader,
  renderSection,
  revealActive = false,
  pinnedKeys,
  className,
  activeId = "",
  ...swipeListProps
}: WorkspaceListProps<T>) {
  const keys = useMemo(() => items.map(getKey), [getKey, items]);
  const pinned = useMemo(
    () => (activeId ? [activeId, ...(pinnedKeys ?? [])] : (pinnedKeys ?? [])),
    [activeId, pinnedKeys],
  );
  const { attachList, listRef, enabled, segments, mounted } = useWorkspaceListWindow({
    items,
    keys,
    estimateSize,
    isHeader,
    pinnedKeys: pinned,
  });
  // The full key list: a moving window changes which rows are mounted, and
  // feeding only those would look like a reorder. Section headers do not animate.
  const rowKeys = useMemo(
    () => (isHeader ? keys.filter((_, index) => !isHeader(items[index]!)) : keys),
    [isHeader, items, keys],
  );
  useListReorderAnimation(listRef, rowKeys);
  useWorkspaceListReveal(listRef, activeId, keys, revealActive);

  const entries: ListEntry<T>[] = [];
  const pushRow = (index: number) => {
    const item = items[index]!;
    const key = keys[index]!;
    const header = renderSection && isHeader?.(item) ? item : null;
    entries.push({ node: keyedRow(renderItem(item), key), header, key });
  };
  if (!enabled) {
    items.forEach((_, index) => pushRow(index));
  } else {
    segments.forEach((segment, position) => {
      if (segment.kind === "gap") {
        const key = `gap-${position}`;
        entries.push({
          node: <WorkspaceListSpacer key={key} size={segment.size} />,
          header: null,
          key,
        });
        return;
      }
      for (let index = segment.start; index < segment.end; index += 1) pushRow(index);
    });
  }
  const rows = renderSection
    ? groupSections(entries, renderSection)
    : entries.map((entry) => entry.node);

  return (
    <div
      ref={attachList}
      className={className}
      data-workspace-list-rows={items.length}
      data-workspace-list-mounted={enabled ? mounted : items.length}
    >
      <WorkspaceSwipeList activeId={activeId} {...swipeListProps}>
        {rows}
      </WorkspaceSwipeList>
    </div>
  );
}
