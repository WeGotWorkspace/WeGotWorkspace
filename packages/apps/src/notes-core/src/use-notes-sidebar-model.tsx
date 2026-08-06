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
  /** ACL + group notebooks for the Shared notebooks section. */
  sharedNotebooks?: NotesSharedNotebook[];
  tags: string[];
  selectView: (view: string) => void;
  sidebarDropZoneProps: (target: string, onDrop: (ids: string[]) => void) => ListDropZoneProps;
  moveToNotebook: (ids: string[], notebook: string) => void;
  assignTagToNotes: (ids: string[], tag: string) => void;
};

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

  const notebookSidebarItems = useMemo(
    (): MenuItemProps[] =>
      [...notebooks]
        .sort((a, b) => a.localeCompare(b))
        .map((nb) => ({
          label: nb,
          icon: <BookOpen className="size-3.5" />,
          selected: view === `nb:${nb}`,
          onClick: () => selectView(`nb:${nb}`),
          ...sidebarDropZoneProps(`nb:${nb}`, (ids) => moveToNotebook(ids, nb)),
        })),
    [moveToNotebook, notebooks, selectView, sidebarDropZoneProps, view],
  );

  const sharedNotebookSidebarItems = useMemo((): MenuItemProps[] => {
    const entries = [...sharedNotebooks].sort((a, b) =>
      sharedNotebookLabel(a).localeCompare(sharedNotebookLabel(b)),
    );
    return entries.map((entry) => {
      const viewKey = sharedNotebookViewKey(entry.path);
      const isGroup = entry.scope === "group";
      return {
        label: sharedNotebookLabel(entry),
        // ACL personal: notebook name + Share2. Groups: group name + Users. No owner subtitle.
        icon: isGroup ? <Users className="size-3.5" /> : <Share2 className="size-3.5" />,
        selected: view === viewKey,
        onClick: () => selectView(viewKey),
      };
    });
  }, [selectView, sharedNotebooks, view]);

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
    sharedNotebookSidebarItems,
    tagSidebarTags,
  };
}
