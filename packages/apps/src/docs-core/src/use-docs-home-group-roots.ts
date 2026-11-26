import { useCallback, useEffect, useMemo, useState } from "react";
import type { DriveAPIOperations } from "@/lib/files/drive-types";
import type { DriveFile } from "@/lib/files/drive-models";
import { useTeamDisplayNames } from "@/lib/files/team-labels/use-team-display-names";
import { driveGroupRootsFromTeamNames } from "@/drive-core/src/drive-group-roots";
import {
  applyDocsHomeGroupDisplayNames,
  buildDocsHomeDrives,
  collectGroupRoots,
  fetchGroupRootsFromDrive,
  mergeGroupRoots,
  type DocsHomeDrive,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";

type UseDocsHomeGroupRootsArgs = {
  username: string;
  personalDriveLabel: string;
  operations?: DriveAPIOperations;
  online: boolean;
};

export type DocsHomeGroupRoots = {
  labeledGroupRoots: DocsHomeGroupRoot[];
  drives: DocsHomeDrive[];
  groupRootSlugs: string[];
  /**
   * Merge group roots found in the current file list.
   * Call this after `files` exists — the browse list needs `labeledGroupRoots`
   * first, so discovery cannot be an argument of this hook.
   */
  discoverFromFiles: (files: readonly DriveFile[]) => void;
};

/**
 * Group-root state for Docs home. Drive listing and settings labels load here.
 * File discovery stays behind {@link DocsHomeGroupRoots.discoverFromFiles} so
 * the browse list can be created with the roots from the previous pass.
 */
export function useDocsHomeGroupRoots({
  username,
  personalDriveLabel,
  operations,
  online,
}: UseDocsHomeGroupRootsArgs): DocsHomeGroupRoots {
  const [knownGroupRoots, setKnownGroupRoots] = useState<DocsHomeGroupRoot[]>([]);
  // Cached in the meta store, so team drives keep their name offline (#2063).
  const groupDirectory = useTeamDisplayNames(username, online);

  // Offline there is no `/groups` listing: the cached teams keep every team drive
  // listed. Only while offline, so a team left meanwhile drops out on reconnect.
  const visibleGroupRoots = useMemo(
    () =>
      online
        ? knownGroupRoots
        : mergeGroupRoots(knownGroupRoots, driveGroupRootsFromTeamNames(groupDirectory)),
    [groupDirectory, knownGroupRoots, online],
  );
  const labeledGroupRoots = useMemo(
    () => applyDocsHomeGroupDisplayNames(visibleGroupRoots, groupDirectory),
    [groupDirectory, visibleGroupRoots],
  );
  const groupRootSlugs = useMemo(
    () => labeledGroupRoots.map((root) => root.slug),
    [labeledGroupRoots],
  );
  const drives = useMemo(
    () => buildDocsHomeDrives(username, labeledGroupRoots, personalDriveLabel),
    [username, labeledGroupRoots, personalDriveLabel],
  );

  const discoverFromFiles = useCallback((files: readonly DriveFile[]) => {
    const discovered = collectGroupRoots(files);
    if (discovered.length === 0) return;
    // mergeGroupRoots returns `prev` when slug/label sets are unchanged so
    // setState bails out — otherwise labeledGroupRoots remaps files forever.
    setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
  }, []);

  useEffect(() => {
    if (!operations || !online) return;
    const controller = new AbortController();
    void fetchGroupRootsFromDrive(operations, { signal: controller.signal }).then((discovered) => {
      if (discovered.length === 0) return;
      setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
    });
    return () => controller.abort();
  }, [operations, online]);

  return {
    labeledGroupRoots,
    drives,
    groupRootSlugs,
    discoverFromFiles,
  };
}
