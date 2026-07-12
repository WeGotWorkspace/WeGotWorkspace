import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { cn } from "@/lib/utils";
import type { DriveShareOperations } from "@/drive-core/src/drive-types";
import { ShareLinkSection } from "@/share-ui/share-link-section";
import { shareLabels } from "@/share-ui/share-labels";
import { ShareTeamSection } from "@/share-ui/share-team-section";
import { useShareAtPath } from "@/share-ui/use-share-at-path";
import { useShareMutations } from "@/share-ui/use-share-mutations";
import "@/share-ui/share-ui.css";

export type ShareDialogProps = {
  path: string;
  title: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenAccess?: (path: string) => void;
  shareOperations: DriveShareOperations;
  /** Portaled dialog surface tokens — drive green by default; pass `docs-dialog-surface` from Docs. */
  dialogSurfaceClassName?: string;
};

export function ShareDialog({
  path,
  title,
  open = false,
  onOpenChange,
  onOpenAccess,
  shareOperations,
  dialogSurfaceClassName = "drive-dialog-surface",
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
  const handleOpenAccess = (scopePath: string) => {
    onOpenChange?.(false);
    onOpenAccess?.(scopePath);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn("share-dialog", dialogSurfaceClassName, "share-dialog__content")}
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
              <ShareLinkSection atPath={data} mutations={mutations} disabled={!canManage} />
              <ShareTeamSection
                atPath={data}
                mutations={mutations}
                disabled={!canManage}
                onOpenAccess={onOpenAccess ? handleOpenAccess : undefined}
              />
            </div>

            <footer className="share-dialog__footer">
              <span>{shareLabels.footerHint}</span>
              {onOpenAccess ? (
                <button
                  type="button"
                  className="share-dialog__footer-link"
                  onClick={() => handleOpenAccess(path)}
                >
                  {shareLabels.footerOpenAccess}
                  <span aria-hidden>→</span>
                </button>
              ) : null}
            </footer>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
