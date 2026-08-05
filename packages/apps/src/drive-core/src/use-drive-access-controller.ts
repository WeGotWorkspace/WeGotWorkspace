import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { buildDriveFolderBreadcrumbs } from "@/drive-core/src/drive-breadcrumbs";
import { driveLabels } from "@/drive-core/src/drive-labels";
import type { ViewKey } from "@/drive-core/src/drive-models";
import {
  apiPathFromUiPath,
  normalizeDriveFolderUiPath,
  uiPathFromApiPath,
} from "@/drive-core/src/drive-path-utils";
import {
  driveAccessDisplayRows,
  driveAccessSubtreeCounts,
  driveAccessSubtitle,
  type DriveAccessFilter,
} from "@/drive-core/src/drive-access-utils";
import type { DriveAPIOperations, DriveShareOperations } from "@/drive-core/src/drive-types";
import type { DriveShareAtPath, DriveShareByPrincipal } from "@wgw-api-generated/drive-types";

export type AccessTreeChild = {
  name: string;
  uiPath: string;
};

export type UseDriveAccessControllerArgs = {
  shareOperations: DriveShareOperations;
  operations?: DriveAPIOperations;
  username: string;
  sidebarGroupPaths: string[];
  groupRootNames: Set<string>;
  view: ViewKey;
  onViewChange?: (view: ViewKey) => void;
  onOpenShare?: (apiPath: string) => void;
};

