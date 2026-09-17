import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { getCard } from "@/lib/api/wgw/contacts";
import { WorkspaceLiveAppShell } from "@/lib/live/workspace-live-app-shell";
import {
  resolveConflictFieldMerge,
  resolveConflictKeepLocal,
  resolveConflictUseServer,
} from "@/lib/offline/contacts-conflict-resolution";
import {
  buildContactConflictFieldRows,
  defaultContactConflictFieldChoices,
  type ContactConflictFieldChoices,
  type ContactConflictFieldRow,
} from "@/lib/offline/contacts-conflict-merge";
import { listOutboxMutations } from "@/lib/offline/core/outbox-store";
import { contactsOutboxCardId } from "@/lib/offline/contacts-offline-store";
import { resolveContactsOfflineUsername } from "@/lib/offline/offline-session";
import type { ContactsApiSource } from "@/contacts-core/src/contacts-api-source";
import { ContactsConflictDialog } from "@/contacts-core/src/contacts-conflict-dialog";
import { contactDisplayName } from "@/contacts-core/src/contacts-display-utils";
import { defaultContactsLabels } from "@/contacts-core/src/contacts-labels";
import type { ContactCard } from "@/contacts-core/src/contacts-types";
import { ContactsWorkspace } from "@/contacts-core/src/contacts-workspace";
import { useContactsAPI } from "@/contacts-core/src/use-contacts-api";
import {
  contactsContactFromParams,
  contactsViewFromParams,
} from "@/contacts-core/src/contacts-route-search";

export type ContactsAppProps = {
  /** When set (e.g. Storybook live story), bypasses `wgwLiveApiEnabled()` routing. */
  apiSource?: ContactsApiSource;
};

type ConflictMergeContext = {
  fieldRows: ContactConflictFieldRow[];
  fieldChoices: ContactConflictFieldChoices;
};

