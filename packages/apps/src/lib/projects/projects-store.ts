import { useSyncExternalStore } from "react";
import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import { createMockProjectOperations } from "@/lib/api/mock/projects";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  createWgwProjectOperations,
  type ProjectOperations,
  type ProjectTeam,
} from "@/lib/api/wgw/projects";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import type { Project, ProjectCreateRequest } from "@wgw/openapi-types/projects-types";

/** A Project as the apps show it: the API record plus its Team's name. */
export type WorkspaceProject = Project & { teamName: string };

export type ProjectsStatus = "idle" | "loading" | "ready" | "offline" | "error";

export type ProjectsSnapshot = {
  status: ProjectsStatus;
  /** Active Projects of the user's Teams; archived ones are not listed. */
  projects: readonly WorkspaceProject[];
  teams: readonly ProjectTeam[];
};

export type ProjectsStore = {
  getSnapshot: () => ProjectsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads the list again; concurrent calls share one request. Resolves false on failure. */
  load: () => Promise<boolean>;
  create: (request: ProjectCreateRequest) => Promise<WorkspaceProject>;
};

/** Last good list, so the filter still works offline. Overwritten by every successful load. */
export const PROJECTS_CACHE_KEY = "wgw.projects.cache";

type CachedProjects = { username: string; teams: ProjectTeam[]; projects: Project[] };

const EMPTY: ProjectsSnapshot = { status: "idle", projects: [], teams: [] };

function withTeamNames(projects: readonly Project[], teams: readonly ProjectTeam[]) {
  const names = new Map(teams.map((team) => [team.slug, team.displayName]));
  return projects
    .filter((project) => !project.archived)
    .map((project) => ({ ...project, teamName: names.get(project.teamSlug) ?? project.teamSlug }));
}

function readCache(): CachedProjects | null {
  try {
    const raw =
      typeof localStorage === "undefined" ? null : localStorage.getItem(PROJECTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedProjects>;
    if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.teams)) return null;
    return { username: parsed.username ?? "", teams: parsed.teams, projects: parsed.projects };
  } catch {
    return null;
  }
}

function writeCache(value: CachedProjects): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(value));
    }
  } catch {
    // A full or blocked storage only costs the offline copy.
  }
}

/** Signed out or forbidden: the copy must not stand in. Anything else (network, 5xx) may. */
function isAuthFailure(error: unknown): boolean {
  return error instanceof WgwRequestError && (error.status === 401 || error.status === 403);
}

export function createProjectsStore(operations: ProjectOperations): ProjectsStore {
  let snapshot: ProjectsSnapshot = EMPTY;
  let inFlight: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: ProjectsSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const fetchAll = async (): Promise<boolean> => {
    if (snapshot.status === "idle") set({ ...snapshot, status: "loading" });
    try {
      const [{ username, teams }, projects] = await Promise.all([
        operations.listTeams(),
        operations.list(),
      ]);
      writeCache({ username, teams, projects });
      set({ status: "ready", teams, projects: withTeamNames(projects, teams) });
      return true;
    } catch (error) {
      const cached = isAuthFailure(error) ? null : readCache();
      if (snapshot.status === "ready" || snapshot.status === "offline") {
        // Keep what is on screen; the next push or reconnect reads again.
      } else if (cached) {
        set({
          status: "offline",
          teams: cached.teams,
          projects: withTeamNames(cached.projects, cached.teams),
        });
      } else {
        set({ ...EMPTY, status: "error" });
      }
      return false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: () => {
      inFlight ??= fetchAll().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    create: async (request) => {
      const created = await operations.create(request);
      const projects = [
        ...snapshot.projects.filter((project) => project.id !== created.id),
        ...withTeamNames([created], snapshot.teams),
      ];
      set({ ...snapshot, projects });
      return projects[projects.length - 1] as WorkspaceProject;
    },
  };
}

let mockOperations: ProjectOperations | null = null;

/** Live REST with an API; one in-memory mock per page otherwise. */
export function defaultProjectOperations(): ProjectOperations {
  return createWorkspaceSource<ProjectOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwProjectOperations,
    createMockSource: mocksInBuild
      ? () => (mockOperations ??= createMockProjectOperations())
      : mocksNotInBuild,
  });
}

let sharedStore: ProjectsStore | null = null;

/** One store per page, shared by the filter, the create dialog and the apps. */
export function projectsStore(): ProjectsStore {
  sharedStore ??= createProjectsStore(defaultProjectOperations());
  return sharedStore;
}

export function resetProjectsStoreForTests(store: ProjectsStore | null = null): void {
  sharedStore = store;
  mockOperations = null;
}

export function useProjects(store: ProjectsStore = projectsStore()): ProjectsSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** Active Projects grouped per Team, the default Project first, then by name. */
export function projectsByTeam(
  snapshot: Pick<ProjectsSnapshot, "projects" | "teams">,
): { team: ProjectTeam; projects: WorkspaceProject[] }[] {
  return [...snapshot.teams]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((team) => ({
      team,
      projects: snapshot.projects
        .filter((project) => project.teamSlug === team.slug)
        .sort((a, b) =>
          a.isDefault !== b.isDefault ? (a.isDefault ? -1 : 1) : a.name.localeCompare(b.name),
        ),
    }))
    .filter((group) => group.projects.length > 0);
}
