import type { Meta, StoryObj } from "@storybook/react-vite";
import { Archive, BookOpen, Star, Trash2 } from "lucide-react";
import { MultiSelectionView } from "@/multi-selection-view/src/multi-selection-view";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import { NotesStoryScope } from "./notes-story-scope";

const L = defaultNotesLabels;

function NotesMultiSelectionPaneHarness({ count = 3 }: { count?: number }) {
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
              label: L.selectionStar,
              icon: <Star className="size-4" />,
              onClick: () => {},
            },
            {
              id: "archive",
              label: L.selectionArchive,
              icon: <Archive className="size-4" />,
              onClick: () => {},
            },
            {
              id: "move",
              label: L.selectionMoveToNotebook,
              icon: <BookOpen className="size-4" />,
              onClick: () => {},
            },
            {
              id: "delete",
              label: L.selectionDeletePermanently,
              icon: <Trash2 className="size-4" />,
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
