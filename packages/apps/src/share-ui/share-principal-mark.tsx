import type { ReactNode } from "react";
import { Users2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ControlSize } from "@/ui/control-size";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";

export type SharePrincipalKind = "user" | "group";

type SharePrincipalMarkProps = {
  principalType: SharePrincipalKind;
  displayName: string;
  /** Stable identity key for per-user palette (user principals only). */
  principalId?: string;
  /** Username / email / member count — uses UserAvatar identity SST (same as sidebar). */
  subtitle?: ReactNode;
  /** Badge beside the name (e.g. inherited label). */
  nameAccessory?: ReactNode;
  /** Trailing chip on the name line (e.g. pending). */
  nameEnd?: ReactNode;
  /**
   * When true (or when subtitle / name accessories are set), render the labeled
   * UserAvatar stack. Search dropdowns keep the default compact mark.
   */
  labeled?: boolean;
  /**
   * Same ControlSize scale as Input / Select. Default `md` (36px) beside share
   * row controls; compact search marks can pass `xs`.
   */
  size?: ControlSize;
  /** Replaces initials (or the group glyph) with an icon in the same circle. */
  icon?: ReactNode;
  className?: string;
};

/** Thin domain wrapper around `UserAvatar` for share / collection ACL rows. */
export function SharePrincipalMark({
  principalType,
  displayName,
  principalId,
  subtitle,
  nameAccessory,
  nameEnd,
  labeled = false,
  size = "md",
  icon,
  className,
}: SharePrincipalMarkProps) {
  const kindClass =
    principalType === "group"
      ? "share-dialog__principal-mark--group"
      : "share-dialog__principal-mark--user";
  const colorKey = principalType === "user" ? (principalId ?? displayName) : null;
  const showLabel = labeled || subtitle != null || nameAccessory != null || nameEnd != null;

  return (
    <UserAvatar
      displayName={displayName}
      subtitle={showLabel ? subtitle : undefined}
      nameAccessory={showLabel ? nameAccessory : undefined}
      nameEnd={showLabel ? nameEnd : undefined}
      compact={!showLabel}
      size={size}
      color={colorKey ? avatarColorForUserId(colorKey) : undefined}
      fallback={
        principalType === "group" ? (icon ?? <Users2 className="size-3.5" aria-hidden />) : icon
      }
      className={cn(
        "share-dialog__principal-mark",
        kindClass,
        showLabel && "share-dialog__principal-mark--labeled",
        className,
      )}
    />
  );
}
