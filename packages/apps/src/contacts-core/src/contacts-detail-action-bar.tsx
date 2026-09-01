import { Check, Download, Pencil, Trash2, X } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

type ContactsDetailActionBarProps = {
  labels: ContactsUILabels;
  canEdit: boolean;
  editMode: boolean;
  createMode: boolean;
  canSaveCreate?: boolean;
  closeMobileDetail: () => void;
  /** List / view title shown on the mobile back control. */
  backLabel?: string;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDownload: () => void;
};

export function ContactsDetailActionBar({
  labels,
  canEdit,
  editMode,
  createMode,
  canSaveCreate = true,
  closeMobileDetail,
  backLabel,
  onEdit,
  onDelete,
  onSave,
  onCancel,
  onDownload,
}: ContactsDetailActionBarProps) {
  if (createMode) {
    return (
      <ActionBar
        onBack={closeMobileDetail}
        backLabel={backLabel}
        rightActions={[
          {
            id: "cancel",
            label: labels.cancel,
            onClick: onCancel,
            icon: <X className="size-4" />,
          },
          {
            id: "save",
            label: labels.save,
            onClick: onSave,
            icon: <Check className="size-4" />,
            disabled: !canSaveCreate,
          },
        ]}
      />
    );
  }

  const rightActions = [
    ...(canEdit
      ? [
          {
            id: "edit",
            label: labels.edit,
            onClick: editMode ? onCancel : onEdit,
            icon: <Pencil className="size-4" />,
            active: editMode,
            showLabel: true,
          },
        ]
      : []),
    {
      id: "download",
      label: labels.downloadVCard,
      onClick: onDownload,
      icon: <Download className="size-4" />,
      disabled: editMode,
    },
    {
      id: "delete",
      label: labels.delete,
      onClick: onDelete,
      icon: <Trash2 className="size-4" />,
    },
  ];

  return (
    <ActionBar
      onBack={closeMobileDetail}
      backLabel={backLabel}
      rightActions={rightActions}
      rightMenuLabel="More actions"
    />
  );
}
