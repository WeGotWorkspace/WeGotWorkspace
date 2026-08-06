import { Eye, Lock, MessageSquare, Pencil, ShieldCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { SHARE_UI_PERMISSIONS, type ShareUIPermission } from "@/share-ui/share-access-map";
import { shareLabels, sharePermissionLabels } from "@/share-ui/share-labels";

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
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(next as ShareUIPermission | "none")}
    >
      <SelectTrigger className={className ?? "share-dialog__permission-select"} title={title}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowNone ? (
          <SelectItem value="none">
            <span className="share-dialog__permission-item text-muted-foreground">
              <Lock className="share-dialog__permission-item-icon" aria-hidden />
              {shareLabels.noAccess}
            </span>
          </SelectItem>
        ) : null}
        {permissions.map((permission) => {
          const Icon = PERMISSION_ICONS[permission];
          return (
            <SelectItem key={permission} value={permission}>
              <span className="share-dialog__permission-item">
                <Icon className="share-dialog__permission-item-icon" aria-hidden />
                {sharePermissionLabels[permission].label}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function SharePermissionIcon({ permission }: { permission: ShareUIPermission }) {
  const Icon = PERMISSION_ICONS[permission];
  return <Icon className="share-dialog__permission-item-icon" aria-hidden />;
}
