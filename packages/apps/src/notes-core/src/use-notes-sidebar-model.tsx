import { useMemo } from "react";
import { Archive, Files, Star } from "lucide-react";
import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import type { ListDropZoneProps } from "@/hooks/use-sidebar-list-drag";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookCollection, NotesSharedNotebook } from "@/notes-core/src/notes-types";

export type NotesSidebarTagEntry = {
  tag: string;
  selected: boolean;
  onSelect: () => void;
} & ListDropZoneProps;

export type NotesNotebookSidebarEntry = NotesNotebookCollection;

type UseNotesSidebarModelArgs = {
  labels: NotesUILabels;
  view: string;
  /** Owned personal notebook names (legacy / mock). */
  notebooks: string[];
  /** Group-membership notebooks (legacy path-shaped). */
  sharedNotebooks?: NotesSharedNotebook[];
  /** Preferred: REST notebooks for collection-sidebar partition. */
  notebookCollections?: NotesNotebookCollection[];
  tags: string[];
  selectView: (view: string) => void;
  sidebarDropZoneProps: (target: string, onDrop: (ids: string[]) => void) => ListDropZoneProps;
  moveToNotebook: (ids: string[], notebook: string) => void;
  assignTagToNotes: (ids: string[], tag: string) => void;
};

export function notebookViewKey(notebookId: string): string {
  return `nb:${notebookId}`;
}

export function tagViewKey(tag: string): string {
  return `tag:${tag}`;
}

/** Re-clicking the active tag clears the filter and returns to All Items. */
export function nextNotesTagView(view: string, tag: string): string {
  const next = tagViewKey(tag);
  return view === next ? "all" : next;
}

/** Same as Tasks `isViewOnlyTaskList`: missing `mayWriteAll` is writable. */
export function isViewOnlyNotebook(notebook: Pick<NotesNotebookCollection, "myRights">): boolean {
  return notebook.myRights?.mayWriteAll === false;
}

/** REST ids + display names for leftover `/notes/shared-with-me` (isSharee notebooks only). */
export function sharedNotebookFilterKeys(
  collections: readonly NotesNotebookCollection[],
): Set<string> {
  const keys = new Set<string>();
  for (const item of collections) {
    if (item.isSharee !== true) continue;
    keys.add(item.id);
    keys.add(item.name);
  }
  return keys;
}

export function collectionsFromNotesData(
  notebooks: string[],
  sharedNotebooks: NotesSharedNotebook[] = [],
  notebookCollections?: NotesNotebookCollection[],
): NotesNotebookCollection[] {
  const owned = notebooks.map(
    (name): NotesNotebookCollection => ({
      id: name,
      name,
      isSharee: false,
      scope: "personal",
    }),
  );
  const shared = sharedNotebooks
    .filter((entry) => entry.scope === "group")
    .map(
      (entry): NotesNotebookCollection => ({
        id: entry.groupSlug ? `group-${entry.groupSlug}` : entry.path,
        name: entry.notebook,
        // Group membership is ownership (Tasks/Calendar), not inbound ACL.
        isSharee: false,
        scope: "group",
        groupSlug: entry.groupSlug,
      }),
    );
  if (!notebookCollections || notebookCollections.length === 0) {
    return [...owned, ...shared];
  }
  const seen = new Set<string>();
  for (const collection of notebookCollections) {
    seen.add(collection.id);
    seen.add(collection.name);
  }
  const extras = [...owned, ...shared].filter((item) => !seen.has(item.id) && !seen.has(item.name));
  return [...notebookCollections, ...extras];
}

export function useNotesSidebarModel({
  labels,
  view,
  notebooks,
  sharedNotebooks = [],
  notebookCollections,
  tags,
  selectView,
  sidebarDropZoneProps,
  moveToNotebook,
  assignTagToNotes,
}: UseNotesSidebarModelArgs) {
  const collections = useMemo(
    () => collectionsFromNotesData(notebooks, sharedNotebooks, notebookCollections),
    [notebookCollections, notebooks, sharedNotebooks],
  );

  const { owned: ownedNotebooks, shared: sharedNotebookRows } = useMemo(
    () => partitionOwnedAndShared(collections),
    [collections],
  );

  const primarySidebarItems = useMemo(
    (): MenuItemProps[] => [
      {
        label: labels.sidebarAllItems,
        icon: <Files className="size-3.5" />,
        selected: view === "all",
        onClick: () => selectView("all"),
      },
      {
        label: labels.sidebarStarred,
        icon: <Star className="size-3.5" />,
        selected: view === "starred",
        onClick: () => selectView("starred"),
      },
      {
        label: labels.sidebarArchive,
        icon: <Archive className="size-3.5" />,
        selected: view === "archive",
        onClick: () => selectView("archive"),
      },
    ],
    [labels.sidebarAllItems, labels.sidebarArchive, labels.sidebarStarred, selectView, view],
  );

  const tagSidebarTags = useMemo(
    (): NotesSidebarTagEntry[] =>
      [...tags]
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => ({
          tag,
          selected: view === tagViewKey(tag),
          onSelect: () => selectView(nextNotesTagView(view, tag)),
          ...sidebarDropZoneProps(tagViewKey(tag), (ids) => assignTagToNotes(ids, tag)),
        })),
    [assignTagToNotes, selectView, sidebarDropZoneProps, tags, view],
  );

  return {
    primarySidebarItems,
    ownedNotebooks,
    sharedNotebooks: sharedNotebookRows,
    tagSidebarTags,
    showTagsSection: tagSidebarTags.length > 0,
    notebookViewKey,
    moveToNotebook,
  };
}
