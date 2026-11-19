import { useMemo } from "react";
import {
  DocsCollabPresenceChrome,
  type DocsCollabPresenceChromeProps,
} from "./docs-collab-presence-chrome";
import { mergeCollabPresencePeers } from "./docs-collab-presence-peers";
import type { DocsCollabMeshPeer, DocsCollabSession } from "./docs-collab-types";
import { useDocsCollabAwarenessPresence } from "./use-docs-collab-awareness-presence";

/** What {@link CollabSessionPresence} reads from a live session (`useDocsCollab`). */
export type CollabSessionPresenceSource = {
  session: Pick<DocsCollabSession, "awareness" | "user"> | null;
  peers: DocsCollabMeshPeer[];
  connectingPeers?: DocsCollabMeshPeer[];
  warningPeers?: DocsCollabMeshPeer[];
};

/**
 * Who is in a live room: the session's awareness merged with its mesh peers,
 * shown as {@link DocsCollabPresenceChrome}. Any app with a `useDocsCollab`
 * session uses this (Notes detail, Tasks detail). Renders nothing without a session.
 */
export function CollabSessionPresence({
  session,
  peers,
  connectingPeers,
  warningPeers,
  className,
  variant,
}: CollabSessionPresenceSource & {
  className?: string;
  variant?: DocsCollabPresenceChromeProps["variant"];
}) {
  const awarenessPeers = useDocsCollabAwarenessPresence(session?.awareness);
  const userName = session?.user.name;
  const presencePeers = useMemo(
    () => (userName === undefined ? [] : mergeCollabPresencePeers(awarenessPeers, peers, userName)),
    [awarenessPeers, peers, userName],
  );

  if (userName === undefined) return null;

  return (
    <DocsCollabPresenceChrome
      className={className}
      variant={variant}
      localUser={{ displayName: userName }}
      peers={presencePeers}
      connectingPeers={connectingPeers}
      warningPeers={warningPeers}
    />
  );
}
