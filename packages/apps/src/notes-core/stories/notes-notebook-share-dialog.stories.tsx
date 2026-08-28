import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotesNotebookShareDialog } from "@/notes-core/src/notes-notebook-share-dialog";
import { defaultNotesLabels } from "@/notes-core/src/notes-labels";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";

const PRINCIPALS: CollectionSharePrincipal[] = [
  { id: "alice", displayName: "Alice", principalType: "user" },
  { id: "bob", displayName: "Bob", principalType: "user" },
];

function NotesNotebookShareHarness({
  online = true,
}: {
  online?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [shareWith, setShareWith] = useState<CollectionShareWith | null>({
    alice: { mayRead: true, mayWrite: false, mayShare: false, mayDelete: false },
  });
  return (
    <NotesNotebookShareDialog
      notebook={{
        id: "notes-general",
        name: "General",
        isSharee: false,
        scope: "personal",
        shareWith,
      }}
      open={open}
      labels={defaultNotesLabels}
      online={online}
      knownPrincipals={PRINCIPALS}
      onOpenChange={setOpen}
      onSearchPrincipals={async (query) =>
        PRINCIPALS.filter((principal) =>
          principal.displayName.toLowerCase().includes(query.trim().toLowerCase()),
        )
      }
      onPatchShareWith={async (_id, next) => {
        setShareWith(next);
      }}
    />
  );
}

const meta: Meta<typeof NotesNotebookShareHarness> = {
  title: "Apps/Notes/Notebook share",
  component: NotesNotebookShareHarness,
};

export default meta;
type Story = StoryObj<typeof NotesNotebookShareHarness>;

export const Default: Story = {
  args: { online: true },
};

export const Offline: Story = {
  args: { online: false },
};
