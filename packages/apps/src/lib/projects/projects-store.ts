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
import { resolveOfflineUsername } from "@/lib/offline/core/offline-account";
import type {
  Project,
  ProjectCreateRequest,
  ProjectPatchRequest,
} from "@wgw/openapi-types/projects-types";

/** A Project as the apps show it: the API record plus its Team's name. */
export type WorkspaceProject = Project & { teamName: string };

export type ProjectsStatus = "idle" | "loading" | "ready" | "offline" | "error";

export type ProjectsSnapshot = {
  status: ProjectsStatus;
  /** Active Projects of the user's Teams; archived ones are not listed. */
  projects: readonly WorkspaceProject[];
  teams: readonly ProjectTeam[];
  /** Archived Projects; empty until `loadArchived` ran (only Settings lists them). */
  archived: readonly WorkspaceProject[];
};

export type ProjectsStore = {
  getSnapshot: () => ProjectsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Reads the list again; concurrent calls share one request. Resolves false on failure. */
  load: () => Promise<boolean>;
  /** Reads the archived Projects of the caller's Teams. Resolves false on failure. */
  loadArchived: () => Promise<boolean>;
  create: (request: ProjectCreateRequest) => Promise<WorkspaceProject>;
  /** Rename or recolor. Resolves with the stored Project; it stays in its list. */
  patch: (id: string, patch: ProjectPatchRequest) => Promise<WorkspaceProject>;
  /** Moves the Project from the active list to the archived one. */
  archive: (id: string) => Promise<WorkspaceProject>;
  /** Moves the Project back to the active list. */
  unarchive: (id: string) => Promise<WorkspaceProject>;
  /** Deletes an archived Project for good and drops it from the archived list. */
  purge: (id: string) => Promise<void>;
};

/**
 * Last good list, so the filter still works offline. Overwritten by every successful load.
 * Under the `wgw.offline.` prefix, so the logout wipe removes it with the other offline copies.
 */
export const PROJECTS_CACHE_KEY = "wgw.offline.projects.cache";

type CachedProjects = { username: string; teams: ProjectTeam[]; projects: Project[] };

const EMPTY: ProjectsSnapshot = { status: "idle", projects: [], teams: [], archived: [] };

function withTeamNames(
  projects: readonly Project[],
  teams: readonly ProjectTeam[],
  archived = false,
) {
  const names = new Map(teams.map((team) => [team.slug, team.displayName]));
  return projects
    .filter((project) => project.archived === archived)
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

/** The account this device last signed in as; null when signed out or unknown. */
function rememberedUsername(): string | null {
  return resolveOfflineUsername("drive", undefined);
}

export function createProjectsStore(
  operations: ProjectOperations,
  currentUsername: () => string | null = rememberedUsername,
): ProjectsStore {
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
      set({ ...snapshot, status: "ready", teams, projects: withTeamNames(projects, teams) });
      return true;
    } catch (error) {
      const stored = isAuthFailure(error) ? null : readCache();
      // Another account's copy never stands in.
      const username = currentUsername();
      const cached = stored && (!username || stored.username === username) ? stored : null;
      if (snapshot.status === "ready" || snapshot.status === "offline") {
        // Keep what is on screen; the next push or reconnect reads again.
      } else if (cached) {
        set({
          ...snapshot,
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
    loadArchived: async () => {
      try {
        const archived = await operations.list({ archived: true });
        set({ ...snapshot, archived: withTeamNames(archived, snapshot.teams, true) });
        return true;
      } catch {
        return false;
      }
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
    patch: async (id, request) => {
      const stored = await operations.patch(id, request);
      const replace = (list: readonly WorkspaceProject[]) =>
        list.map((project) =>
          project.id === id ? { ...stored, teamName: project.teamName } : project,
        );
      const projects = replace(snapshot.projects);
      const archived = replace(snapshot.archived);
      set({ ...snapshot, projects, archived });
      return [...projects, ...archived].find((project) => project.id === id) as WorkspaceProject;
    },
    archive: async (id) => {
      const stored = await operations.archive(id);
      const [moved] = withTeamNames([stored], snapshot.teams, true);
      set({
        ...snapshot,
        projects: snapshot.projects.filter((project) => project.id !== id),
        archived: moved
          ? [...snapshot.archived.filter((p) => p.id !== id), moved]
          : snapshot.archived,
      });
      return moved as WorkspaceProject;
    },
    unarchive: async (id) => {
      const stored = await operations.unarchive(id);
      const [moved] = withTeamNames([stored], snapshot.teams);
      set({
        ...snapshot,
        projects: moved
          ? [...snapshot.projects.filter((p) => p.id !== id), moved]
          : snapshot.projects,
        archived: snapshot.archived.filter((project) => project.id !== id),
      });
      return moved as WorkspaceProject;
    },
    purge: async (id) => {
      await operations.purge(id);
      set({ ...snapshot, archived: snapshot.archived.filter((project) => project.id !== id) });
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

/** Sign-out: the next sign-in starts with an empty store. */
export function resetProjectsStore(): void {
  sharedStore = null;
  mockOperations = null;
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
  return groupByTeam(snapshot.teams, snapshot.projects);
}

/** Archived Projects grouped per Team, by name. */
export function archivedProjectsByTeam(
  snapshot: Pick<ProjectsSnapshot, "archived" | "teams">,
): { team: ProjectTeam; projects: WorkspaceProject[] }[] {
  return groupByTeam(snapshot.teams, snapshot.archived);
}

function groupByTeam(
  teams: readonly ProjectTeam[],
  list: readonly WorkspaceProject[],
): { team: ProjectTeam; projects: WorkspaceProject[] }[] {
  return [...teams]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((team) => ({
      team,
      projects: list
        .filter((project) => project.teamSlug === team.slug)
        .sort((a, b) =>
          a.isDefault !== b.isDefault ? (a.isDefault ? -1 : 1) : a.name.localeCompare(b.name),
        ),
    }))
    .filter((group) => group.projects.length > 0);
}
