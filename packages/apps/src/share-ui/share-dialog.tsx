import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { cn } from "@/lib/utils";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { NOTES_SHARE_UI_PERMISSIONS, SHARE_UI_PERMISSIONS } from "@/share-ui/share-access-map";
import { ShareLinkSection } from "@/share-ui/share-link-section";
import { shareLabels } from "@/share-ui/share-labels";
import { ShareTeamSection } from "@/share-ui/share-team-section";
import { useShareAtPath } from "@/share-ui/use-share-at-path";
import { useShareMutations } from "@/share-ui/use-share-mutations";
import "@/share-ui/share-ui.css";

export type ShareDialogMode = "drive" | "notes";

export type ShareDialogProps = {
  path: string;
  title: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  shareOperations: DriveShareOperations;
  /** Portaled dialog surface tokens — drive green by default; pass `docs-dialog-surface` from Docs. */
  dialogSurfaceClassName?: string;
  /**
   * `notes` — team ACL only (no public link / guest); permissions view|edit.
   * `drive` — full Drive share UX (default).
   */
  mode?: ShareDialogMode;
};

export function ShareDialog({
  path,
  title,
  open = false,
  onOpenChange,
  shareOperations,
  dialogSurfaceClassName = "drive-dialog-surface",
  mode = "drive",
}: ShareDialogProps) {
  const { data, loading, error, refetch } = useShareAtPath({
    path,
    operations: shareOperations,
    enabled: open,
  });
  const mutations = useShareMutations({
    path,
    operations: shareOperations,
    atPath: data,
    refetch,
  });

  const canManage = data?.myRights.mayShare ?? true;
  const isNotesMode = mode === "notes";
  const permissions = isNotesMode ? NOTES_SHARE_UI_PERMISSIONS : SHARE_UI_PERMISSIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("share-dialog", dialogSurfaceClassName, "share-dialog__content")}
        onPointerDownOutside={(event) => {
          // Portaled Popover/Select layers sit outside this node in the DOM.
          const target = event.target as Element | null;
          if (target?.closest("[data-radix-popper-content-wrapper]")) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader className="share-dialog__header">
          <DialogTitle>Share {title}</DialogTitle>
          <DialogDescription>{shareLabels.dialogDescription}</DialogDescription>
        </DialogHeader>

        {loading && !data ? (
          <p className="share-dialog__loading">Loading sharing settings…</p>
        ) : null}
        {error && !data ? <p className="share-dialog__error">{shareLabels.loadError}</p> : null}

        {data ? (
          <>
            <div className="share-dialog__body">
              {isNotesMode ? null : (
                <ShareLinkSection atPath={data} mutations={mutations} disabled={!canManage} />
              )}
              <ShareTeamSection
                atPath={data}
                mutations={mutations}
                disabled={!canManage}
                permissions={permissions}
              />
            </div>

            <footer className="share-dialog__footer">
              <span>{shareLabels.footerHint}</span>
            </footer>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
