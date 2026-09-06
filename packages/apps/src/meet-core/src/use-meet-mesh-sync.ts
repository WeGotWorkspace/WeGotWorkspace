import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCachedChatMessage } from "@/lib/offline/meet-chat-offline-store";
import { isMeetDirectMessageChannelId } from "@/meet-core/src/meet-direct-messages";
import { useMeetMeshCallReplay } from "@/meet-core/src/meet-mesh-call-replay";
import {
  applyMeetMeshCallEvent,
  meetMeshCallActiveFromParticipants,
  type MeetMeshCallState,
} from "@/meet-core/src/meet-mesh-call-participants";
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
  meshCallParticipants: Record<string, string[]>;
  meshCallAudioOnly: Record<string, boolean>;
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

  const [meshCall, setMeshCall] = useState<MeetMeshCallState>({
    participants: {},
    audioOnly: {},
  });
  const meshCallActive = useMemo(
    () => meetMeshCallActiveFromParticipants(meshCall.participants),
    [meshCall.participants],
  );

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
        setMeshCall((current) =>
          applyMeetMeshCallEvent(current, {
            channelId,
            senderUsername: event.senderUsername,
            active: event.active,
            audioOnly: event.audioOnly,
          }),
        );
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
    const mesh = wrapMeetChatOperationsWithMesh(operations, selfUsername, liveCallChannelId, {
      sendToUsernames,
      targetsFor,
      resolveMessage,
    });
    if (!mesh.startCall && !mesh.leaveCall) return mesh;
    return {
      ...mesh,
      startCall: mesh.startCall
        ? async (channelId: string, options?: { video?: boolean }) => {
            await mesh.startCall!(channelId, options);
            setMeshCall((current) =>
              applyMeetMeshCallEvent(current, {
                channelId,
                active: true,
                audioOnly: options?.video === false,
              }),
            );
          }
        : undefined,
      leaveCall: mesh.leaveCall
        ? async (channelId: string) => {
            await mesh.leaveCall!(channelId);
            const target = channelId || liveCallChannelId || "";
            if (!target) return;
            setMeshCall((current) =>
              applyMeetMeshCallEvent(current, { channelId: target, active: false }),
            );
          }
        : undefined,
    };
  }, [liveCallChannelId, operations, resolveMessage, selfUsername, sendToUsernames, targetsFor]);

  useMeetMeshCallReplay({
    store,
    liveCallChannelId,
    audioOnly: Boolean(liveCallChannelId && meshCall.audioOnly[liveCallChannelId]),
    targetsFor,
  });

  return {
    meshCallActive,
    meshCallParticipants: meshCall.participants,
    meshCallAudioOnly: meshCall.audioOnly,
    operations: wrapped,
  };
}
