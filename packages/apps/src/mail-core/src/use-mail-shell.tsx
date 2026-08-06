import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceAppHandle } from "@/workspace-app/src/workspace-app";
import { isSidebarOverlayViewport } from "@/workspace-shell/src/sidebar-breakpoint";
import type { Mail } from "@/types/mail";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type {
  MailboxSummary,
  MailMailboxLoader,
  MailAPIOperations,
} from "@/mail-core/src/mail-types";
import { mergeMailLabels, type MailUILabels } from "@/mail-core/src/mail-app.stories.fixtures";
import { withDetailLoadedFlag } from "@/mail-core/src/mail-compose-draft";
import { compareMailDesc } from "@/mail-core/src/mail-date-utils";
import { rowMatchesMailboxLabel } from "@/mail-core/src/mail-visible-items";

const DEFAULT_MAILBOX_PAGE_SIZE = 40;
const PRIMARY_MAILBOXES = ["Inbox", "Starred"] as const;

type MailboxLoadState = {
  offset: number;
  hasMore: boolean;
  loading: boolean;
};

export type UseMailShellArgs = {
  messages: Mail[];
  mailboxes: MailboxSummary[];
  session: WorkspaceSession;
  labels?: Partial<MailUILabels>;
  listLoading: boolean;
  systemMailboxes: readonly string[];
  encodeFolderToken: (label: string) => string;
  mailboxLoader?: MailMailboxLoader;
  operations?: MailAPIOperations;
  initialActiveId?: string;
};

