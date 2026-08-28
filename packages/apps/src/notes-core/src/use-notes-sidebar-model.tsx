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

export function collectionsFromNotesData(
  notebooks: string[],
  sharedNotebooks: NotesSharedNotebook[] = [],
  notebookCollections?: NotesNotebookCollection[],
): NotesNotebookCollection[] {
  if (notebookCollections && notebookCollections.length > 0) {
    return notebookCollections;
  }
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
        isSharee: true,
        scope: "group",
        groupSlug: entry.groupSlug,
      }),
    );
  return [...owned, ...shared];
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
          selected: view === `tag:${tag}`,
          onSelect: () => selectView(`tag:${tag}`),
          ...sidebarDropZoneProps(`tag:${tag}`, (ids) => assignTagToNotes(ids, tag)),
        })),
    [assignTagToNotes, selectView, sidebarDropZoneProps, tags, view],
  );

  return {
    primarySidebarItems,
    ownedNotebooks,
    sharedNotebooks: sharedNotebookRows,
    tagSidebarTags,
    notebookViewKey,
    moveToNotebook,
  };
}
