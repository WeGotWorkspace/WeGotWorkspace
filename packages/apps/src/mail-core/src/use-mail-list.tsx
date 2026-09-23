import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useSelectionResetOnKeyChange } from "@/hooks/use-selection-reset-on-key-change";
import { useStarredMap } from "@/hooks/use-starred-map";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useWorkspaceListController } from "@/hooks/use-workspace-list-controller";
import type { Mail } from "@/types/mail";
import { splitDetailBodyParagraphs } from "@/mail-core/src/mail-compose-draft";
import { plainTextFromMailDetail } from "@/mail-core/src/mail-detail-content";
import { filterVisibleMail } from "@/mail-core/src/mail-visible-items";
import type { MailShellState } from "@/mail-core/src/use-mail-shell";

const WRITE_QUEUE_DELAY_MS = 2500;

export type UseMailListArgs = {
  shell: MailShellState;
  initialActiveId?: string;
};

export function useMailList({ shell, initialActiveId = "" }: UseMailListArgs) {
  const {
    mail,
    setMail,
    mailRef,
    view,
    searchQuery,
    mailboxLoader,
    operations,
    workspaceLayoutRef,
    bumpUnreadBadgeDelta,
  } = shell;

  const { showError } = useAppToast();
  const showMutationError = useCallback(
    (fallback = "Could not sync this change. Please try again.") => showError(fallback),
    [showError],
  );

  const [activeId, setActiveId] = useState<string>(initialActiveId);
  const initialStarred = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const row of mail) {
      if (row.starred) map[row.id] = true;
    }
    return map;
  }, [mail]);
  const { starred, batchToggleStarForIds } = useStarredMap(initialStarred);

  const attemptedAutoReadSyncRef = useRef<Set<string>>(new Set());
  const fetchedDetailIdsRef = useRef<Set<string>>(new Set());
  const pendingDetailIdsRef = useRef<Set<string>>(new Set());
  const isTouch = useIsTouch();

  const visibleMail = useMemo(
    () =>
      filterVisibleMail({
        mail,
        view,
        searchQuery,
        mailboxLoader,
      }),
    [mail, view, searchQuery, mailboxLoader],
  );

  useEffect(() => {
    const ids = visibleMail.map((m) => m.id);
    if (ids.length === 0) {
      if (activeId) setActiveId("");
      return;
    }
    if (!ids.includes(activeId)) setActiveId("");
  }, [visibleMail, activeId]);

  const {
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    beginOptimisticUpdate,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
  } = useWorkspaceListController<Mail>({
    items: mail,
    setItems: setMail,
    visibleIds: visibleMail.map((m) => m.id),
    activeId,
    setActiveId,
    onPrimarySelect: (id) => {
      setActiveId(id);
      workspaceLayoutRef.current?.openMobileDetail();
    },
    onNavigateToId: () => workspaceLayoutRef.current?.openMobileDetail(),
    onMutationError: showMutationError,
    queueDelayMs: WRITE_QUEUE_DELAY_MS,
  });

  useSelectionResetOnKeyChange({
    resetKey: view,
    setSelectedIds,
    setSelectionMode,
  });

  const active: Mail | undefined = activeId ? mail.find((m) => m.id === activeId) : undefined;

  const effectiveStarred = useMemo(() => {
    const merged: Record<string, boolean> = {};
    for (const row of mail) merged[row.id] = starred[row.id] ?? !!row.starred;
    return merged;
  }, [mail, starred]);

  useEffect(() => {
    if (operations || !active) return;
    if (active.detailLoaded) return;
    const hasSeededDetail =
      Boolean(active.bodyHtml?.trim()) ||
      active.body.some((paragraph) => paragraph.trim().length > 0);
    if (!hasSeededDetail) return;
    setMail((prev) =>
      prev.map((message) =>
        message.id === active.id ? { ...message, detailLoaded: true } : message,
      ),
    );
  }, [active, operations, setMail]);

  useEffect(() => {
    if (!operations || !active) return;
    if (active.detailLoaded) {
      fetchedDetailIdsRef.current.add(active.id);
      return;
    }
    if (fetchedDetailIdsRef.current.has(active.id)) return;
    if (pendingDetailIdsRef.current.has(active.id)) return;
    const targetId = active.id;
    pendingDetailIdsRef.current.add(targetId);
    let cancelled = false;
    void operations
      .fetchMessageDetail({ id: active.id, folder: active.folder, uid: active.uid })
      .then((detail) => {
        pendingDetailIdsRef.current.delete(targetId);
        if (cancelled) return;
        if (!detail) {
          setMail((prev) =>
            prev.map((m) => (m.id === targetId ? { ...m, detailLoaded: true } : m)),
          );
          fetchedDetailIdsRef.current.add(targetId);
          return;
        }
        const fullBodySource = plainTextFromMailDetail(detail);
        const body = splitDetailBodyParagraphs(fullBodySource);
        const excerpt = fullBodySource.replace(/\s+/g, " ").trim();
        setMail((prev) =>
          prev.map((m) =>
            m.id === targetId
              ? {
                  ...m,
                  body: body.some((p) => p.length > 0) ? body : m.body,
                  bodyHtml: detail.bodyHtml ?? undefined,
                  detailLoaded: true,
                  excerpt: excerpt.length > 0 ? excerpt.slice(0, 180) : m.excerpt,
                  attachments: detail.attachments ?? m.attachments,
                }
              : m,
          ),
        );
        fetchedDetailIdsRef.current.add(targetId);
      })
      .catch(() => {
        pendingDetailIdsRef.current.delete(targetId);
      });
    return () => {
      cancelled = true;
    };
  }, [active, operations, setMail]);

  useEffect(() => {
    if (!activeId) return;
    const opened = mailRef.current.find((m) => m.id === activeId);
    if (!opened?.unread) return;
    bumpUnreadBadgeDelta([opened], -1);
    setMail((prev) => prev.map((m) => (m.id === activeId ? { ...m, unread: false } : m)));
    if (!operations) return;
    if (attemptedAutoReadSyncRef.current.has(activeId)) return;
    attemptedAutoReadSyncRef.current.add(activeId);
    void operations.patchMessage(opened, { read: true }).catch(() => {
      bumpUnreadBadgeDelta([opened], 1);
      setMail((prev) => prev.map((m) => (m.id === activeId ? { ...m, unread: true } : m)));
      showMutationError();
    });
  }, [activeId, operations, showMutationError, bumpUnreadBadgeDelta, setMail, mailRef]);

  return {
    activeId,
    setActiveId,
    active,
    visibleMail,
    selectedIds,
    setSelectedIds,
    selectionMode,
    setSelectionMode,
    handleSelect,
    enterSelectionFor,
    exitSelection,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    beginOptimisticUpdate,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
    starred: effectiveStarred,
    batchToggleStarForIds,
    isTouch,
    showMutationError,
  };
}

export type MailListState = ReturnType<typeof useMailList>;
