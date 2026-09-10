import type { ReactNode } from "react";
import { Users2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/user-avatar/src/user-avatar";

export type SharePrincipalKind = "user" | "group";

type SharePrincipalMarkProps = {
  principalType: SharePrincipalKind;
  displayName: string;
  active?: boolean;
  /** Replaces initials (or the group glyph) with an icon in the same circle. */
  icon?: ReactNode;
  className?: string;
};

/** Compact share-dialog mark — thin domain wrapper around `UserAvatar`. */
export function SharePrincipalMark({
  principalType,
  displayName,
  active = false,
  icon,
  className,
}: SharePrincipalMarkProps) {
  const stateClass = active
    ? "share-dialog__principal-mark--active"
    : "share-dialog__principal-mark--idle";
  const kindClass =
    principalType === "group"
      ? "share-dialog__principal-mark--group"
      : "share-dialog__principal-mark--user";

  return (
    <UserAvatar
      displayName={displayName}
      compact
      size="xs"
      fallback={
        principalType === "group" ? (icon ?? <Users2 className="size-3.5" aria-hidden />) : icon
      }
      className={cn("share-dialog__principal-mark", kindClass, stateClass, className)}
    />
  );
}
