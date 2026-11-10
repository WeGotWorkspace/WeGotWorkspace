import { workspaceLabels } from "@/lib/workspace/workspace-labels";

/** Destructive-dialog keys an app label type can extend as-is (Notes does). */
export type WorkspaceDestructiveDialogLabels = {
  dialogCancel: string;
  dialogDelete: string;
  dialogDeleteConfirmSuffix: string;
  dialogPermanentDeleteLeadIn: string;
};

export const workspaceDestructiveDialogLabels: WorkspaceDestructiveDialogLabels = {
  dialogCancel: workspaceLabels.dialog.cancel,
  dialogDelete: workspaceLabels.dialog.delete,
  dialogDeleteConfirmSuffix: workspaceLabels.dialog.deleteConfirmSuffix,
  dialogPermanentDeleteLeadIn: workspaceLabels.dialog.permanentDeleteLeadIn,
};

export function buildPermanentDeleteDescription({
  leadIn,
  target,
  suffix,
}: {
  leadIn: string;
  target: string;
  suffix: string;
}) {
  return `${leadIn}${target}. ${suffix}`;
}
