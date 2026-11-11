import { createNotesAppBootstrap, type NotesAppBootstrap } from "@/lib/api/mock/notes-bootstrap";
import { createWorkspaceSource } from "@/lib/api/create-workspace-source";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  createHybridNotesOperations,
  loadNotesBootstrapHybrid,
} from "@/lib/offline/notes-hybrid-operations";
import { resolveNotesOfflineUsername } from "@/lib/offline/offline-session";
import type { NotesAPIOperations } from "@/lib/models/notes-types";

export type NotesApiSource = {
  loadBootstrap: () => Promise<NotesAppBootstrap>;
  createOperations: (bootstrap?: NotesAppBootstrap) => NotesAPIOperations | undefined;
};

export function createHybridNotesApiSource(): NotesApiSource {
  return {
    loadBootstrap: loadNotesBootstrapHybrid,
    createOperations: (bootstrap) => {
      const username = resolveNotesOfflineUsername(bootstrap?.session.user.username);
      if (!username) return undefined;
      return createHybridNotesOperations(username);
    },
  };
}

export function createDefaultNotesApiSource(): NotesApiSource {
  return createWorkspaceSource<NotesApiSource>({
    isLive: wgwLiveApiEnabled(),
    createMockSource: () => ({
      loadBootstrap: () => Promise.resolve(createNotesAppBootstrap()),
      createOperations: (bootstrap) => {
        const username = resolveNotesOfflineUsername(bootstrap?.session.user.username);
        if (!username) return undefined;
        return createHybridNotesOperations(username);
      },
    }),
    createLiveSource: createHybridNotesApiSource,
  });
}
