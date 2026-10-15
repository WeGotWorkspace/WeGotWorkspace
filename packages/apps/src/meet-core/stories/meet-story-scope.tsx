import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/meet-core/src/meet-workspace.css";
import "@/workspace-shell/src/workspace-app-layout.css";

export type MeetStoryScopeVariant = "root" | "in-call" | "chat-column" | "pip-stage" | "split";

/**
 * Storybook Vitest does not emit `@theme` onto `:root`. Seed brand hexes so
 * Meet CSS `var(--color-*)` / avatar mixes resolve for a11y smoke.
 */
const MEET_STORY_BRAND_TOKENS = {
  "--color-we-got-soft": "#fff5e9",
  "--color-we-got-dark": "#003311",
  "--color-we-got-yellow": "#ffc800",
  "--color-we-got-prince": "#962fa8",
  "--color-we-got-sand": "#ba9689",
} as CSSProperties;

export function MeetStoryScope({
  children,
  variant = "root",
  className,
}: {
  children: ReactNode;
  variant?: MeetStoryScopeVariant;
  className?: string;
}) {
  if (variant === "in-call") {
    return (
      <div
        className={cn("meet-workspace meet-workspace--in-call flex h-dvh flex-col", className)}
        style={MEET_STORY_BRAND_TOKENS}
      >
        {children}
      </div>
    );
  }

  if (variant === "chat-column") {
    return (
      <div
        className={cn("meet-workspace flex h-dvh justify-end p-4", className)}
        style={MEET_STORY_BRAND_TOKENS}
      >
        <div className="h-full w-full max-w-[340px]">{children}</div>
      </div>
    );
  }

  if (variant === "split") {
    return (
      <div
        className={cn(
          "workspace-columns meet-workspace meet-workspace--split meet-workspace--call-active",
          className,
        )}
        style={MEET_STORY_BRAND_TOKENS}
      >
        {children}
      </div>
    );
  }

  if (variant === "pip-stage") {
    return (
      <div
        className={cn("meet-workspace relative h-[min(70dvh,28rem)] w-full max-w-4xl", className)}
        style={MEET_STORY_BRAND_TOKENS}
      >
        {children}
      </div>
    );
  }

  return (
    <div className={cn("meet-workspace h-dvh", className)} style={MEET_STORY_BRAND_TOKENS}>
      {children}
    </div>
  );
}
