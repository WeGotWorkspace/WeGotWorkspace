import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, ArchiveRestore, CheckCircle2, Notebook, Star, Trash2 } from "lucide-react";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesStoryScope } from "./notes-story-scope";

const L = defaultNotesLabels;

function NotesMultiSelectionPaneHarness({
  count = 3,
  archived = false,
  starred = false,
}: {
  count?: number;
  archived?: boolean;
  starred?: boolean;
}) {
  return (
    <NotesStoryScope variant="detail">
      <div className="workspace-detail-pane__scroll flex min-h-dvh items-center justify-center">
        <MultiSelectionView
          count={count}
          label="Multiple selection"
          title={(n) => `${n} ${n === 1 ? "note" : "notes"} selected`}
          actions={[
            {
              id: "star",
              label: starred ? L.swipeUnstar : L.selectionStar,
              icon: <Star className="size-4" />,
              onClick: () => {},
              active: starred,
            },
            {
              id: "archive",
              label: archived ? L.swipeUnarchive : L.selectionArchive,
              icon: archived ? (
                <ArchiveRestore className="size-4" />
              ) : (
                <Archive className="size-4" />
              ),
              onClick: () => {},
              active: archived,
            },
            {
              id: "move",
              label: L.selectionMoveToNotebook,
              icon: <Notebook className="size-4" />,
              onClick: () => {},
            },
            {
              id: "delete",
              label: L.selectionDeletePermanently,
              icon: <Trash2 className="size-4" />,
              onClick: () => {},
            },
            {
              id: "done",
              label: L.selectionDone,
              icon: <CheckCircle2 className="size-4" />,
              onClick: () => {},
            },
          ]}
        />
      </div>
    </NotesStoryScope>
  );
}

const meta = {
  title: "Apps/Notes/Panes/Multi selection",
  component: NotesMultiSelectionPaneHarness,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof NotesMultiSelectionPaneHarness>;

export default meta;
type Story = StoryObj<typeof NotesMultiSelectionPaneHarness>;

export const Default: Story = {
  args: { count: 3 },
};

export const Single: Story = {
  args: { count: 1 },
};

export const Archived: Story = {
  args: { count: 3, archived: true },
};

export const Starred: Story = {
  args: { count: 3, starred: true },
};
