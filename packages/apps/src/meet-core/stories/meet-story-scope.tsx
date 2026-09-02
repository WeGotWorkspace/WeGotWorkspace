import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/meet-core/src/meet-workspace.css";
import "@/workspace-shell/src/workspace-app-layout.css";

export type MeetStoryScopeVariant = "root" | "in-call" | "chat-column" | "pip-stage" | "split";

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
      <div className={cn("meet-workspace meet-workspace--in-call flex h-dvh flex-col", className)}>
        {children}
      </div>
    );
  }

  if (variant === "chat-column") {
    return (
      <div className={cn("meet-workspace flex h-dvh justify-end p-4", className)}>
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
      >
        {children}
      </div>
    );
  }

  if (variant === "pip-stage") {
    return (
      <div
        className={cn("meet-workspace relative h-[min(70dvh,28rem)] w-full max-w-4xl", className)}
      >
        {children}
      </div>
    );
  }

  return <div className={cn("meet-workspace h-dvh", className)}>{children}</div>;
}
