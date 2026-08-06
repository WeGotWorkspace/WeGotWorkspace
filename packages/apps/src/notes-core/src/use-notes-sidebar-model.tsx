import { useMemo } from "react";
import { Archive, BookOpen, Files, Star } from "lucide-react";
import type { ListDropZoneProps } from "@/hooks/use-sidebar-list-drag";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";

export type NotesSidebarTagEntry = {
  tag: string;
  selected: boolean;
  onSelect: () => void;
} & ListDropZoneProps;

type UseNotesSidebarModelArgs = {
  labels: NotesUILabels;
  view: string;
  notebooks: string[];
  tags: string[];
  selectView: (view: string) => void;
  sidebarDropZoneProps: (target: string, onDrop: (ids: string[]) => void) => ListDropZoneProps;
  moveToNotebook: (ids: string[], notebook: string) => void;
  assignTagToNotes: (ids: string[], tag: string) => void;
};

export function useNotesSidebarModel({
  labels,
  view,
  notebooks,
  tags,
  selectView,
  sidebarDropZoneProps,
  moveToNotebook,
  assignTagToNotes,
}: UseNotesSidebarModelArgs) {
  const primarySidebarItems = useMemo(
    () => [
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

  const notebookSidebarItems = useMemo(
    () =>
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
