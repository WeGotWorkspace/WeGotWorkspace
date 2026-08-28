import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { CollectionShareSection } from "@/share-ui/collection-share-section";
import type { CollectionSharePrincipal, CollectionShareWith } from "@/share-ui/collection-share";
import type { NotesUILabels } from "@/notes-core/src/notes-labels";
import type { NotesNotebookCollection } from "@/notes-core/src/notes-types";

export type NotesNotebookShareDialogProps = {
  notebook: NotesNotebookCollection | null;
  open: boolean;
  labels: NotesUILabels;
  online?: boolean;
  knownPrincipals?: readonly CollectionSharePrincipal[];
  onOpenChange: (open: boolean) => void;
  onSearchPrincipals: (query: string) => Promise<CollectionSharePrincipal[]>;
  onPatchShareWith: (notebookId: string, shareWith: CollectionShareWith) => Promise<void>;
};

export function NotesNotebookShareDialog({
  notebook,
  open,
  labels,
  online = true,
  knownPrincipals,
  onOpenChange,
  onSearchPrincipals,
  onPatchShareWith,
}: NotesNotebookShareDialogProps) {
  if (!notebook) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="notes-dialog-surface">
        <DialogHeader>
          <DialogTitle>{notebook.name}</DialogTitle>
        </DialogHeader>
        <CollectionShareSection
          collectionId={notebook.id}
          shareWith={notebook.shareWith}
          knownPrincipals={knownPrincipals}
          online={online}
          dialogClassName="notes-dialog-surface"
          copy={{
            title: labels.shareNotebookTitle,
            hint: labels.shareNotebookHint,
            placeholder: labels.shareNotebookPlaceholder,
            empty: labels.shareNotebookEmpty,
            offline: labels.shareNotebookOffline,
            removeTitle: labels.removeNotebookShareTitle,
            removeConfirm: labels.removeNotebookShareConfirm,
          }}
          onSearchPrincipals={onSearchPrincipals}
          onPatchShareWith={onPatchShareWith}
        />
      </DialogContent>
    </Dialog>
  );
}