export function ContactsApp({ apiSource }: ContactsAppProps = {}) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { groupCardId?: string; contactId?: string };
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;

  const cardsRef = useRef<ContactCard[]>([]);

  const [conflictQueue, setConflictQueue] = useState<string[]>([]);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [conflictMergeContext, setConflictMergeContext] = useState<ConflictMergeContext | null>(
    null,
  );
  const [conflictMergeLoading, setConflictMergeLoading] = useState(false);

  const handleSyncConflict = useCallback((cardIds: string[]) => {
    setConflictQueue((prev) => {
      const next = [...prev];
      for (const id of cardIds) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
  }, []);

  const {
    phase,
    error,
    retry,
    successVersion,
    listLoading,
    listRefreshing,
    refreshList,
    data,
    session,
    operations,
  } = useContactsAPI(apiSource, { onSyncConflict: handleSyncConflict });

  cardsRef.current = data.cards;

  const offlineUsername = resolveContactsOfflineUsername(session.user.username);
  const activeConflictId = conflictQueue[0] ?? null;
  const activeConflictCard = activeConflictId
    ? cardsRef.current.find((c) => c.id === activeConflictId)
    : undefined;
  const activeConflictName = activeConflictCard
    ? contactDisplayName(activeConflictCard)
    : (activeConflictId ?? "");

  const dismissActiveConflict = useCallback(() => {
    setConflictQueue((prev) => prev.slice(1));
    setConflictMergeContext(null);
  }, []);

  const finishConflictResolution = useCallback(
    (task: () => Promise<unknown>) => {
      if (!activeConflictId || !offlineUsername) {
        dismissActiveConflict();
        return;
      }
      setResolvingConflict(true);
      void (async () => {
        try {
          await task();
        } catch {
          // Resolution best-effort; the refresh below re-reads the latest state.
        } finally {
          setResolvingConflict(false);
          dismissActiveConflict();
          refreshList();
        }
      })();
    },
    [activeConflictId, offlineUsername, dismissActiveConflict, refreshList],
  );

  const resolveActiveConflictKeepLocal = useCallback(() => {
    finishConflictResolution(() => resolveConflictKeepLocal(offlineUsername!, activeConflictId!));
  }, [finishConflictResolution, offlineUsername, activeConflictId]);

  const resolveActiveConflictUseServer = useCallback(() => {
    finishConflictResolution(() => resolveConflictUseServer(offlineUsername!, activeConflictId!));
  }, [finishConflictResolution, offlineUsername, activeConflictId]);

  const handleFieldChoicesChange = useCallback((choices: ContactConflictFieldChoices) => {
    setConflictMergeContext((prev) => (prev ? { ...prev, fieldChoices: choices } : prev));
  }, []);

  const resolveActiveConflictFieldMerge = useCallback(
    (choices: ContactConflictFieldChoices) => {
      if (!activeConflictCard) {
        dismissActiveConflict();
        return;
      }
      finishConflictResolution(() =>
        resolveConflictFieldMerge(offlineUsername!, activeConflictId!, activeConflictCard, choices),
      );
    },
    [
      activeConflictCard,
      finishConflictResolution,
      offlineUsername,
      activeConflictId,
      dismissActiveConflict,
    ],
  );

  useEffect(() => {
    if (!activeConflictId || !offlineUsername || !activeConflictCard) {
      setConflictMergeContext(null);
      setConflictMergeLoading(false);
      return;
    }

    let cancelled = false;
    setConflictMergeLoading(true);
    setConflictMergeContext(null);

    void (async () => {
      try {
        const rows = await listOutboxMutations(offlineUsername);
        const pending = rows.filter((row) => contactsOutboxCardId(row) === activeConflictId);
        const hasUpdate = pending.some((row) => row.op === "update");
        if (!hasUpdate) {
          if (!cancelled) setConflictMergeContext(null);
          return;
        }

        const serverCard = await getCard(activeConflictId);
        const fieldRows = buildContactConflictFieldRows(
          serverCard,
          activeConflictCard,
          defaultContactsLabels,
        );
        if (!cancelled) {
          setConflictMergeContext({
            fieldRows,
            fieldChoices: defaultContactConflictFieldChoices(fieldRows),
          });
        }
      } catch {
        if (!cancelled) setConflictMergeContext(null);
      } finally {
        if (!cancelled) setConflictMergeLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeConflictId, offlineUsername, activeConflictCard]);

  const fieldMergeMode = useMemo(
    () => Boolean(conflictMergeContext && conflictMergeContext.fieldRows.length > 0),
    [conflictMergeContext],
  );

  // Backward compat: redirect legacy query-param URLs (?view=&contact=) to new path form.
  // Runs once on mount; if no legacy params are present this is a no-op.
  useEffect(() => {
    const legacyView = typeof rawSearch.view === "string" ? rawSearch.view.trim() : "";
    const legacyContact = typeof rawSearch.contact === "string" ? rawSearch.contact.trim() : "";
    if (!legacyView && !legacyContact) return;

    if (legacyView.startsWith("group:") && legacyContact) {
      const groupId = legacyView.slice("group:".length);
      void navigate({
        to: "/contacts/groups/$groupCardId/$contactId",
        params: { groupCardId: groupId, contactId: legacyContact },
        replace: true,
      });
    } else if (legacyView.startsWith("group:")) {
      const groupId = legacyView.slice("group:".length);
      void navigate({
        to: "/contacts/groups/$groupCardId",
        params: { groupCardId: groupId },
        replace: true,
      });
    } else if (legacyContact) {
      void navigate({
        to: "/contacts/all/$contactId",
        params: { contactId: legacyContact },
        replace: true,
      });
    } else {
      void navigate({ to: "/contacts/all", replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "error" || !error) return;
    const message = typeof error === "string" ? error : String(error);
    if (!message.includes("CONTACTS_SETTINGS_MISSING")) return;
    void navigate({ to: "/settings" });
  }, [error, navigate, phase]);

  const initialView = useMemo(() => contactsViewFromParams(params), [params]);
  const initialContactId = useMemo(() => contactsContactFromParams(params), [params]);

  // Refs track the latest view/contact for URL construction inside callbacks,
  // avoiding stale-closure issues without adding reactive dependencies.
  const currentViewRef = useRef<string>(initialView);
  const currentContactRef = useRef<string>(initialContactId);

  useEffect(() => {
    currentViewRef.current = initialView;
  }, [initialView]);

  useEffect(() => {
    currentContactRef.current = initialContactId;
  }, [initialContactId]);

  const handleViewChange = useCallback(
    (view: string) => {
      currentViewRef.current = view;
      currentContactRef.current = "";
      if (view.startsWith("group:")) {
        const groupId = view.slice("group:".length);
        void navigate({
          to: "/contacts/groups/$groupCardId",
          params: { groupCardId: groupId },
          replace: true,
        });
      } else {
        void navigate({ to: "/contacts/all", replace: true });
      }
    },
    [navigate],
  );

  const handleContactChange = useCallback(
    (contactId: string) => {
      if (currentContactRef.current === contactId) return;
      currentContactRef.current = contactId;
      const view = currentViewRef.current;
      startTransition(() => {
        if (!contactId) {
          if (view.startsWith("group:")) {
            const groupId = view.slice("group:".length);
            void navigate({
              to: "/contacts/groups/$groupCardId",
              params: { groupCardId: groupId },
              replace: true,
            });
            return;
          }
          void navigate({ to: "/contacts/all", replace: true });
          return;
        }
        if (view.startsWith("group:")) {
          const groupId = view.slice("group:".length);
          void navigate({
            to: "/contacts/groups/$groupCardId/$contactId",
            params: { groupCardId: groupId, contactId },
            replace: true,
          });
          return;
        }
        void navigate({
          to: "/contacts/all/$contactId",
          params: { contactId },
          replace: true,
        });
      });
    },
    [navigate],
  );

  return (
    <>
      <WorkspaceLiveAppShell
        phase={phase}
        error={error}
        retry={retry}
        errorTitle="Could not load live contacts"
        successVersion={successVersion}
        render={(key) => (
          <ContactsWorkspace
            key={key}
            data={data}
            session={session}
            operations={operations}
            listLoading={listLoading}
            listRefreshing={listRefreshing}
            onRefreshList={refreshList}
            initialView={initialView}
            initialContactId={initialContactId}
            onViewChange={handleViewChange}
            onContactChange={handleContactChange}
            onLogout={() => {
              window.location.assign("/logout");
            }}
          />
        )}
      />
      <ContactsConflictDialog
        open={activeConflictId !== null && (!conflictMergeLoading || fieldMergeMode)}
        contactName={activeConflictName}
        remainingCount={Math.max(conflictQueue.length - 1, 0)}
        busy={resolvingConflict || conflictMergeLoading}
        labels={defaultContactsLabels}
        fieldRows={fieldMergeMode ? conflictMergeContext?.fieldRows : undefined}
        fieldChoices={conflictMergeContext?.fieldChoices}
        onFieldChoicesChange={handleFieldChoicesChange}
        onConfirmMerge={resolveActiveConflictFieldMerge}
        onKeepLocal={resolveActiveConflictKeepLocal}
        onUseServer={resolveActiveConflictUseServer}
        onOpenChange={(open) => {
          if (!open && !resolvingConflict && !conflictMergeLoading) dismissActiveConflict();
        }}
      />
    </>
  );
}
