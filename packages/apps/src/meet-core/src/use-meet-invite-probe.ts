import { useEffect, useState } from "react";
import type { MeetAPIOperations } from "@/meet-core/src/meet-types";
import {
  meetInviteStateFromRoomStatus,
  meetRoomStatusAllowsHost,
  type MeetInviteProbeState,
} from "@/meet-core/src/meet-invite-status";

export function useMeetInviteProbe(args: {
  invitedRoom: string | null;
  inJoinFlow: boolean;
  hasSignedInIdentity: boolean;
  operations?: MeetAPIOperations;
}): {
  inviteState: MeetInviteProbeState;
  canStartReservedRoom: boolean;
} {
  const { invitedRoom, inJoinFlow, hasSignedInIdentity, operations } = args;
  const [inviteState, setInviteState] = useState<MeetInviteProbeState>(() =>
    inJoinFlow ? "checking" : "active",
  );
  const [canStartReservedRoom, setCanStartReservedRoom] = useState(
    () => hasSignedInIdentity && !inJoinFlow,
  );

  useEffect(() => {
    if (!inJoinFlow || !invitedRoom) {
      setInviteState("active");
      setCanStartReservedRoom(hasSignedInIdentity);
      return;
    }
    if (!operations) {
      setInviteState("checking");
      return;
    }
    let cancelled = false;
    setInviteState("checking");
    void operations
      .roomStatus({ room: invitedRoom })
      .then((result) => {
        if (cancelled) return;
        const canHost = hasSignedInIdentity && meetRoomStatusAllowsHost(result);
        setCanStartReservedRoom(canHost);
        setInviteState(meetInviteStateFromRoomStatus(result, { canHost }));
      })
      .catch(() => {
        if (!cancelled) setInviteState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [hasSignedInIdentity, inJoinFlow, invitedRoom, operations]);

  useEffect(() => {
    if (!inJoinFlow || !invitedRoom || !operations || inviteState !== "waiting-for-host") {
      return;
    }
    const id = window.setInterval(() => {
      void operations.roomStatus({ room: invitedRoom }).then((result) => {
        const canHost = hasSignedInIdentity && meetRoomStatusAllowsHost(result);
        setCanStartReservedRoom(canHost);
        setInviteState(meetInviteStateFromRoomStatus(result, { canHost }));
      });
    }, 2500);
    return () => window.clearInterval(id);
  }, [hasSignedInIdentity, inJoinFlow, inviteState, invitedRoom, operations]);

  return { inviteState, canStartReservedRoom };
}
