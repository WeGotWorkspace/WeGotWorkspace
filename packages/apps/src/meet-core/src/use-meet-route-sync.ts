import { useCallback, useMemo } from "react";
import { useNavigate, useParams, useRouterState, useSearch } from "@tanstack/react-router";
import {
  buildMeetInviteCallLink,
  meetInvitedRoomFromRoute,
  meetIsJoinRoute,
  meetPathOwnsInviteRoom,
  meetRoomFromSearch,
  meetSearchFromRoom,
  parseMeetRouteSearch,
} from "@/meet-core/src/meet-route-search";

/** App-layer meet routing: read `?room=` / `/meet/channels/{id}` and sync active room back. */
export function useMeetRouteSync() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const params = useParams({ strict: false }) as { channelId?: string; meetingId?: string };

  const invitedRoom = useMemo(
    () =>
      meetInvitedRoomFromRoute({
        pathname,
        search: parseMeetRouteSearch(search as Record<string, unknown>),
        meetingId: params.meetingId,
        channelId: params.channelId,
      }),
    [params.channelId, params.meetingId, pathname, search],
  );

  const isJoinRoute = useMemo(
    () => meetIsJoinRoute(pathname, invitedRoom),
    [invitedRoom, pathname],
  );

  const buildCallLink = useCallback((roomCode: string) => {
    if (typeof window === "undefined") return buildMeetInviteCallLink(roomCode);
    return buildMeetInviteCallLink(roomCode, window.location.origin);
  }, []);

  const onRoomChange = useCallback(
    (roomCode: string | null) => {
      if (typeof window === "undefined") return;
      // Channel/meeting invite URLs encode the room in the path — do not append ?room=.
      if (meetPathOwnsInviteRoom(pathname)) return;
      // Match useMeetRoomState history.replaceState: only sync when a call room is active.
      // Skipping null avoids stripping ?room= from invite links on initial mount.
      if (!roomCode) return;
      const currentRoom = meetRoomFromSearch(
        parseMeetRouteSearch(search as Record<string, unknown>),
      );
      const nextRoom = meetRoomFromSearch(meetSearchFromRoom(roomCode));
      if (currentRoom === nextRoom) return;
      void navigate({
        to: "/meet",
        search: meetSearchFromRoom(roomCode),
        replace: true,
      });
    },
    [navigate, pathname, search],
  );

  return {
    invitedRoom,
    isJoinRoute,
    buildCallLink,
    onRoomChange,
    channelId: params.channelId ?? null,
    meetingId: params.meetingId ?? null,
  };
}
