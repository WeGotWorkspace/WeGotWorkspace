import { useCallback, useEffect, useMemo, useState } from "react";
import type { DriveAPIOperations } from "@/drive-core/src/drive-types";
import type { DriveFile } from "@/drive-core/src/drive-models";
import { wgwFetch, wgwLiveApiEnabled, wgwReadJson } from "@/lib/api/wgw/http";
import {
  applyDocsHomeGroupDisplayNames,
  buildDocsHomeDrives,
  collectGroupRoots,
  fetchGroupRootsFromDrive,
  mergeGroupRoots,
  type DocsHomeDrive,
  type DocsHomeGroupRoot,
} from "@/docs-core/src/docs-home-drives";

type DocsHomeGroupDirectory = readonly { id: string; displayName: string }[];

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
  const [groupDirectory, setGroupDirectory] = useState<DocsHomeGroupDirectory>([]);

  const labeledGroupRoots = useMemo(
    () => applyDocsHomeGroupDisplayNames(knownGroupRoots, groupDirectory),
    [groupDirectory, knownGroupRoots],
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

  useEffect(() => {
    if (!online || !wgwLiveApiEnabled()) return;
    const controller = new AbortController();
    void wgwFetch("/settings/state", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const json = (await wgwReadJson(res)) as {
          groups?: { id: string; displayName: string }[];
        };
        if (Array.isArray(json.groups)) setGroupDirectory(json.groups);
      })
      .catch(() => {
        /* best-effort labels only */
      });
    return () => controller.abort();
  }, [online]);

  return {
    labeledGroupRoots,
    drives,
    groupRootSlugs,
    discoverFromFiles,
  };
}
