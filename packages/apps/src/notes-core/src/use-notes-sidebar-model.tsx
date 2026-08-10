import { useMemo } from "react";
import { Archive, BookOpen, Files, Share2, Star, Users } from "lucide-react";
import type { ListDropZoneProps } from "@/hooks/use-sidebar-list-drag";
import type { MenuItemProps } from "@/menu-item/src/menu-item";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesSharedNotebook } from "@/notes-core/src/notes-types";
import { sharedNotebookLabel } from "@/notes-core/src/notes-note-utils";

export type NotesSidebarTagEntry = {
  tag: string;
  selected: boolean;
  onSelect: () => void;
} & ListDropZoneProps;

export type NotesSharedNotebookSidebarEntry = NotesSharedNotebook & {
  viewKey: string;
};

type UseNotesSidebarModelArgs = {
  labels: NotesUILabels;
  view: string;
  /** Owned personal notebook names. */
  notebooks: string[];
  /** Group-membership notebooks (shown inline under Notebooks with Users icon). */
  sharedNotebooks?: NotesSharedNotebook[];
  tags: string[];
  selectView: (view: string) => void;
  sidebarDropZoneProps: (target: string, onDrop: (ids: string[]) => void) => ListDropZoneProps;
  moveToNotebook: (ids: string[], notebook: string) => void;
  assignTagToNotes: (ids: string[], tag: string) => void;
};

/** View key for a group-membership notebook path (`shared-nb:/groups/…`). */
export function sharedNotebookViewKey(path: string): string {
  return `shared-nb:${path.startsWith("/") ? path : `/${path}`}`;
}

export { sharedNotebookLabel };

export function useNotesSidebarModel({
  labels,
  view,
  notebooks,
  sharedNotebooks = [],
  tags,
  selectView,
  sidebarDropZoneProps,
  moveToNotebook,
  assignTagToNotes,
}: UseNotesSidebarModelArgs) {
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
      {
        label: labels.sidebarSharedWithMe,
        icon: <Share2 className="size-3.5" />,
        selected: view === "shared-with-me",
        onClick: () => selectView("shared-with-me"),
      },
    ],
    [
      labels.sidebarAllItems,
      labels.sidebarArchive,
      labels.sidebarSharedWithMe,
      labels.sidebarStarred,
      selectView,
      view,
    ],
  );

  const notebookSidebarItems = useMemo((): MenuItemProps[] => {
    const personal = [...notebooks]
      .sort((a, b) => a.localeCompare(b))
      .map((nb) => ({
        label: nb,
        icon: <BookOpen className="size-3.5" />,
        selected: view === `nb:${nb}`,
        onClick: () => selectView(`nb:${nb}`),
        ...sidebarDropZoneProps(`nb:${nb}`, (ids) => moveToNotebook(ids, nb)),
      }));

    const groupEntries = [...sharedNotebooks]
      .filter((entry) => entry.scope === "group")
      .sort((a, b) => sharedNotebookLabel(a).localeCompare(sharedNotebookLabel(b)))
      .map((entry) => {
        const viewKey = sharedNotebookViewKey(entry.path);
        return {
          label: sharedNotebookLabel(entry),
          icon: <Users className="size-3.5" />,
          selected: view === viewKey,
          onClick: () => selectView(viewKey),
        };
      });

    return [...personal, ...groupEntries];
  }, [moveToNotebook, notebooks, selectView, sharedNotebooks, sidebarDropZoneProps, view]);

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
    notebookSidebarItems,
    tagSidebarTags,
  };
}
