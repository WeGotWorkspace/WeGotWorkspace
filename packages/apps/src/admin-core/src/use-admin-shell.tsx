import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSection } from "@/lib/models/admin-types";
import type { AdminWorkspaceProps } from "@/admin-core/src/admin-workspace-props";
import { ADMIN_DEFAULT_SECTION, resolveAdminSection } from "@/admin-core/src/admin-section";
import {
  buildAdminSettingsFormState,
  type AdminSettingsFormState,
} from "@/admin-core/src/admin-settings-form-utils";
import { useAdminUpdatePoll } from "@/admin-core/src/use-admin-update-poll";
import { useAdminSidebarModel } from "@/admin-core/src/use-admin-sidebar-model";
import { dismissSidebarOverlay } from "@/workspace-shell/src/sidebar-breakpoint";

export type UseAdminShellArgs = Pick<
  AdminWorkspaceProps,
  "data" | "operations" | "section" | "initialSection" | "onSectionChange"
>;

export function useAdminShell({
  data,
  operations,
  section: sectionProp,
  initialSection,
  onSectionChange,
}: UseAdminShellArgs) {
  const isControlled = sectionProp !== undefined;
  const [internalSection, setInternalSection] = useState<AdminSection>(() =>
    resolveAdminSection(initialSection ?? ADMIN_DEFAULT_SECTION),
  );
  const requestedSection = resolveAdminSection(isControlled ? sectionProp : internalSection);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [users, setUsers] = useState(data.users);
  const [currentUser, setCurrentUser] = useState(data.currentUser);
  const [groups, setGroups] = useState(data.groups);
  const [settingsForm, setSettingsForm] = useState<AdminSettingsFormState>(() =>
    buildAdminSettingsFormState(data),
  );
  const [mailDelivery, setMailDelivery] = useState(data.mailDelivery);
  const [securityWarnings, setSecurityWarnings] = useState(data.securityWarnings);
  const [updates, setUpdates] = useState(data.updates);
  const [searchReindex, setSearchReindex] = useState(data.searchReindex);
  const [updateLogLines, setUpdateLogLines] = useState(data.updateLogLines);
  const applyRequestPendingRef = useRef(false);
  const sections = useAdminSidebarModel({ installChannel: updates.installChannel });
  // A section this install does not have (Backups on Docker) opens the default one.
  const section = sections.some((candidate) => candidate.id === requestedSection)
    ? requestedSection
    : ADMIN_DEFAULT_SECTION;

  // The address follows the page shown (e.g. /admin/backups on Docker shows Users).
  useEffect(() => {
    if (section === requestedSection) return;
    if (isControlled) onSectionChange?.(section, { replace: true });
    else setInternalSection(section);
  }, [isControlled, onSectionChange, requestedSection, section]);

  useEffect(() => {
    setUsers(data.users);
    setCurrentUser(data.currentUser);
    setGroups(data.groups);
    setUpdates(data.updates);
    setSearchReindex(data.searchReindex);
    setUpdateLogLines(data.updateLogLines);
    setMailDelivery(data.mailDelivery);
    setSecurityWarnings(data.securityWarnings);
  }, [data]);

  const applyAdminData = (next: AdminWorkspaceProps["data"]) => {
    setUsers(next.users);
    setCurrentUser(next.currentUser);
    setGroups(next.groups);
    setSettingsForm(buildAdminSettingsFormState(next));
    setUpdates(next.updates);
    setSearchReindex(next.searchReindex);
    setUpdateLogLines(next.updateLogLines);
    setMailDelivery(next.mailDelivery);
    setSecurityWarnings(next.securityWarnings);
  };

  useAdminUpdatePoll({
    operations,
    inProgress: updates.inProgress,
    setUpdates,
    applyRequestPendingRef,
  });

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
    const resolved = resolveAdminSection(nextSection);
    if (!isControlled) {
      setInternalSection(resolved);
    }
    onSectionChange?.(resolved);
    dismissSidebarOverlay(() => setSidebarOpen(false));
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
    currentUser,
    groups,
    setGroups,
    settingsForm,
    setSettingsForm,
    mailDelivery,
    setMailDelivery,
    securityWarnings,
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
