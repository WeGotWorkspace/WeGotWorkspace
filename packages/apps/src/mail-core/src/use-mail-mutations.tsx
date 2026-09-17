import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { FileEdit, Star, StarOff, X } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import type { Mail, MailAttachment } from "@/types/mail";
import {
  composeDraftHasContent,
  composeDraftToApiPayload,
  isComposeDraftDirty,
  randomDraftUid,
  serializeComposeSnapshot,
} from "@/mail-core/src/mail-compose-utils";
import {
  draftForMode,
  normalizeComposeSubject,
  splitDetailBodyParagraphs,
  type ComposeMode,
  type MailComposeDraft,
} from "@/mail-core/src/mail-compose-draft";
import {
  buildMoveMailboxOptions,
  resolveMoveDialogCurrentMailbox,
} from "@/mail-core/src/mail-move-dialog";
import { useMailBatchActions } from "@/mail-core/src/use-mail-batch-actions";
import { useMailSelectionBar } from "@/mail-core/src/use-mail-selection-bar";
import type { MailListState } from "@/mail-core/src/use-mail-list";
import type { MailShellState } from "@/mail-core/src/use-mail-shell";

export type UseMailMutationsArgs = {
  shell: MailShellState;
  list: MailListState;
};

export function useMailMutations({ shell, list }: UseMailMutationsArgs) {
  const {
    L,
    allSystemMailboxes,
    moreMailboxes,
    mail,
    setMail,
    view,
    encodeFolderToken,
    operations,
    workspaceLayoutRef,
    refreshMailboxCache,
    inTrash,
    session,
    setView,
  } = shell;

  const {
    active,
    activeId,
    setActiveId,
    visibleMail,
    selectedIds,
    setSelectedIds,
    selectionMode,
    handleSelect,
    exitSelection,
    starred: effectiveStarred,
    batchToggleStarForIds,
    beginOptimisticUpdate,
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
    showMutationError,
  } = list;

  const { show, showError } = useAppToast();
  const { confirmDialog, requestConfirm, consumeParentDismissSuppression } = useConfirmDialog({
    contentClassName: "mail-dialog-surface",
  });

  const [moveDialog, setMoveDialog] = useState<{ ids: string[]; currentMailbox?: string } | null>(
    null,
  );
  const [composeDrafts, setComposeDrafts] = useState<Record<string, MailComposeDraft>>({});
  const [composeDialogId, setComposeDialogId] = useState<string | null>(null);
  const composeBaselineRef = useRef<Record<string, string>>({});
  const [returnMailboxById, setReturnMailboxById] = useState<Record<string, string>>({});
  const searchInputRef = shell.searchInputRef;

  const toggleStar = useCallback(
    (id: string) => {
      const result = batchToggleStarForIds([id]);
      if (!result) return;
      const beforeStarred = result.allWereStarred;
      const nowStarred = !result.allWereStarred;
      setMail((prev) => prev.map((m) => (m.id === id ? { ...m, starred: nowStarred } : m)));
      if (!operations) {
        show(nowStarred ? "Starred" : "Unstarred", {
          icon: nowStarred ? (
            <Star className="size-4" fill="currentColor" />
          ) : (
            <StarOff className="size-4" />
          ),
        });
        return;
      }
      const message = mail.find((m) => m.id === id);
      if (!message) return;
      const rollback = () => {
        batchToggleStarForIds([id]);
        setMail((prev) => prev.map((m) => (m.id === id ? { ...m, starred: beforeStarred } : m)));
      };
      queueMutation({
        key: `mail:star:${id}`,
        toastMessage: nowStarred ? "Starred" : "Unstarred",
        execute: (_signal) =>
          operations.patchMessage(message, { starred: nowStarred }, { signal: _signal }),
        undo: rollback,
        onError: () => {
          rollback();
          showMutationError();
        },
        undoToastMessage: "Star change undone.",
      });
    },
    [batchToggleStarForIds, show, operations, mail, queueMutation, showMutationError, setMail],
  );

  const {
    moveOne,
    toggleArchiveForMessage,
    toggleTrashForMessage,
    markUnread,
    markRead,
    batchStar,
    moveToMailbox,
    batchArchive,
    requestDeleteSelected,
  } = useMailBatchActions({
    mail,
    setMail,
    selectedIds,
    activeId,
    setActiveId,
    visibleMail,
    inTrash,
    starred: effectiveStarred,
    encodeFolderToken,
    operations,
    show,
    queueMutation,
    refreshMailboxCache,
    beginOptimisticUpdate,
    returnMailboxById,
    setReturnMailboxById,
    bumpUnreadBadgeDelta: shell.bumpUnreadBadgeDelta,
    requestConfirm,
    deleteConfirmCopy: {
      dialogDeleteMessagesTitle: L.dialogDeleteMessagesTitle,
      dialogPermanentDeleteLeadIn: L.dialogPermanentDeleteLeadIn,
      dialogDeleteSelectedDescription: L.dialogDeleteSelectedDescription,
      dialogDeleteConfirmSuffix: L.dialogDeleteConfirmSuffix,
      dialogDelete: L.dialogDelete,
      dialogCancel: L.dialogCancel,
    },
    batchToggleStarForIds,
  });

  useWorkspaceListKeyboardShortcuts({
    searchInputRef,
    selectedCount: selectedIds.length,
    onRequestDeleteSelection: requestDeleteSelected,
    onNavigateList: navigateListByKeyboard,
    onUndoQueuedAction: undoLatest,
  });

  const syncMailRowFromCompose = useCallback(
    (id: string, draft: MailComposeDraft) => {
      setMail((prev) =>
        prev.map((message) =>
          message.id === id
            ? {
                ...message,
                title: draft.subject,
                excerpt: draft.body.replace(/\s+/g, " ").trim().slice(0, 180),
                body: splitDetailBodyParagraphs(draft.body),
                detailLoaded: true,
              }
            : message,
        ),
      );
    },
    [setMail],
  );

  const ensureComposeDraftForMessage = useCallback(
    (message: Mail, mode: ComposeMode = "draft"): MailComposeDraft => {
      const existing = composeDrafts[message.id];
      if (existing) return existing;
      const seeded: MailComposeDraft =
        mode === "draft"
          ? {
              mode,
              to: "",
              cc: "",
              bcc: "",
              subject: message.title,
              body: message.body.join("\n\n"),
              attachments: [],
              saving: false,
              sending: false,
            }
          : draftForMode(mode, message);
      setComposeDrafts((prev) => ({ ...prev, [message.id]: seeded }));
      return seeded;
    },
    [composeDrafts],
  );

  const openComposeDialog = useCallback(
    (messageId: string) => {
      setComposeDialogId(messageId);
      workspaceLayoutRef.current?.openMobileDetail();
    },
    [workspaceLayoutRef],
  );

  const closeComposeDialog = useCallback(() => {
    setComposeDialogId((current) => {
      if (current) delete composeBaselineRef.current[current];
      return null;
    });
  }, []);

  useEffect(() => {
    if (!composeDialogId) return;
    const draft = composeDrafts[composeDialogId];
    if (!draft || composeBaselineRef.current[composeDialogId]) return;
    composeBaselineRef.current[composeDialogId] = serializeComposeSnapshot(draft);
  }, [composeDialogId, composeDrafts]);

  const startCompose = useCallback(
    (mode: ComposeMode, source?: Mail) => {
      const id = `m-${Date.now()}`;
      const selfLabel = L.draftFromLabel;
      const draftState = draftForMode(mode, source);
      const draft: Mail = {
        id,
        folder: encodeFolderToken("Drafts"),
        uid: randomDraftUid(),
        from: selfLabel,
        email: session.user.email ?? "",
        notebook: selfLabel,
        category: "Draft",
        date: "Now",
        title: draftState.subject,
        excerpt: draftState.body.replace(/\s+/g, " ").trim().slice(0, 180),
        body: splitDetailBodyParagraphs(draftState.body),
        tags: [],
        wordCount: 0,
        mailbox: "Drafts",
        unread: false,
        detailLoaded: true,
      };
      setMail((prev) => [draft, ...prev]);
      setComposeDrafts((prev) => ({ ...prev, [id]: draftState }));
      openComposeDialog(id);
      if (mode === "new") {
        show(L.toastNewMessage, { icon: <FileEdit className="size-4" /> });
      }
      if (!operations) return;
      void composeDraftToApiPayload(draftState, (subject) =>
        normalizeComposeSubject(subject, L.noSubject),
      )
        .then((draftPayload) => operations.createDraft(draftPayload))
        .catch(() => {
          show("Draft created locally, but could not sync to server yet.", {
            icon: <FileEdit className="size-4" />,
          });
        });
    },
    [
      L.draftFromLabel,
      L.noSubject,
      L.toastNewMessage,
      encodeFolderToken,
      session.user.email,
      show,
      operations,
      openComposeDialog,
      setMail,
    ],
  );

  const compose = useCallback(() => {
    startCompose("new");
  }, [startCompose]);

  const reply = useCallback(() => {
    if (!active) return;
    startCompose("reply", active);
  }, [active, startCompose]);

  const replyAll = useCallback(() => {
    if (!active) return;
    startCompose("reply-all", active);
  }, [active, startCompose]);

  const forward = useCallback(() => {
    if (!active) return;
    startCompose("forward", active);
  }, [active, startCompose]);

  const openDraftInComposer = useCallback(
    (id: string) => {
      const message = mail.find((candidate) => candidate.id === id);
      if (!message) return;
      if (message.mailbox !== "Drafts" && !composeDrafts[id]) return;
      ensureComposeDraftForMessage(message, "draft");
      openComposeDialog(id);
    },
    [mail, composeDrafts, ensureComposeDraftForMessage, openComposeDialog],
  );

  const updateComposeDraft = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<MailComposeDraft, "to" | "cc" | "bcc" | "subject" | "body" | "attachments">
      >,
    ) => {
      setComposeDrafts((prev) => {
        const current = prev[id];
        if (!current) return prev;
        const next = { ...current, ...patch };
        syncMailRowFromCompose(id, next);
        return { ...prev, [id]: next };
      });
    },
    [syncMailRowFromCompose],
  );

  const saveComposeDraft = useCallback(
    async (id: string) => {
      const draft = composeDrafts[id];
      if (!draft) return;
      if (!operations) {
        show("Draft saved locally.", { icon: <FileEdit className="size-4" /> });
        return;
      }
      setComposeDrafts((prev) =>
        prev[id] ? { ...prev, [id]: { ...prev[id]!, saving: true } } : prev,
      );
      try {
        const draftPayload = await composeDraftToApiPayload(draft, (subject) =>
          normalizeComposeSubject(subject, L.noSubject),
        );
        await operations.saveDraft(draftPayload);
        composeBaselineRef.current[id] = serializeComposeSnapshot(draft);
        show("Draft saved.", { icon: <FileEdit className="size-4" /> });
      } catch {
        show("Saved locally. Server draft sync is unavailable right now.", {
          icon: <FileEdit className="size-4" />,
        });
      } finally {
        setComposeDrafts((prev) =>
          prev[id] ? { ...prev, [id]: { ...prev[id]!, saving: false } } : prev,
        );
      }
    },
    [composeDrafts, operations, show, L.noSubject],
  );

  const sendComposeDraft = useCallback(
    async (id: string) => {
      const draft = composeDrafts[id];
      if (!draft) return;
      if (!draft.to.trim()) {
        show("Add at least one recipient in To.", {
          icon: <X className="size-4" />,
          severity: "warning",
        });
        return;
      }
      setComposeDrafts((prev) =>
        prev[id] ? { ...prev, [id]: { ...prev[id]!, sending: true } } : prev,
      );
      try {
        if (operations) {
          const draftPayload = await composeDraftToApiPayload(draft, (subject) =>
            normalizeComposeSubject(subject, L.noSubject),
          );
          await operations.sendMessage({
            to: draft.to,
            ...draftPayload,
          });
        }
        setComposeDrafts((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        delete composeBaselineRef.current[id];
        closeComposeDialog();
        setMail((prev) =>
          prev.map((message) =>
            message.id === id
              ? {
                  ...message,
                  mailbox: "Sent",
                  folder: encodeFolderToken("Sent"),
                  category: "Sent",
                  date: "Now",
                  title: draft.subject,
                  excerpt: draft.body.replace(/\s+/g, " ").trim().slice(0, 180),
                  body: splitDetailBodyParagraphs(draft.body),
                }
              : message,
          ),
        );
        setView("mb:Sent");
        setActiveId(id);
        show("Message sent.", { icon: <FileEdit className="size-4" /> });
      } catch (error) {
        setComposeDrafts((prev) =>
          prev[id] ? { ...prev, [id]: { ...prev[id]!, sending: false } } : prev,
        );
        const message = error instanceof Error ? error.message : "Could not send message.";
        show(message, { icon: <X className="size-4" />, severity: "error" });
      }
    },
    [
      composeDrafts,
      operations,
      show,
      encodeFolderToken,
      closeComposeDialog,
      L.noSubject,
      setMail,
      setView,
      setActiveId,
    ],
  );

  const discardComposeDraft = useCallback(
    async (id: string) => {
      const message = mail.find((candidate) => candidate.id === id);
      const shouldAttemptRemoteDelete =
        !!message &&
        !message.id.startsWith("m-") &&
        !!operations &&
        Number.isFinite(message.uid) &&
        message.uid > 0;
      if (shouldAttemptRemoteDelete) {
        try {
          await operations.deleteMessages([{ folder: message.folder, uid: message.uid }]);
        } catch {
          show("Discarded locally. Could not delete this draft on server.", {
            icon: <X className="size-4" />,
            severity: "warning",
          });
        }
      }
      setComposeDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete composeBaselineRef.current[id];
      setMail((prev) => prev.filter((message) => message.id !== id));
      setSelectedIds((prev) => prev.filter((selectedId) => selectedId !== id));
      setActiveId((current) => (current === id ? "" : current));
      closeComposeDialog();
      show("Draft discarded and removed from your list.", {
        icon: <X className="size-4" />,
        severity: "info",
      });
    },
    [mail, operations, show, setSelectedIds, closeComposeDialog, setMail, setActiveId],
  );

  const requestCloseComposeDialog = useCallback(
    (id: string) => {
      const draft = composeDrafts[id];
      if (!draft) {
        closeComposeDialog();
        return;
      }
      const baseline = composeBaselineRef.current[id];
      const dirty = baseline ? isComposeDraftDirty(draft, baseline) : composeDraftHasContent(draft);
      if (!dirty) {
        closeComposeDialog();
        return;
      }
      requestConfirm({
        title: L.composeCloseTitle,
        description: L.composeCloseDescription,
        cancelLabel: L.composeKeepEditing,
        confirmLabel: L.composeCloseConfirm,
        onConfirm: closeComposeDialog,
      });
    },
    [
      composeDrafts,
      closeComposeDialog,
      requestConfirm,
      L.composeCloseTitle,
      L.composeCloseDescription,
      L.composeKeepEditing,
      L.composeCloseConfirm,
    ],
  );

  const requestDiscardComposeDraft = useCallback(
    (id: string) => {
      const draft = composeDrafts[id];
      if (!draft || !composeDraftHasContent(draft)) {
        void discardComposeDraft(id);
        return;
      }
      requestConfirm({
        title: L.composeDiscardTitle,
        description: L.composeDiscardDescription,
        variant: "destructive",
        cancelLabel: L.dialogCancel,
        confirmLabel: L.composeDeleteDraft,
        onConfirm: () => {
          void discardComposeDraft(id);
        },
      });
    },
    [
      composeDrafts,
      discardComposeDraft,
      requestConfirm,
      L.composeDiscardTitle,
      L.composeDiscardDescription,
      L.dialogCancel,
      L.composeDeleteDraft,
    ],
  );

  const moveMailboxOptions = useMemo(
    () => buildMoveMailboxOptions(allSystemMailboxes, moreMailboxes),
    [allSystemMailboxes, moreMailboxes],
  );
  const moveDialogCurrentMailbox = useMemo(
    () =>
      resolveMoveDialogCurrentMailbox({
        moveDialog,
        view,
        mail,
        moveMailboxOptions,
        encodeFolderToken,
      }),
    [moveDialog, view, mail, moveMailboxOptions, encodeFolderToken],
  );

  const { selectionBarButtons, selectionBar } = useMailSelectionBar({
    mail,
    selectedIds,
    selectionMode,
    activeId,
    effectiveStarred,
    view,
    exitSelection,
    setMoveDialog,
    markRead,
    markUnread,
    batchStar,
    moveToMailbox,
    batchArchive,
    requestDeleteSelected,
    labels: {
      selectionMoveToMailbox: L.selectionMoveToMailbox,
      selectionMarkUnread: L.selectionMarkUnread,
      selectionStar: L.selectionStar,
      selectionArchive: L.selectionArchive,
      toolbarRestore: L.toolbarRestore,
      selectionDone: L.selectionDone,
    },
  });

  const handleMailItemDoubleClick = useCallback(
    (id: string, e: ReactMouseEvent) => {
      handleSelect(id, e);
      openDraftInComposer(id);
    },
    [handleSelect, openDraftInComposer],
  );

  const downloadAttachment = useCallback(
    async (attachment: MailAttachment) => {
      if (!active) return;
      try {
        const blob = operations
          ? await operations.downloadAttachment(
              { id: active.id, folder: active.folder, uid: active.uid },
              attachment,
            )
          : null;
        if (!blob) {
          show(`Cannot download "${attachment.name}" because no backend is connected.`, {
            icon: <FileEdit className="size-4" />,
          });
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = attachment.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        show(`Failed to download "${attachment.name}".`, {
          icon: <FileEdit className="size-4" />,
        });
      }
    },
    [active, operations, show],
  );

  return {
    moveDialog,
    setMoveDialog,
    moveMailboxOptions,
    moveDialogCurrentMailbox,
    composeDrafts,
    composeDialogId,
    closeComposeDialog,
    requestCloseComposeDialog,
    updateComposeDraft,
    saveComposeDraft,
    sendComposeDraft,
    discardComposeDraft,
    requestDiscardComposeDraft,
    compose,
    reply,
    replyAll,
    forward,
    openDraftInComposer,
    toggleStar,
    moveOne,
    toggleArchiveForMessage,
    toggleTrashForMessage,
    moveToMailbox,
    markRead,
    markUnread,
    selectionBar,
    selectionBarButtons,
    handleMailItemDoubleClick,
    downloadAttachment,
    confirmDialog,
    consumeParentDismissSuppression,
    show,
    showError,
  };
}

export type MailMutationsState = ReturnType<typeof useMailMutations>;
