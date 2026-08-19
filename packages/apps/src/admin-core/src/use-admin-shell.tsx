import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSection } from "@/admin-core/src/admin-types";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";
import {
  buildAdminSettingsFormState,
  mergePendingApplyPoll,
  type AdminSettingsFormState,
} from "@/admin-core/src/admin-settings-form-utils";
import { useAdminSidebarModel } from "@/admin-core/src/use-admin-sidebar-model";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";

export type UseAdminShellArgs = Pick<AdminWorkspaceProps, "data" | "operations">;

export function useAdminShell({ data, operations }: UseAdminShellArgs) {
  const [section, setSection] = useState<AdminSection>("users");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [users, setUsers] = useState(data.users);
  const [groups, setGroups] = useState(data.groups);
  const [plugins, setPlugins] = useState(data.plugins);
  const [settingsForm, setSettingsForm] = useState<AdminSettingsFormState>(() =>
    buildAdminSettingsFormState(data),
  );
  const [mailDelivery, setMailDelivery] = useState(data.mailDelivery);
  const [updates, setUpdates] = useState(data.updates);
  const [searchReindex, setSearchReindex] = useState(data.searchReindex);
  const [updateLogLines, setUpdateLogLines] = useState(data.updateLogLines);
  const applyRequestPendingRef = useRef(false);
  const sections = useAdminSidebarModel();

  useEffect(() => {
    setUsers(data.users);
    setGroups(data.groups);
    setPlugins(data.plugins);
    setUpdates(data.updates);
    setSearchReindex(data.searchReindex);
    setUpdateLogLines(data.updateLogLines);
    setMailDelivery(data.mailDelivery);
  }, [data]);

  const applyAdminData = (next: AdminWorkspaceProps["data"]) => {
    setUsers(next.users);
    setGroups(next.groups);
    setPlugins(next.plugins);
    setSettingsForm(buildAdminSettingsFormState(next));
    setUpdates(next.updates);
    setSearchReindex(next.searchReindex);
    setUpdateLogLines(next.updateLogLines);
    setMailDelivery(next.mailDelivery);
  };

  useEffect(() => {
    const refreshProgress = operations?.refreshUpdateState;
    const refreshAll = operations?.refreshState;
    if (!refreshProgress && !refreshAll) return;
    let cancelled = false;
    let timeoutId: number | null = null;

    const poll = async () => {
      try {
        if (refreshProgress) {
          const nextUpdates = await refreshProgress();
          if (!cancelled) {
            setUpdates((prev) => {
              if (applyRequestPendingRef.current && !nextUpdates.inProgress) {
                return mergePendingApplyPoll(prev, nextUpdates);
              }
              return nextUpdates;
            });
          }
        } else if (refreshAll) {
          const next = await refreshAll();
          if (!cancelled) {
            setUpdates((prev) => {
              if (applyRequestPendingRef.current && !next.updates.inProgress) {
                return mergePendingApplyPoll(prev, next.updates);
              }
              return next.updates;
            });
            setUpdateLogLines(next.updateLogLines);
          }
        }
      } catch {
        // Keep showing existing progress if a poll fails temporarily.
      }
    };

    const schedulePoll = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(
        () => {
          void poll().finally(() => {
            schedulePoll();
          });
        },
        updates.inProgress ? 2000 : 4000,
      );
    };

    void poll().finally(() => {
      schedulePoll();
    });

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [updates.inProgress, operations?.refreshState, operations?.refreshUpdateState]);

  useEffect(() => {
    const refresh = operations?.refreshSearchReindexState;
    if (!refresh) return;
    if (!searchReindex.inProgress && section !== "search") return;
    let cancelled = false;
    let timeoutId: number | null = null;

    const tick = async () => {
      try {
        const next = await refresh();
        if (!cancelled) {
          setSearchReindex(next);
        }
      } catch {
        // Keep existing state when polling temporarily fails.
      }
    };

    const schedule = () => {
      if (cancelled) return;
      timeoutId = window.setTimeout(
        () => {
          void tick().finally(schedule);
        },
        searchReindex.inProgress ? 2000 : 5000,
      );
    };

    void tick().finally(schedule);

    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [operations?.refreshSearchReindexState, searchReindex.inProgress, section]);

  const currentSection = useMemo(
    () => sections.find((candidate) => candidate.id === section) ?? sections[0],
    [section, sections],
  );

  const selectSection = (nextSection: AdminSection) => {
    setSection(nextSection);
    if (isSidebarOverlayViewport()) {
      setSidebarOpen(false);
    }
  };

  return {
    section,
    sections,
    currentSection,
    sidebarOpen,
    setSidebarOpen,
    selectSection,
    users,
    setUsers,
    groups,
    setGroups,
    plugins,
    setPlugins,
    settingsForm,
    setSettingsForm,
    mailDelivery,
    setMailDelivery,
    updates,
    setUpdates,
    searchReindex,
    setSearchReindex,
    updateLogLines,
    setUpdateLogLines,
    applyAdminData,
    applyRequestPendingRef,
  };
}

export type AdminShellState = ReturnType<typeof useAdminShell>;
