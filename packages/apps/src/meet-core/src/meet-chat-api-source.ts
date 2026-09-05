import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { createMeetAppBootstrap } from "@/lib/api/mock/meet-bootstrap";
import { createMeetChatOperations } from "@/lib/api/mock/meet-chat-operations";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  createHybridMeetChatOperations,
  loadMeetChatBootstrapHybrid,
} from "@/lib/offline/meet-chat-hybrid-operations";
import { resolveMeetChatOfflineUsername } from "@/lib/offline/offline-session";
import type { MeetAppBootstrap, MeetChatOperations } from "@/meet-core/src/meet-types";

export type MeetChatApiSource = {
  loadBootstrap: () => Promise<MeetAppBootstrap>;
  createOperations: (bootstrap?: MeetAppBootstrap) => MeetChatOperations | undefined;
};

export function createHybridMeetChatApiSource(): MeetChatApiSource {
  return {
    loadBootstrap: loadMeetChatBootstrapHybrid,
    createOperations: (bootstrap) => {
      const username = resolveMeetChatOfflineUsername(bootstrap?.session.user.username);
      if (!username) return undefined;
      return createHybridMeetChatOperations(username, {
        id: username,
        displayName: bootstrap?.session.user.displayName || username,
      });
    },
  };
}

function createMockMeetChatApiSource(): MeetChatApiSource {
  return {
    loadBootstrap: () => Promise.resolve(createMeetAppBootstrap()),
    createOperations: (bootstrap) => {
      if (!bootstrap) return undefined;
      return createMeetChatOperations({
        channels: bootstrap.data.channels ?? [],
        messages: bootstrap.data.messages ?? [],
        unfurl: bootstrap.data.unfurl,
        directory: bootstrap.data.directory,
        author: {
          id: bootstrap.session.user.username ?? "demo.user",
          displayName: bootstrap.session.user.displayName,
        },
      });
    },
  };
}

export function createDefaultMeetChatApiSource(): MeetChatApiSource {
  return createWorkspaceSource<MeetChatApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: createMockMeetChatApiSource,
    createLiveSource: createHybridMeetChatApiSource,
  });
}
