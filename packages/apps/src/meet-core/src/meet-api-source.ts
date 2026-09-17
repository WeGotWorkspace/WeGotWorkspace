import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { wgwFetchPrincipal, wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  createWgwMeetGuestOperations,
  createWgwMeetOperations,
  fetchMeetGuestBootstrap,
  fetchMeetLiveBootstrap,
} from "@/lib/api/wgw/meet";
import { meetRoomStatusAllowsHost } from "@/meet-core/src/meet-invite-status";
import type { MeetAPIOperations, MeetAppBootstrap } from "@/meet-core/src/meet-types";

export type MeetApiSource = {
  loadBootstrap: () => Promise<MeetAppBootstrap>;
  createOperations: (bootstrap?: MeetAppBootstrap) => MeetAPIOperations | undefined;
};

export function createWgwMeetApiSource(): MeetApiSource {
  return {
    loadBootstrap: fetchMeetLiveBootstrap,
    createOperations: () => createWgwMeetOperations(),
  };
}

export function createWgwMeetGuestApiSource(): MeetApiSource {
  return {
    loadBootstrap: fetchMeetGuestBootstrap,
    createOperations: () => createWgwMeetGuestOperations(),
  };
}

function meetBootstrapUsesAuthenticatedOps(bootstrap?: MeetAppBootstrap): boolean {
  return Boolean(bootstrap?.session.user.username?.trim() || bootstrap?.session.user.email?.trim());
}

/**
 * Cookie-session visitors get authenticated bootstrap + ops (locked lobby name,
 * knock as their principal). Anonymous visitors stay on guest signaling.
 * Host vs knock is decided later from roomStatus / channel ACL — not here.
 */
export async function meetGuestLinkAllowsHostUpgrade(room: string | null): Promise<boolean> {
  if (!room) return false;
  try {
    await wgwFetchPrincipal();
  } catch {
    return false;
  }
  try {
    const status = await createWgwMeetOperations().roomStatus({ room });
    return meetRoomStatusAllowsHost(status);
  } catch {
    return false;
  }
}

/** Invite-landing source: upgrade any cookie session so signed-in non-members keep their identity. */
export function createWgwMeetGuestOrHostApiSource(_room: string | null): MeetApiSource {
  return {
    async loadBootstrap() {
      try {
        await wgwFetchPrincipal();
        return fetchMeetLiveBootstrap();
      } catch {
        return fetchMeetGuestBootstrap();
      }
    },
    createOperations(bootstrap) {
      return meetBootstrapUsesAuthenticatedOps(bootstrap)
        ? createWgwMeetOperations()
        : createWgwMeetGuestOperations();
    },
  };
}

export function createDefaultMeetApiSource(): MeetApiSource {
  return createWorkspaceSource<MeetApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createMeetAppBootstrap()),
      createOperations: () => undefined,
    }),
    createLiveSource: createWgwMeetApiSource,
  });
}
