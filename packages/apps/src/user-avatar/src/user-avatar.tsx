import { useEffect, useState, type ReactElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { UserAvatarColor } from "@/user-avatar/src/user-avatar-color";
import "@/user-avatar/src/user-avatar.css";

export {
  USER_AVATAR_COLORS,
  avatarColorForUserId,
  type UserAvatarColor,
} from "@/user-avatar/src/user-avatar-color";

export type UserAvatarSize = "sm" | "md" | "lg" | "xl";

/** Presence pip: online green, away amber, offline transparent + ink ring. */
export type UserAvatarPresence = "online" | "offline" | "away";

export type UserPresenceDotProps = {
  presence: UserAvatarPresence;
  /**
   * Sidebar / list mark (in-flow). Default is the avatar corner pip
   * (absolutely positioned with a surface punch-out ring).
   */
  standalone?: boolean;
  className?: string;
};

export function UserPresenceDot({
  presence,
  standalone = false,
  className,
}: UserPresenceDotProps): ReactElement {
  return (
    <span
      className={cn(
        "user-avatar__presence",
        `user-avatar__presence--${presence}`,
        standalone && "user-avatar__presence--standalone",
        className,
      )}
      data-presence={presence}
      aria-hidden
    />
  );
}

export type UserAvatarProps = {
  displayName: string | null | undefined;
  /** Shown under the display name (e.g. email, handle). Ignored when `compact` is true. */
  subtitle?: ReactNode;
  /** When set, show profile photo; falls back to initials on load error or when omitted. */
  imageSrc?: string;
  /** Avatar + label only; no text column. */
  compact?: boolean;
  /** `sm` = sidebar/footer chip; `md` = mail sender row; `lg` / `xl` = meet tiles and lobby preview. */
  size?: UserAvatarSize;
  /** Optional online/offline pip. Rendered by the primitive — do not draw a second custom dot. */
  presence?: UserAvatarPresence;
  /** Washed fill + saturated 2px ring. Omit to keep parent `--user-avatar-*` tokens. */
  color?: UserAvatarColor;
  onClick?: () => void;
  className?: string;
};

export function initialsFromDisplayName(displayName: string | null | undefined): string {
  const trimmed = displayName?.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

export function UserAvatar({
  displayName,
  subtitle,
  imageSrc,
  compact = false,
  size = "sm",
  presence,
  color,
  onClick,
  className,
}: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedName = displayName?.trim() || "Unknown";
  const initials = initialsFromDisplayName(resolvedName) || "?";
  const showImage = Boolean(imageSrc) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [imageSrc]);

  const sizeClass =
    size === "md"
      ? "user-avatar--md"
      : size === "lg"
        ? "user-avatar--lg"
        : size === "xl"
          ? "user-avatar--xl"
          : "user-avatar--sm";

  const markContent = showImage ? (
    <img
      src={imageSrc}
      alt=""
      className="user-avatar__image"
      onError={() => setImageFailed(true)}
    />
  ) : (
    initials
  );

  const presenceLabel =
    presence === "online"
      ? "online"
      : presence === "away"
        ? "away"
        : presence === "offline"
          ? "offline"
          : null;
  const avatarLabel = presenceLabel
    ? `${resolvedName} avatar, ${presenceLabel}`
    : `${resolvedName} avatar`;

  const circle = onClick ? (
    <button type="button" onClick={onClick} aria-label={avatarLabel} className="user-avatar__mark">
      {markContent}
    </button>
  ) : (
    <div className="user-avatar__mark" role="img" aria-label={avatarLabel}>
      {markContent}
    </div>
  );

  return (
    <div
      className={cn(
        "user-avatar",
        sizeClass,
        presence && "user-avatar--presence",
        color && "user-avatar--colored",
        color && `user-avatar--color-${color}`,
        className,
      )}
    >
      <div className="user-avatar__mark-wrap">
        {circle}
        {presence ? <UserPresenceDot presence={presence} /> : null}
      </div>
      {!compact ? (
        <div className="user-avatar__text">
          <div
            className={cn(
              "user-avatar__name",
              subtitle != null && subtitle !== "" && "user-avatar__name--emphasized",
            )}
          >
            {resolvedName}
          </div>
          {subtitle != null && subtitle !== "" ? (
            <div className="user-avatar__subtitle">{subtitle}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
