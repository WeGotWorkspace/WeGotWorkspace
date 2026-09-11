import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { UserAvatarColor } from "@/user-avatar/src/user-avatar-color";
import "@/user-avatar/src/user-avatar.css";

export {
  USER_AVATAR_COLORS,
  avatarColorForUserId,
  type UserAvatarColor,
} from "@/user-avatar/src/user-avatar-color";

/**
 * Mark sizes (parent CSS may still override via layout):
 * - `xs` — collab peer stack, share dialog marks (~1.75rem)
 * - `sm` — sidebar / footer / chat (~2.25rem)
 * - `md` — mail sender row (~2.5rem)
 * - `lg` / `xl` — Meet tiles and lobby preview
 */
export type UserAvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

/** Presence pip: online green, away amber, offline transparent + ink ring. */
export type UserAvatarPresence = "online" | "offline" | "away";

const USER_AVATAR_SIZE_CLASS: Record<UserAvatarSize, string> = {
  xs: "user-avatar--xs",
  sm: "user-avatar--sm",
  md: "user-avatar--md",
  lg: "user-avatar--lg",
  xl: "user-avatar--xl",
};

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
  /** Replaces initials when there is no photo (e.g. a company building icon). */
  fallback?: ReactNode;
  /** Mark only — no name / subtitle column (icon-only / peer chip). */
  compact?: boolean;
  /** Defaults to `sm`. */
  size?: UserAvatarSize;
  /** Optional online/offline pip. Rendered by the primitive — do not draw a second custom dot. */
  presence?: UserAvatarPresence;
  /** Per-user palette (retints outline-active wash/fg/border). Omit for app-accent chrome. */
  color?: UserAvatarColor;
  /** Native `<img>` loading hint. List rows pass `lazy`; omit (eager) for the open card. */
  loading?: "eager" | "lazy";
  /** Native `<img>` decoding hint. List rows pass `async`. */
  decoding?: "async" | "auto" | "sync";
  onClick?: () => void;
  className?: string;
  /** Overrides the default “{name} avatar” accessible name. */
  ariaLabel?: string;
  /** Runtime CSS variables (e.g. a per-collection `--contacts-book-color`). */
  style?: CSSProperties;
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
  fallback,
  compact = false,
  size = "sm",
  presence,
  color,
  loading,
  decoding,
  onClick,
  className,
  ariaLabel,
  style,
}: UserAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedName = displayName?.trim() || "Unknown";
  const initials = initialsFromDisplayName(resolvedName) || "?";
  const showImage = Boolean(imageSrc) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [imageSrc]);

  const sizeClass = USER_AVATAR_SIZE_CLASS[size] ?? USER_AVATAR_SIZE_CLASS.sm;

  const markContent = showImage ? (
    <img
      src={imageSrc}
      alt=""
      className="user-avatar__image"
      loading={loading}
      decoding={decoding}
      onError={() => setImageFailed(true)}
    />
  ) : (
    (fallback ?? initials)
  );

  const presenceLabel =
    presence === "online"
      ? "online"
      : presence === "away"
        ? "away"
        : presence === "offline"
          ? "offline"
          : null;
  const avatarLabel =
    ariaLabel ??
    (presenceLabel ? `${resolvedName} avatar, ${presenceLabel}` : `${resolvedName} avatar`);

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
      style={style}
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