export function useMailShell({
  messages,
  mailboxes,
  session,
  labels,
  listLoading,
  systemMailboxes,
  encodeFolderToken,
  mailboxLoader,
  operations,
  initialActiveId: _initialActiveId = "",
}: UseMailShellArgs) {
  const L = useMemo(() => mergeMailLabels(labels), [labels]);
  const allSystemMailboxes = systemMailboxes;
  const mailboxMetadata = mailboxes;
  const secondarySystemMailboxes = useMemo(
    () => allSystemMailboxes.filter((mailbox) => mailbox !== "Inbox" && mailbox !== "Starred"),
    [allSystemMailboxes],
  );
  const moreMailboxes = useMemo(() => {
    const excluded = new Set<string>([...PRIMARY_MAILBOXES, ...allSystemMailboxes]);
    return mailboxMetadata
      .map((mailbox) => mailbox.label)
      .filter((label, idx, arr) => arr.indexOf(label) === idx)
      .filter((label) => !excluded.has(label));
  }, [allSystemMailboxes, mailboxMetadata]);
  const seededUnreadByMailbox = useMemo(() => {
    const out: Record<string, number> = {};
    for (const mailbox of mailboxMetadata) {
      if (mailbox.unreadCount === undefined) continue;
      out[mailbox.label] = mailbox.unreadCount;
    }
    return out;
  }, [mailboxMetadata]);

  const [mail, setMail] = useState<Mail[]>(() => messages.map(withDetailLoadedFlag));
  const mailRef = useRef<Mail[]>(mail);
  const lastSearchFetchKeyRef = useRef<string>("");
  useEffect(() => {
    mailRef.current = mail;
  }, [mail]);

  const [view, setView] = useState<string>(() => "mb:Inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const workspaceLayoutRef = useRef<WorkspaceAppHandle>(null);

  const [loadingMailbox, setLoadingMailbox] = useState<string | null>(null);
  const [unreadBadgeDeltas, setUnreadBadgeDeltas] = useState<Record<string, number>>({});
  const [mailboxLoadState, setMailboxLoadState] = useState<Record<string, MailboxLoadState>>(() => {
    const byMailbox: Record<string, number> = {};
    for (const row of messages) {
      byMailbox[row.mailbox] = (byMailbox[row.mailbox] ?? 0) + 1;
    }
    const out: Record<string, MailboxLoadState> = {};
    for (const [mailbox, count] of Object.entries(byMailbox)) {
      out[mailbox] = {
        offset: count,
        hasMore: count >= DEFAULT_MAILBOX_PAGE_SIZE,
        loading: false,
      };
    }
    return out;
  });

  const bumpUnreadBadgeDelta = useCallback((rows: Mail[], deltaPerMessage: -1 | 1) => {
    if (rows.length === 0) return;
    setUnreadBadgeDeltas((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        next[row.mailbox] = (next[row.mailbox] ?? 0) + deltaPerMessage;
        if (next[row.mailbox] === 0) delete next[row.mailbox];
      }
      return next;
    });
  }, []);

  const matchMailboxLabel = useCallback(
    (message: Mail, sidebarLabel: string) =>
      rowMatchesMailboxLabel(message, sidebarLabel, mailboxLoader),
    [mailboxLoader],
  );

  const loadMailboxPage = useCallback(
    async (label: string, offset: number) => {
      if (!mailboxLoader) return;

      setMailboxLoadState((prev) => ({
        ...prev,
        [label]: { offset, hasMore: prev[label]?.hasMore ?? true, loading: true },
      }));
      setLoadingMailbox(label);

      try {
        const page = await mailboxLoader.loadMailbox(label, {
          offset,
          limit: DEFAULT_MAILBOX_PAGE_SIZE,
          query: searchQuery.trim(),
        });
        setMail((prev) => {
          const target = prev.filter((m) => matchMailboxLabel(m, label));
          const other = prev.filter((m) => !matchMailboxLabel(m, label));
          const combined = offset === 0 ? page.rows : [...target, ...page.rows];
          const deduped = new Map<string, Mail>();
          for (const row of combined) deduped.set(row.id, withDetailLoadedFlag(row));
          const sorted = Array.from(deduped.values()).sort(compareMailDesc);
          return [...other, ...sorted];
        });
        setMailboxLoadState((prev) => ({
          ...prev,
          [label]: {
            offset: page.nextOffset,
            hasMore: page.hasMore,
            loading: false,
          },
        }));
        setUnreadBadgeDeltas((prev) => {
          if (!(label in prev)) return prev;
          const next = { ...prev };
          delete next[label];
          return next;
        });
      } catch {
        setMailboxLoadState((prev) => ({
          ...prev,
          [label]: {
            offset: prev[label]?.offset ?? offset,
            hasMore: prev[label]?.hasMore ?? true,
            loading: false,
          },
        }));
      } finally {
        setLoadingMailbox((current) => (current === label ? null : current));
      }
    },
    [mailboxLoader, matchMailboxLabel, searchQuery],
  );

  const refreshMailboxCache = useCallback(
    async (label: string) => {
      if (!mailboxLoader) return;
      try {
        const page = await mailboxLoader.loadMailbox(label, {
          offset: 0,
          limit: DEFAULT_MAILBOX_PAGE_SIZE,
          query: searchQuery.trim(),
        });
        setMail((prev) => {
          const other = prev.filter((m) => !matchMailboxLabel(m, label));
          const deduped = new Map<string, Mail>();
          for (const row of page.rows) deduped.set(row.id, withDetailLoadedFlag(row));
          const sorted = Array.from(deduped.values()).sort(compareMailDesc);
          return [...other, ...sorted];
        });
        setMailboxLoadState((prev) => ({
          ...prev,
          [label]: {
            offset: page.nextOffset,
            hasMore: page.hasMore,
            loading: false,
          },
        }));
        setUnreadBadgeDeltas((prev) => {
          if (!(label in prev)) return prev;
          const next = { ...prev };
          delete next[label];
          return next;
        });
      } catch {
        // Best-effort background refresh only.
      }
    },
    [mailboxLoader, matchMailboxLabel, searchQuery],
  );

  useEffect(() => {
    if (!mailboxLoader || !view.startsWith("mb:")) return;
    const label = view.slice(3);
    const state = mailboxLoadState[label];
    if (state?.loading) return;
    if (!state) {
      void loadMailboxPage(label, 0);
      return;
    }
    if (state.offset === 0 && state.hasMore) {
      void loadMailboxPage(label, 0);
    }
  }, [view, mailboxLoader, mailboxLoadState, loadMailboxPage]);

  useEffect(() => {
    if (!mailboxLoader || !view.startsWith("mb:")) return;
    const label = view.slice(3);
    const query = searchQuery.trim();
    const key = `${label}::${query}`;
    if (lastSearchFetchKeyRef.current === key) return;
    lastSearchFetchKeyRef.current = key;
    void loadMailboxPage(label, 0);
  }, [searchQuery, view, mailboxLoader, loadMailboxPage]);

  const viewLabel = useMemo(() => {
    if (view.startsWith("mb:")) return view.slice(3);
    return L.fallbackViewTitle;
  }, [view, L]);

  const activeMailbox = view.startsWith("mb:") ? view.slice(3) : null;
  const activeMailboxState = activeMailbox ? mailboxLoadState[activeMailbox] : undefined;
  const isLoadingMore =
    !!activeMailbox &&
    !listLoading &&
    !!activeMailboxState?.loading &&
    !!activeMailboxState?.offset &&
    activeMailboxState.offset > 0;
  const effectiveListLoading =
    listLoading ||
    (!!activeMailbox &&
      loadingMailbox === activeMailbox &&
      (!activeMailboxState || activeMailboxState.offset === 0));

  useEffect(() => {
    if (!mailboxLoader || !activeMailbox || !listEndRef.current) return;
    if (!activeMailboxState?.hasMore || activeMailboxState.loading) return;
    if (effectiveListLoading) return;

    const el = listEndRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        void loadMailboxPage(activeMailbox, activeMailboxState.offset);
      },
      { root: null, rootMargin: "180px 0px", threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    mailboxLoader,
    activeMailbox,
    activeMailboxState?.hasMore,
    activeMailboxState?.loading,
    activeMailboxState?.offset,
    effectiveListLoading,
    loadMailboxPage,
  ]);

  const unreadByMailbox = useMemo(() => {
    const byMailbox: Record<string, number> = {};
    for (const m of mail) {
      if (!m.unread) continue;
      byMailbox[m.mailbox] = (byMailbox[m.mailbox] ?? 0) + 1;
    }
    return byMailbox;
  }, [mail]);

  const sidebarUnreadBadge = useCallback(
    (mailboxLabel: string): number | undefined => {
      const seeded = seededUnreadByMailbox[mailboxLabel];
      const delta = unreadBadgeDeltas[mailboxLabel] ?? 0;
      if (seeded !== undefined) {
        const count = seeded + delta;
        return count > 0 ? count : undefined;
      }
      const liveCount = unreadByMailbox[mailboxLabel];
      const count = liveCount === undefined ? undefined : liveCount + delta;
      return count && count > 0 ? count : undefined;
    },
    [seededUnreadByMailbox, unreadByMailbox, unreadBadgeDeltas],
  );

  const selectView = useCallback((v: string) => {
    setView(v);
    workspaceLayoutRef.current?.closeMobileDetail();
    if (isSidebarOverlayViewport()) {
      workspaceLayoutRef.current?.closeSidebar();
    }
  }, []);

  const mailboxView = useCallback((mailbox: string) => `mb:${mailbox}`, []);

  return {
    L,
    allSystemMailboxes,
    secondarySystemMailboxes,
    moreMailboxes,
    mail,
    setMail,
    mailRef,
    view,
    setView,
    viewLabel,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    listEndRef,
    workspaceLayoutRef,
    encodeFolderToken,
    mailboxLoader,
    operations,
    matchMailboxLabel,
    bumpUnreadBadgeDelta,
    sidebarUnreadBadge,
    selectView,
    mailboxView,
    effectiveListLoading,
    isLoadingMore,
    inTrash: view === "mb:Trash",
    refreshMailboxCache,
    session,
  };
}

export type MailShellState = ReturnType<typeof useMailShell>;
