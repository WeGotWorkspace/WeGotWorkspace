import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCachedChatMessage } from "@/lib/offline/meet-chat-offline-store";
import { isMeetDirectMessageChannelId } from "@/meet-core/src/meet-direct-messages";
import {
  meetMeshFanoutUsernames,
  meetMeshFanoutUsernamesUnion,
} from "@/meet-core/src/meet-mesh-fanout-targets";
import { meetMeshReceiveCallChannelId } from "@/meet-core/src/meet-mesh-inbound";
import {
  applyMeetMeshFanoutEvent,
  wrapMeetChatOperationsWithMesh,
} from "@/meet-core/src/meet-mesh-sot";
import type { MeetChannel, MeetChatOperations } from "@/meet-core/src/meet-types";
import { usePresenceStoreContext } from "@/presence-core/src/presence-provider";
import type { PresenceStore } from "@/presence-core/src/presence-store";
import type { PresenceEnvelope } from "@/presence-core/src/presence-types";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";

export function useMeetMeshSync({
  operations,
  liveCallChannelId,
  username,
  selfUsername,
  channels,
  directory,
  onApplied,
}: {
  operations?: MeetChatOperations;
  liveCallChannelId?: string | null;
  username: string | null;
  selfUsername: string | null | undefined;
  channels: readonly MeetChannel[];
  directory?: readonly CollectionSharePrincipal[];
  onApplied?: () => void;
}): {
  meshCallActive: Record<string, boolean>;
  operations: MeetChatOperations | undefined;
} {
  const store = usePresenceStoreContext();
  const storeRef = useRef<PresenceStore | null>(store);
  storeRef.current = store;
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const directoryRef = useRef(directory);
  directoryRef.current = directory;
  const usernameRef = useRef(username);
  usernameRef.current = username;
  const selfRef = useRef(selfUsername);
  selfRef.current = selfUsername;

  const [meshCallActive, setMeshCallActive] = useState<Record<string, boolean>>({});

  const knownChannelIds = useMemo(() => new Set(channels.map((row) => row.id)), [channels]);
  const knownChannelIdsRef = useRef(knownChannelIds);
  knownChannelIdsRef.current = knownChannelIds;

  useEffect(() => {
    if (!store) return;
    return store.subscribeMeetFanout((event) => {
      if (event.kind === "call-active") {
        const channelId = meetMeshReceiveCallChannelId(event.channel, event.senderUsername);
        if (
          !knownChannelIdsRef.current.has(channelId) &&
          !isMeetDirectMessageChannelId(channelId)
        ) {
          return;
        }
        setMeshCallActive((current) => {
          if (event.active) {
            return current[channelId] ? current : { ...current, [channelId]: true };
          }
          if (!current[channelId]) return current;
          const { [channelId]: _dropped, ...rest } = current;
          return rest;
        });
        return;
      }
      const account = usernameRef.current;
      if (!account) return;
      void applyMeetMeshFanoutEvent({
        username: account,
        event,
        knownChannelIds: knownChannelIdsRef.current,
      }).then((result) => {
        if (result === "applied") onAppliedRef.current?.();
      });
    });
  }, [store]);

  const targetsFor = useCallback((channelId: string, snapshots?: readonly MeetChannel[]) => {
    const listed = channelsRef.current.find((row) => row.id === channelId);
    const rows = [...(listed ? [listed] : []), ...(snapshots ?? [])];
    if (rows.length === 0) {
      return meetMeshFanoutUsernames({
        channelId,
        selfUsername: selfRef.current,
        channels: channelsRef.current,
        directory: directoryRef.current,
      });
    }
    return meetMeshFanoutUsernamesUnion(
      { selfUsername: selfRef.current, directory: directoryRef.current },
      rows,
    );
  }, []);

  const sendToUsernames = useCallback(
    (usernames: readonly string[], envelope: PresenceEnvelope) => {
      storeRef.current?.sendToUsernames(usernames, envelope);
    },
    [],
  );

  const resolveMessage = useCallback(async (messageId: string) => {
    const account = usernameRef.current;
    if (!account) return undefined;
    return getCachedChatMessage(account, messageId);
  }, []);

  const wrapped = useMemo(() => {
    if (!operations) return undefined;
    return wrapMeetChatOperationsWithMesh(operations, selfUsername, liveCallChannelId, {
      sendToUsernames,
      targetsFor,
      resolveMessage,
    });
  }, [liveCallChannelId, operations, resolveMessage, selfUsername, sendToUsernames, targetsFor]);

  return { meshCallActive, operations: wrapped };
}
