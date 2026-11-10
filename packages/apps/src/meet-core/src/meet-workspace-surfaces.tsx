import { useEffect, useRef, type ReactNode } from "react";
import { Hash } from "lucide-react";
import { CollectionState } from "@/collection-state/src/collection-state";
import { publishElementHeight } from "@/lib/publish-element-height";
import { cn } from "@/lib/utils";
import { meetLabels } from "@/meet-core/src/meet-labels";

/** One of two stacked surfaces. The parked one stays mounted but inert, so state survives the swap. */
function MeetWorkspaceSurface({
  className,
  parked,
  children,
}: {
  className: string;
  parked: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(className, parked && "meet-workspace__surface--parked")}
      inert={parked || undefined}
      aria-hidden={parked}
    >
      {children}
    </div>
  );
}

/**
 * The call band floats over the top of the messages (the composer's mirror). Its
 * height goes to the chat column as `--chat-top-dock-height`, so the list keeps
 * its first line and sticky day labels clear of it.
 */
function MeetChatTopDock({ children }: { children?: ReactNode }) {
  const dockRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      publishElementHeight(
        dockRef.current?.parentElement,
        dockRef.current,
        "--chat-top-dock-height",
      ),
    [],
  );
  return (
    <div ref={dockRef} className="meet-workspace__chat-top-dock">
      {children}
    </div>
  );
}

/** Main column: channel chat with its call bar, swapped for the expanded call stage. */
export function MeetWorkspaceMainSurfaces({
  open,
  showExpandedStage,
  keepCallChrome,
  callBar,
  chat,
  stage,
}: {
  /** A conversation or an ad-hoc visit is on screen; otherwise the empty state shows. */
  open: boolean;
  showExpandedStage: boolean;
  /** Keep the stage mounted while it is parked, so a live call is not torn down. */
  keepCallChrome: boolean;
  callBar?: ReactNode;
  chat?: ReactNode;
  stage?: ReactNode;
}) {
  if (!open) {
    return (
      <div className="meet-workspace__chat-empty collection-state-host">
        <CollectionState icon={<Hash className="size-12" />}>
          {meetLabels.emptyChannelMain}
        </CollectionState>
      </div>
    );
  }
  return (
    <div className="meet-workspace__surfaces">
      <MeetWorkspaceSurface className="meet-workspace__chat-main" parked={showExpandedStage}>
        <MeetChatTopDock>{callBar}</MeetChatTopDock>
        {chat}
      </MeetWorkspaceSurface>
      {keepCallChrome ? (
        <MeetWorkspaceSurface className="meet-workspace__call-main" parked={!showExpandedStage}>
          {stage}
        </MeetWorkspaceSurface>
      ) : null}
    </div>
  );
}

/** Right rail: channel chat and the open thread, one parked behind the other. */
export function MeetWorkspaceRailSurfaces({
  showThread,
  chat,
  thread,
}: {
  showThread: boolean;
  chat?: ReactNode;
  thread?: ReactNode;
}) {
  return (
    <div className="meet-workspace__rail-surfaces">
      <MeetWorkspaceSurface className="meet-workspace__rail-chat" parked={showThread}>
        {chat}
      </MeetWorkspaceSurface>
      {thread ? (
        <MeetWorkspaceSurface className="meet-workspace__rail-thread" parked={!showThread}>
          {thread}
        </MeetWorkspaceSurface>
      ) : null}
    </div>
  );
}
