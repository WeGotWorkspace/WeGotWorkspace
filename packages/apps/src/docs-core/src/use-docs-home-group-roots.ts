import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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

type UseDocsHomeGroupRootModelArgs = {
  username: string;
  personalDriveLabel: string;
};

export type DocsHomeGroupRootModel = {
  labeledGroupRoots: DocsHomeGroupRoot[];
  drives: DocsHomeDrive[];
  groupRootSlugs: string[];
  groupRootNames: Set<string>;
  setKnownGroupRoots: Dispatch<SetStateAction<DocsHomeGroupRoot[]>>;
  setGroupDirectory: Dispatch<SetStateAction<DocsHomeGroupDirectory>>;
};

/**
 * Group-root state for Docs home. Call this before the browse list so labeled
 * roots are available as listing input. Discovery runs later via
 * {@link useDocsHomeGroupRootEffects} once `files` exists.
 */
export function useDocsHomeGroupRootModel({
  username,
  personalDriveLabel,
}: UseDocsHomeGroupRootModelArgs): DocsHomeGroupRootModel {
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
  const groupRootNames = useMemo(
    () => new Set(labeledGroupRoots.map((root) => root.slug)),
    [labeledGroupRoots],
  );
  const drives = useMemo(
    () => buildDocsHomeDrives(username, labeledGroupRoots, personalDriveLabel),
    [username, labeledGroupRoots, personalDriveLabel],
  );

  return {
    labeledGroupRoots,
    drives,
    groupRootSlugs,
    groupRootNames,
    setKnownGroupRoots,
    setGroupDirectory,
  };
}

type UseDocsHomeGroupRootEffectsArgs = {
  operations?: DriveAPIOperations;
  online: boolean;
  files: readonly DriveFile[];
  setKnownGroupRoots: Dispatch<SetStateAction<DocsHomeGroupRoot[]>>;
  setGroupDirectory: Dispatch<SetStateAction<DocsHomeGroupDirectory>>;
};

/** Load group roots from Drive, settings labels, and the files already on screen. */
export function useDocsHomeGroupRootEffects({
  operations,
  online,
  files,
  setKnownGroupRoots,
  setGroupDirectory,
}: UseDocsHomeGroupRootEffectsArgs): void {
  useEffect(() => {
    if (!operations || !online) return;
    const controller = new AbortController();
    void fetchGroupRootsFromDrive(operations, { signal: controller.signal }).then((discovered) => {
      if (discovered.length === 0) return;
      setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
    });
    return () => controller.abort();
  }, [operations, online, setKnownGroupRoots]);

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
  }, [online, setGroupDirectory]);

  useEffect(() => {
    const discovered = collectGroupRoots(files);
    if (discovered.length === 0) return;
    // mergeGroupRoots returns `prev` when slug/label sets are unchanged so
    // setState bails out — otherwise labeledGroupRoots remaps files forever.
    setKnownGroupRoots((prev) => mergeGroupRoots(prev, discovered));
  }, [files, setKnownGroupRoots]);
}
