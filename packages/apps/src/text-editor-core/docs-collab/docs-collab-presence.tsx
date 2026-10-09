import { cn } from "@/lib/utils";
import { docsLabels } from "@/docs-core/src/docs-labels";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import type { DocsCollabMeshPeer } from "./docs-collab-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import "@/text-editor-core/docs-collab/docs-collab-presence.css";

export type DocsCollabPresenceProps = {
  localUser: { displayName: string };
  peers: DocsCollabMeshPeer[];
  connectingPeers?: DocsCollabMeshPeer[];
  serverPeers?: DocsCollabMeshPeer[];
  warningPeers?: DocsCollabMeshPeer[];
  className?: string;
};

export function DocsCollabPresence({
  localUser,
  peers,
  connectingPeers = [],
  serverPeers = [],
  warningPeers = [],
  className,
}: DocsCollabPresenceProps) {
  const connectingNames = connectingPeers.map((peer) => peer.name).join(", ");
  const serverNames = serverPeers.map((peer) => peer.name).join(", ");
  const warningNames = warningPeers.map((peer) => peer.name).join(", ");
  const connectingSummary =
    connectingPeers.length === 1
      ? docsLabels.presenceConnectingOne
      : docsLabels.presenceConnectingMany(connectingPeers.length);
  const serverSummary =
    serverPeers.length === 1
      ? docsLabels.presenceViaServerOne
      : docsLabels.presenceViaServerMany(serverPeers.length);
  const unreachableSummary =
    warningPeers.length === 1
      ? docsLabels.presenceUnreachableOne
      : docsLabels.presenceUnreachableMany(warningPeers.length);
  return (
    <div className={cn("docs-collab-presence", className)} aria-label="Connected editors">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="docs-collab-presence__chip">
            <UserAvatar
              displayName={localUser.displayName}
              compact
              size="xs"
              className="docs-collab-presence__avatar docs-collab-presence__avatar--self"
              ariaLabel={`${localUser.displayName} (you)`}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{`${localUser.displayName} (you)`}</TooltipContent>
      </Tooltip>
      {peers.map((peer) => (
        <Tooltip key={peer.id}>
          <TooltipTrigger asChild>
            <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
              <UserAvatar
                displayName={peer.name}
                compact
                size="xs"
                className="docs-collab-presence__avatar"
                presence="online"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{peer.name}</TooltipContent>
        </Tooltip>
      ))}
      {connectingPeers.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
              <UserAvatar
                displayName={docsLabels.presenceConnectingAvatar}
                compact
                size="xs"
                fallback="..."
                className="docs-collab-presence__avatar docs-collab-presence__avatar--connecting"
                ariaLabel={connectingSummary}
                presence="away"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {connectingNames
              ? docsLabels.presenceWithNames(connectingSummary, connectingNames)
              : connectingSummary}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {serverPeers.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
              <UserAvatar
                displayName={docsLabels.presenceViaServerAvatar}
                compact
                size="xs"
                fallback="..."
                className="docs-collab-presence__avatar docs-collab-presence__avatar--connecting"
                ariaLabel={serverSummary}
                presence="away"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {serverNames ? docsLabels.presenceWithNames(serverSummary, serverNames) : serverSummary}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {warningPeers.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
              <UserAvatar
                displayName={docsLabels.presenceUnreachableAvatar}
                compact
                size="xs"
                fallback="!"
                className="docs-collab-presence__avatar docs-collab-presence__avatar--warning"
                ariaLabel={unreachableSummary}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {warningNames
              ? docsLabels.presenceWithNames(unreachableSummary, warningNames)
              : unreachableSummary}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
