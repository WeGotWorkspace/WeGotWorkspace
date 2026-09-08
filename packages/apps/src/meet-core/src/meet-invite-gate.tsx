import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  getChatChannel,
  listChatChannels,
  meetChannelFromWire,
  MeetChatRequestError,
} from "@/lib/api/wgw/meet-chat";
import {
  wgwEnsureSession,
  wgwHasAuthenticatedSession,
  wgwLiveApiEnabled,
} from "@/lib/api/wgw/http";
import { MeetApp } from "@/meet-core/src/meet-app";
import { MeetChatApp } from "@/meet-core/src/meet-chat-app";
import { createWgwMeetGuestOrHostApiSource } from "@/meet-core/src/meet-api-source";
import { meetNavigateTargetFromSelection } from "@/meet-core/src/meet-chat-route";
import {
  meetChannelIdsEqual,
  meetCollectionIdCandidates,
  meetCollectionIdFromPublic,
} from "@/meet-core/src/meet-public-id";
import { MeetGuestChannelFrame } from "@/meet-core/src/meet-guest-channel";
import { MeetGuestLobbyStatus } from "@/meet-core/src/meet-guest-lobby-card";
import {
  resolveMeetInviteDestination,
  type MeetInviteAccess,
  type MeetInviteAccessChannel,
  type MeetInviteAccessIo,
} from "@/meet-core/src/meet-invite-access";
import { meetLabels } from "@/meet-core/src/meet-labels";
import "@/meet-core/src/meet-workspace.css";

async function meetInviteHasSession(): Promise<boolean> {
  if (!wgwLiveApiEnabled()) return false;
  if (wgwHasAuthenticatedSession()) return true;
  try {
    await wgwEnsureSession();
  } catch {
    return false;
  }
  return wgwHasAuthenticatedSession();
}

function channelFromUnknown(row: unknown): MeetInviteAccessChannel | null {
  if (!row || typeof row !== "object") return null;
  try {
    const channel = meetChannelFromWire(row as Parameters<typeof meetChannelFromWire>[0]);
    return {
      id: channel.id,
      kind: channel.kind,
      guestRoomCode: channel.guestRoomCode ?? null,
    };
  } catch {
    return null;
  }
}

export const liveMeetInviteAccessIo: MeetInviteAccessIo = {
  hasSession: meetInviteHasSession,
  async getChannel(channelId) {
    for (const id of meetCollectionIdCandidates(channelId)) {
      try {
        return channelFromUnknown(await getChatChannel(id));
      } catch (error) {
        if (
          error instanceof MeetChatRequestError &&
          (error.status === 401 || error.status === 403 || error.status === 404)
        ) {
          continue;
        }
        return null;
      }
    }
    return null;
  },
  async listChannels() {
    try {
      const rows = await listChatChannels();
      return rows
        .map((row) => channelFromUnknown(row))
        .filter((row): row is MeetInviteAccessChannel => row !== null);
    } catch {
      return [];
    }
  },
};

export type MeetInviteGateProps = {
  room: string | null;
  channelId?: string | null;
  accessIo?: MeetInviteAccessIo;
};

export type MeetChannelDeepLinkGateProps = {
  channelId: string | null;
  workspace: ReactNode;
  accessIo?: MeetInviteAccessIo;
};

function InviteCheckingScreen() {
  return (
    <MeetGuestChannelFrame>
      <MeetGuestLobbyStatus
        title={meetLabels.checkingInviteTitle}
        body={meetLabels.checkingInviteBody}
      />
    </MeetGuestChannelFrame>
  );
}

/**
 * One invite URL, two outcomes:
 * a) signed-in → MeetWorkspace (channel and meeting URLs, no guest chrome)
 * b) anonymous → guest lobby
 *
 * Signed-in users keep MeetChatApp mounted while switching conversations so
 * the workspace does not remount — and never swap to MeetApp after an ACL miss.
 */
export function MeetInviteGate({
  room,
  channelId = null,
  accessIo = liveMeetInviteAccessIo,
}: MeetInviteGateProps) {
  const navigate = useNavigate();
  const sessionHint = wgwLiveApiEnabled() && wgwHasAuthenticatedSession();
  const [access, setAccess] = useState<MeetInviteAccess | "checking">(() =>
    sessionHint ? "member" : "checking",
  );
  const [resolvedChannelId, setResolvedChannelId] = useState<string | null>(channelId);
  const [resolvedKind, setResolvedKind] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveMeetInviteDestination({ room, channelId }, accessIo).then((next) => {
      if (cancelled) return;
      setAccess(next.access);
      setResolvedChannelId(next.channelId);
      setResolvedKind(next.kind ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [accessIo, channelId, room]);

  useEffect(() => {
    if (access !== "member" || !resolvedChannelId) return;
    if (meetChannelIdsEqual(channelId, resolvedChannelId)) return;
    const target = meetNavigateTargetFromSelection(resolvedChannelId, { kind: resolvedKind });
    void navigate({
      ...target,
      replace: true,
    });
  }, [access, channelId, navigate, resolvedChannelId, resolvedKind]);

  const guestSource = useMemo(
    () =>
      createWgwMeetGuestOrHostApiSource(
        room ?? (channelId ? meetCollectionIdFromPublic(channelId) : null),
      ),
    [channelId, room],
  );

  if (access === "checking") {
    return <InviteCheckingScreen />;
  }

  if (access === "member") {
    if (resolvedChannelId && !meetChannelIdsEqual(channelId, resolvedChannelId)) {
      return <InviteCheckingScreen />;
    }
    return <MeetChatApp />;
  }

  return <MeetApp source={guestSource} />;
}

/**
 * Live `/meet` parent: keep MeetChatApp mounted for anyone with a session
 * (channel and meeting deep links are the same workspace). Only signed-out
 * channel invite landings swap in the guest lobby.
 */
export function MeetChannelDeepLinkGate({
  channelId,
  workspace,
  accessIo = liveMeetInviteAccessIo,
}: MeetChannelDeepLinkGateProps) {
  const sessionHint = wgwLiveApiEnabled() && wgwHasAuthenticatedSession();
  const [access, setAccess] = useState<MeetInviteAccess | "checking">(() =>
    !channelId || sessionHint ? "member" : "checking",
  );

  useEffect(() => {
    if (!channelId || sessionHint) {
      setAccess("member");
      return;
    }
    let cancelled = false;
    void resolveMeetInviteDestination({ room: null, channelId }, accessIo).then((next) => {
      if (!cancelled) setAccess(next.access);
    });
    return () => {
      cancelled = true;
    };
  }, [accessIo, channelId, sessionHint]);

  if (sessionHint || !channelId || access === "member") {
    return workspace;
  }
  if (access === "checking") return <InviteCheckingScreen />;
  return (
    <MeetApp source={createWgwMeetGuestOrHostApiSource(meetCollectionIdFromPublic(channelId))} />
  );
}
