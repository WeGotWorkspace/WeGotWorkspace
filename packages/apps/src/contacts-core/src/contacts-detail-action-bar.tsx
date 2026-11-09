import { Check, Download, Trash2, X } from "lucide-react";
import { ActionBar } from "@/action-bar/src/action-bar";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";

type ContactsDetailActionBarProps = {
  labels: ContactsUILabels;
  createMode: boolean;
  canSaveCreate?: boolean;
  closeMobileDetail: () => void;
  /** List / view title shown on the mobile back control. */
  backLabel?: string;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDownload: () => void;
};

// The address book switcher lives above the name (ContactsDetailAddressBookSelect).
// No Edit action: an open contact is editable as is (like a task or a note).
export function ContactsDetailActionBar({
  labels,
  createMode,
  canSaveCreate = true,
  closeMobileDetail,
  backLabel,
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
    {
      id: "download",
      label: labels.downloadVCard,
      onClick: onDownload,
      icon: <Download className="size-4" />,
      collapseOnNarrow: true,
    },
    {
      id: "delete",
      label: labels.delete,
      onClick: onDelete,
      icon: <Trash2 className="size-4" />,
      severity: "danger" as const,
      collapseOnNarrow: true,
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
