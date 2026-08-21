import { Eye, Lock, MessageSquare, Pencil, ShieldCheck } from "lucide-react";
import { SHARE_UI_PERMISSIONS, type ShareUIPermission } from "@/share-ui/share-access-map";
import { shareLabels, sharePermissionLabels } from "@/share-ui/share-labels";
import { ShareRowSelect, type ShareRowSelectOption } from "@/share-ui/share-row-select";

const PERMISSION_ICONS = {
  view: Eye,
  comment: MessageSquare,
  edit: Pencil,
  full: ShieldCheck,
} as const;

type SharePermissionSelectProps = {
  value: ShareUIPermission | "none";
  onChange: (value: ShareUIPermission | "none") => void;
  disabled?: boolean;
  allowNone?: boolean;
  title?: string;
  className?: string;
  /** Defaults to Drive levels (includes comment). Pass Notes subset for Notes mode. */
  permissions?: readonly ShareUIPermission[];
};

export function SharePermissionSelect({
  value,
  onChange,
  disabled = false,
  allowNone = false,
  title,
  className,
  permissions = SHARE_UI_PERMISSIONS,
}: SharePermissionSelectProps) {
  const options: ShareRowSelectOption<ShareUIPermission | "none">[] = [
    ...(allowNone
      ? [{ value: "none" as const, label: shareLabels.noAccess, icon: Lock, muted: true }]
      : []),
    ...permissions.map((permission) => ({
      value: permission,
      label: sharePermissionLabels[permission].label,
      icon: PERMISSION_ICONS[permission],
    })),
  ];

  return (
    <ShareRowSelect
      value={value}
      options={options}
      disabled={disabled}
      title={title}
      className={className}
      onChange={onChange}
    />
  );
}

export function SharePermissionIcon({ permission }: { permission: ShareUIPermission }) {
  const Icon = PERMISSION_ICONS[permission];
  return <Icon className="share-dialog__permission-item-icon" aria-hidden />;
}
