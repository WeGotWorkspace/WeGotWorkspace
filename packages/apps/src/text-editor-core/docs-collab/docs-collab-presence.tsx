import { cn } from "@/lib/utils";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import type { DocsCollabMeshPeer } from "./docs-collab-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import "@/text-editor-core/docs-collab/docs-collab-presence.css";

export type DocsCollabPresenceProps = {
  localUser: { displayName: string };
  peers: DocsCollabMeshPeer[];
  connectingPeers?: DocsCollabMeshPeer[];
  warningPeers?: DocsCollabMeshPeer[];
  className?: string;
};

export function DocsCollabPresence({
  localUser,
  peers,
  connectingPeers = [],
  warningPeers = [],
  className,
}: DocsCollabPresenceProps) {
  const connectingNames = connectingPeers.map((peer) => peer.name).join(", ");
  const warningNames = warningPeers.map((peer) => peer.name).join(", ");
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
                color={avatarColorForUserId(peer.id)}
                className="docs-collab-presence__avatar"
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
                displayName="Connecting"
                compact
                size="xs"
                fallback="..."
                className="docs-collab-presence__avatar docs-collab-presence__avatar--connecting"
                ariaLabel={`Connecting to ${connectingPeers.length} peer(s)`}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {`Connecting to ${connectingPeers.length} peer(s)${connectingNames ? `: ${connectingNames}` : ""}`}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {warningPeers.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="docs-collab-presence__chip docs-collab-presence__chip--overlap">
              <UserAvatar
                displayName="Connection warning"
                compact
                size="xs"
                fallback="!"
                className="docs-collab-presence__avatar docs-collab-presence__avatar--warning"
                ariaLabel={`Could not connect to ${warningPeers.length} peer(s)`}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {`Could not connect to ${warningPeers.length} peer(s)${warningNames ? `: ${warningNames}` : ""}`}
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
