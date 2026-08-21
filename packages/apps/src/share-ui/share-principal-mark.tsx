import type { ReactNode } from "react";
import { Users2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { initialsFromDisplayName } from "@/user-avatar/src/user-avatar";

export type SharePrincipalKind = "user" | "group";

type SharePrincipalMarkProps = {
  principalType: SharePrincipalKind;
  displayName: string;
  active?: boolean;
  /** Replaces initials (or the group glyph) with an icon in the same circle. */
  icon?: ReactNode;
  className?: string;
};

export function SharePrincipalMark({
  principalType,
  displayName,
  active = false,
  icon,
  className,
}: SharePrincipalMarkProps) {
  const stateClass = active ? "share-dialog__group-mark--active" : "share-dialog__group-mark--idle";

  if (principalType === "group") {
    return (
      <div className={cn("share-dialog__group-mark", stateClass, className)}>
        {icon ?? <Users2 className="size-3.5" aria-hidden />}
      </div>
    );
  }

  const memberStateClass = icon
    ? undefined
    : active
      ? "share-dialog__member-mark--active"
      : "share-dialog__member-mark--idle";

  return (
    <div className={cn("share-dialog__member-mark", memberStateClass, className)}>
      {icon ?? initialsFromDisplayName(displayName)}
    </div>
  );
}
