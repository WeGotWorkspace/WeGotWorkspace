import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { notesNotebookDialogLabelsFrom, defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import {
  TaskProjectDialog,
  type TaskProjectDialogState,
} from "@/tasks-core/src/task-project-dialog";

const PRINCIPALS: CollectionSharePrincipal[] = [
  { id: "alice", displayName: "Alice", principalType: "user" },
];

function NotesNotebookDialogHarness({
  initial,
}: {
  initial: Exclude<TaskProjectDialogState, null>;
}) {
  const [dialog, setDialog] = useState<TaskProjectDialogState>(initial);
  const [shareWith, setShareWith] = useState<CollectionShareWith | null>(
    initial.mode === "edit" ? (initial.shareWith ?? null) : null,
  );
  return (
    <TaskProjectDialog
      dialog={dialog?.mode === "edit" ? { ...dialog, shareWith } : dialog}
      groups={[{ slug: "eng", displayName: "Engineering" }]}
      personalOwnerLabel="Ada"
      labels={notesNotebookDialogLabelsFrom(defaultNotesLabels)}
      contentClassName="notes-dialog-surface"
      onClose={() => setDialog(null)}
      onConfirm={() => setDialog(null)}
      onDelete={dialog?.mode === "edit" && dialog.mayDelete ? () => setDialog(null) : undefined}
      share={
        dialog?.mode === "edit" && dialog.mayShare
          ? {
              knownPrincipals: PRINCIPALS,
              online: true,
              onSearchPrincipals: async () => [...PRINCIPALS],
              onPatchShareWith: async (_id, next) => {
                setShareWith(next);
              },
            }
          : undefined
      }
    />
  );
}

const meta: Meta<typeof NotesNotebookDialogHarness> = {
  title: "Apps/Notes/Notebook dialog",
  component: NotesNotebookDialogHarness,
};

export default meta;
type Story = StoryObj<typeof NotesNotebookDialogHarness>;

export const Create: Story = {
  args: { initial: { mode: "create" } },
};

export const Edit: Story = {
  tags: ["vitest-ci"],
  args: {
    initial: {
      mode: "edit",
      listId: "notes-general",
      name: "General",
      color: "#14b8a6",
      scope: "personal",
      groupSlug: null,
      mayShare: true,
      isSharee: false,
      mayDelete: true,
      shareWith: { alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false } },
      canChangeOwner: true,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("button", { name: defaultNotesLabels.deleteNotebook }),
    ).toBeInTheDocument();
  },
};
