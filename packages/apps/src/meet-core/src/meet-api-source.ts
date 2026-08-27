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
 * Signed-in createdBy / ownerPrincipal members get the manager GET body.
 * Anonymous and non-manager visitors stay on guest bootstrap + signaling.
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

/** `/meet/guest` source: upgrade a cookie-session manager to the same host path as `/meet/join`. */
export function createWgwMeetGuestOrHostApiSource(room: string | null): MeetApiSource {
  return {
    async loadBootstrap() {
      if (await meetGuestLinkAllowsHostUpgrade(room)) {
        return fetchMeetLiveBootstrap();
      }
      return fetchMeetGuestBootstrap();
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
