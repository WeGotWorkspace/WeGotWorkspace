import type { ReactNode } from "react";
import { IconButton } from "@/button/src/icon-button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";
import "@/ui/avatar-list.css";

/** A list of people or Teams, one {@link AvatarListRow} each, split by the suite hairline. */
export function AvatarList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("avatar-list", className)}>{children}</ul>;
}

export type AvatarListRowProps = {
  displayName: string;
  /** The quiet line under the name: a username, a member count. */
  subtitle?: string;
  /** Chips on the name line, such as a role. */
  nameAccessory?: ReactNode;
  /** Controls at the end of the row, usually {@link AvatarListAction}s. */
  children?: ReactNode;
};

export function AvatarListRow({
  displayName,
  subtitle,
  nameAccessory,
  children,
}: AvatarListRowProps) {
  return (
    <li className="avatar-list__row">
      <UserAvatar
        displayName={displayName}
        subtitle={subtitle}
        size="md"
        className="flex-1"
        nameAccessory={nameAccessory}
      />
      {children != null ? <div className="avatar-list__actions">{children}</div> : null}
    </li>
  );
}

/** An icon button at the end of a row. The label is its name and its tooltip. */
export function AvatarListAction({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      label={label}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      size="md"
      variant="outline"
      className="avatar-list__action"
    />
  );
}