export function useDriveAccessController({
  shareOperations,
  operations,
  username,
  sidebarGroupPaths,
  groupRootNames,
  view,
  onViewChange,
  onOpenShare,
}: UseDriveAccessControllerArgs) {
  const { showError, showSuccess } = useAppToast();

  const scopePath = useMemo(() => {
    if (view.type !== "access") return "My Drive";
    return normalizeDriveFolderUiPath(view.scopePath ?? "My Drive");
  }, [view]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(["My Drive"]));
  const [treeChildren, setTreeChildren] = useState<Record<string, AccessTreeChild[]>>({});
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState<DriveAccessFilter>("all");
  const [query, setQuery] = useState("");
  const [atPath, setAtPath] = useState<DriveShareAtPath | null>(null);
  const [atPathLoading, setAtPathLoading] = useState(false);
  const [personPrincipal, setPersonPrincipal] = useState<string | null>(null);
  const [personData, setPersonData] = useState<DriveShareByPrincipal | null>(null);
  const [personLoading, setPersonLoading] = useState(false);
  const [revokeLoading, setRevokeLoading] = useState(false);
  const atPathRequestRef = useRef(0);
  const personRequestRef = useRef(0);

  const activeApiPath = useMemo(
    () => apiPathFromUiPath(scopePath, username, groupRootNames),
    [groupRootNames, scopePath, username],
  );

  const scopeRoots = useMemo(() => ["My Drive", ...sidebarGroupPaths], [sidebarGroupPaths]);

  const breadcrumbs = useMemo(
    () => buildDriveFolderBreadcrumbs(scopePath, driveLabels),
    [scopePath],
  );

  const subtreeCounts = useMemo(() => driveAccessSubtreeCounts(atPath), [atPath]);
  const subtitle = useMemo(() => driveAccessSubtitle(subtreeCounts), [subtreeCounts]);
  const displayRows = useMemo(
    () => driveAccessDisplayRows(atPath, filter, query),
    [atPath, filter, query],
  );

  const setScopePath = useCallback(
    (nextPath: string) => {
      const normalized = normalizeDriveFolderUiPath(nextPath);
      onViewChange?.({ type: "access", scopePath: normalized });
    },
    [onViewChange],
  );

  const loadAtPath = useCallback(
    async (apiPath: string) => {
      const requestId = atPathRequestRef.current + 1;
      atPathRequestRef.current = requestId;
      setAtPathLoading(true);
      try {
        const payload = await shareOperations.getAtPath(apiPath);
        if (atPathRequestRef.current !== requestId) return;
        setAtPath(payload);
      } catch (error: unknown) {
        if (atPathRequestRef.current !== requestId) return;
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
        setAtPath(null);
      } finally {
        if (atPathRequestRef.current === requestId) {
          setAtPathLoading(false);
        }
      }
    },
    [shareOperations, showError],
  );

  useEffect(() => {
    if (view.type !== "access") return;
    void loadAtPath(activeApiPath);
  }, [activeApiPath, loadAtPath, view.type]);

  const loadTreeChildren = useCallback(
    async (uiPath: string) => {
      if (!operations || treeChildren[uiPath] || treeLoadingPaths.has(uiPath)) return;
      setTreeLoadingPaths((prev) => new Set(prev).add(uiPath));
      try {
        const apiPath = apiPathFromUiPath(uiPath, username, groupRootNames);
        const data = await operations.listDirectory(apiPath);
        const resolvedUiPath = uiPathFromApiPath(data.cwd, username);
        const folders = data.directory.files
          .filter((entry) => entry.type === "dir")
          .map((entry) => {
            const childUiPath =
              resolvedUiPath === "My Drive"
                ? `My Drive/${entry.name}`
                : `${resolvedUiPath}/${entry.name}`;
            return { name: entry.name, uiPath: childUiPath };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setTreeChildren((prev) => ({ ...prev, [uiPath]: folders }));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        showError(message);
      } finally {
        setTreeLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(uiPath);
          return next;
        });
      }
    },
    [groupRootNames, operations, showError, treeChildren, treeLoadingPaths, username],
  );

  const toggleExpanded = useCallback(
    (uiPath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(uiPath)) {
          next.delete(uiPath);
        } else {
          next.add(uiPath);
          void loadTreeChildren(uiPath);
        }
        return next;
      });
    },
    [loadTreeChildren],
  );

  const openPerson = useCallback(
    (principal: string) => {
      setPersonPrincipal(principal);
      const requestId = personRequestRef.current + 1;
      personRequestRef.current = requestId;
      setPersonLoading(true);
      void shareOperations
        .getByPrincipal(principal, activeApiPath)
        .then((payload) => {
          if (personRequestRef.current !== requestId) return;
          setPersonData(payload);
        })
        .catch((error: unknown) => {
          if (personRequestRef.current !== requestId) return;
          const message = error instanceof Error ? error.message : String(error);
          showError(message);
          setPersonData(null);
        })
        .finally(() => {
          if (personRequestRef.current === requestId) {
            setPersonLoading(false);
          }
        });
    },
    [activeApiPath, shareOperations, showError],
  );

  const closePerson = useCallback(() => {
    personRequestRef.current += 1;
    setPersonPrincipal(null);
    setPersonData(null);
    setPersonLoading(false);
  }, []);

  const revokeAllPublic = useCallback(async () => {
    if (!atPath?.publicShares.length) return;
    setRevokeLoading(true);
    try {
      await shareOperations.revokeAllPublic(activeApiPath);
      showSuccess(driveLabels.accessRevokeSuccess);
      await loadAtPath(activeApiPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showError(message);
    } finally {
      setRevokeLoading(false);
    }
  }, [
    activeApiPath,
    atPath?.publicShares.length,
    loadAtPath,
    shareOperations,
    showError,
    showSuccess,
  ]);

  const manageShare = useCallback(() => {
    if (atPath?.myRights.mayShare !== true) return;
    onOpenShare?.(activeApiPath);
  }, [activeApiPath, atPath?.myRights.mayShare, onOpenShare]);

  const navigateScopeFromBreadcrumb = useCallback(
    (path: string) => {
      setScopePath(path);
    },
    [setScopePath],
  );

  const navigateScopeFromVia = useCallback(
    (apiSharePath: string) => {
      setScopePath(uiPathFromApiPath(apiSharePath, username));
    },
    [setScopePath, username],
  );

  return {
    labels: driveLabels,
    scopePath,
    setScopePath,
    scopeRoots,
    expandedPaths,
    toggleExpanded,
    treeChildren,
    treeLoadingPaths,
    filter,
    setFilter,
    query,
    setQuery,
    atPath,
    atPathLoading,
    displayRows,
    subtreeCounts,
    subtitle,
    breadcrumbs,
    activeApiPath,
    personPrincipal,
    personData,
    personLoading,
    openPerson,
    closePerson,
    revokeAllPublic,
    revokeLoading,
    manageShare,
    navigateScopeFromBreadcrumb,
    navigateScopeFromVia,
    username,
  };
}

export type DriveAccessController = ReturnType<typeof useDriveAccessController>;
