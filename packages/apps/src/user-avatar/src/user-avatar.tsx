import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import "@/user-avatar/src/user-avatar.css";

export type UserAvatarSize = "sm" | "md" | "lg" | "xl";

export type UserAvatarProps = {
  displayName: string | null | undefined;
  /** Shown under the display name (e.g. email, handle). Ignored when `compact` is true. */
  subtitle?: ReactNode;
  /** When set, show profile photo; falls back to initials on load error or when omitted. */
  imageSrc?: string;
  /** Replaces initials when there is no photo (e.g. a company building icon). */
  fallback?: ReactNode;
  /** Avatar + label only; no text column. */
  compact?: boolean;
  /** `sm` = sidebar/footer chip; `md` = mail sender row; `lg` / `xl` = meet tiles and lobby preview. */
  size?: UserAvatarSize;
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
  fallback,
  compact = false,
  size = "sm",
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
    (fallback ?? initials)
  );

  const circle = onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${resolvedName} avatar`}
      className="user-avatar__mark"
    >
      {markContent}
    </button>
  ) : (
    <div className="user-avatar__mark" role="img" aria-label={`${resolvedName} avatar`}>
      {markContent}
    </div>
  );

  return (
    <div className={cn("user-avatar", sizeClass, className)}>
      {circle}
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
