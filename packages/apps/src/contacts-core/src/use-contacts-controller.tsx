import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, Tag, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useIsTouch } from "@/hooks/use-is-touch";
import { useSelectionResetOnKeyChange } from "@/hooks/use-selection-reset-on-key-change";
import { useWorkspaceListKeyboardShortcuts } from "@/hooks/use-workspace-list-keyboard-shortcuts";
import {
  useWorkspaceListController,
  useWorkspaceSelectionPresentation,
} from "@/hooks/use-workspace-list-controller";
import type { WorkspaceAppHandle } from "@/workspace-app/src/workspace-app";
import {
  contactDisplayName,
  filterCardsBySearch,
  sortContactCardsForList,
} from "@/contacts-core/src/contacts-display-utils";
import { firstEnabledAddressBookId } from "@/contacts-core/src/contacts-addressbook-color";
import {
  canWriteContactGroup,
  cardsWithGroupMember,
  contactAndGroupShareAddressBook,
  filterCardsByHiddenAddressBooks,
  filterCardsByView,
  groupAddMembersPatch,
  groupRemoveMembersPatch,
  groupRenamePatch,
  isContactGroupCard,
  listContactGroups,
} from "@/contacts-core/src/contacts-group-utils";
import { mergeContactsLabels, type ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import {
  addressesAfterFieldChange,
  emailsAfterAddressChange,
  phonesAfterNumberChange,
  urlsAfterUriChange,
} from "@/contacts-core/src/contact-channel-commit";
import {
  CONTACTS_CREATE_ID,
  canCreateContactInView,
  contactCardToEditDraft,
  contactEditDraftHasChanges,
  contactEditDraftHasContent,
  editDraftToCreateBody,
  editDraftToPatch,
  emptyContactEditDraft,
  newContactMapId,
  resolveCreateAddressBookIds,
  resolveDefaultContactsView,
  type ContactChannelContext,
  type ContactPhoneType,
  type ContactEditDraft,
} from "@/contacts-core/src/contacts-edit-utils";
import type {
  ContactCard,
  ContactCardCreate,
  ContactCardPatch,
  ContactsAPIOperations,
  ContactsMutationOpts,
  ContactsUIData,
} from "@/contacts-core/src/contacts-types";
import {
  canCreateGroupInAddressBook,
  writableGroupAddressBooks,
} from "@/contacts-core/src/contacts-addressbook-write";
import { useContactsHiddenIds } from "@/contacts-core/src/use-contacts-hidden-ids";
import {
  CONTACTS_AUTOSAVE_DEBOUNCE_MS,
  createContactSaveDebouncer,
} from "@/contacts-core/src/contacts-edit-autosave";
import {
  downloadContactVCard,
  downloadMultipleContactsVCard,
  vcardFilename,
} from "@/contacts-core/src/contacts-vcard-export";
import { useContactsVcardImport } from "@/contacts-core/src/use-contacts-vcard-import";

type UseContactsControllerArgs = {
  data: ContactsUIData;
  labels?: Partial<ContactsUILabels>;
  listLoading?: boolean;
  operations?: ContactsAPIOperations;
  /** Refetch cards after vCard import so group membership resolves against the full list. */
  onRefreshList?: () => void;
  /**
   * Initial view restored from a deep-link URL (e.g. `"all"`, `"group:{id}"`).
   * Only applied on mount; falls back to address-book default when absent.
   */
  initialView?: string;
  /** Initial contact card id to select on mount (e.g. from a deep-link URL). */
  initialContactId?: string;
  /** Called when the active view changes so the caller can sync the URL. */
  onViewChange?: (view: string) => void;
  /** Called when the active contact changes so the caller can sync the URL. */
  onContactChange?: (contactId: string) => void;
};

const WRITE_QUEUE_DELAY_MS = 2500;

function isPreconditionFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 412
  );
}

async function patchGroupWithFreshEtag(
  operations: ContactsAPIOperations,
  groupId: string,
  buildPatch: (freshGroup: ContactCard) => ContactCardPatch | null,
  signal: AbortSignal,
): Promise<ContactCard> {
  const run = async (): Promise<ContactCard> => {
    const fresh = await operations.getCard(groupId, { signal });
    const patch = buildPatch(fresh);
    if (!patch) return fresh;
    return operations.patchCard(groupId, patch, contactMutationOpts(fresh, signal));
  };

  try {
    return await run();
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    return run();
  }
}

function draftDisplayName(draft: ContactEditDraft, unknownLabel: string): string {
  const name = [draft.nameGiven, draft.nameGiven2, draft.nameSurname]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return name || unknownLabel;
}

function contactMutationOpts(
  card: ContactCard | undefined,
  signal?: AbortSignal,
): ContactsMutationOpts {
  const state = card ? (card as ContactCard & { state?: string }).state : undefined;
  return {
    signal,
    ifInState: state ?? undefined,
    ifMatch: card?.etag,
  };
}

function mergeContactFromPatch(active: ContactCard, patch: ContactCardPatch): ContactCard {
  const merged: ContactCard = {
    ...active,
    ...patch,
    name: patch.name ?? active.name,
    phones: { ...active.phones, ...patch.phones },
    emails: { ...active.emails, ...patch.emails },
    addresses: { ...active.addresses, ...patch.addresses },
    organizations: { ...active.organizations, ...patch.organizations },
    notes: { ...active.notes, ...patch.notes },
  };
  for (const [key, value] of Object.entries(patch.phones ?? {})) {
    if (value === null) delete merged.phones?.[key];
  }
  for (const [key, value] of Object.entries(patch.emails ?? {})) {
    if (value === null) delete merged.emails?.[key];
  }
  for (const [key, value] of Object.entries(patch.addresses ?? {})) {
    if (value === null) delete merged.addresses?.[key];
  }
  for (const [key, value] of Object.entries(patch.organizations ?? {})) {
    if (value === null) delete merged.organizations?.[key];
  }
  for (const [key, value] of Object.entries(patch.notes ?? {})) {
    if (value === null) delete merged.notes?.[key];
  }
  return merged;
}

export function useContactsController({
  data,
  labels,
  listLoading = false,
  operations,
  onRefreshList,
  initialView,
  initialContactId,
  onViewChange,
  onContactChange,
}: UseContactsControllerArgs) {
  const L = useMemo(() => mergeContactsLabels(labels), [labels]);
  const [cards, setCards] = useState<ContactCard[]>(() => data.cards);
  const [addressBooks, setAddressBooks] = useState(() => data.addressBooks);
  const { hiddenAddressBookIds, setHiddenAddressBookIds } = useContactsHiddenIds(addressBooks);
  const toggleAddressBookVisibility = useCallback(
    (bookId: string) => {
      setHiddenAddressBookIds((current) => {
        const next = new Set(current);
        if (next.has(bookId)) next.delete(bookId);
        else next.add(bookId);
        return next;
      });
    },
    [setHiddenAddressBookIds],
  );
  const [view, setView] = useState(
    () => initialView ?? resolveDefaultContactsView(data.addressBooks),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const workspaceLayoutRef = useRef<WorkspaceAppHandle>(null);
  const [activeId, setActiveId] = useState(initialContactId ?? "");
  const [editMode, setEditMode] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [editDraft, setEditDraft] = useState<ContactEditDraft | null>(null);
  const [groupRenameDialog, setGroupRenameDialog] = useState<null | {
    groupId: string;
    name: string;
  }>(null);
  const [createGroupDialog, setCreateGroupDialog] = useState(false);
  const [dropImportActive, setDropImportActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const cardsRef = useRef(cards);
  const activeIdRef = useRef(activeId);
  const contactDraftsRef = useRef<Map<string, ContactEditDraft>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const debouncerRef = useRef(createContactSaveDebouncer(CONTACTS_AUTOSAVE_DEBOUNCE_MS));
  const persistContactEditRef = useRef<
    (contactId: string, draft: ContactEditDraft) => Promise<void>
  >(async () => {});

  const { showError } = useAppToast();
  const showMutationError = useCallback(
    (fallback = "Could not sync this change. Please try again.") => showError(fallback),
    [showError],
  );
  const { confirmDialog, requestConfirm } = useConfirmDialog({
    contentClassName: "contacts-dialog-surface",
  });
  const isTouch = useIsTouch();

  useEffect(() => {
    setCards(data.cards);
    setAddressBooks(data.addressBooks);
  }, [data.addressBooks, data.cards]);

  useEffect(() => {
    if (initialContactId === undefined) return;
    setActiveId(initialContactId);
  }, [initialContactId]);

  useEffect(() => {
    if (!initialContactId) return;
    workspaceLayoutRef.current?.openMobileDetail();
  }, [initialContactId]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Skip the initial render so mount doesn't trigger unnecessary URL writes.
  const viewSyncedRef = useRef(false);
  useEffect(() => {
    if (!viewSyncedRef.current) {
      viewSyncedRef.current = true;
      return;
    }
    onViewChange?.(view);
  }, [view, onViewChange]);

  const contactSyncedRef = useRef(false);
  useEffect(() => {
    if (!contactSyncedRef.current) {
      contactSyncedRef.current = true;
      return;
    }
    // Don't write the transient create-mode placeholder to the URL.
    if (activeId === CONTACTS_CREATE_ID) return;
    onContactChange?.(activeId);
  }, [activeId, onContactChange]);

  const contactGroups = useMemo(() => listContactGroups(cards), [cards]);

  const selectedGroup = useMemo(() => {
    if (!view.startsWith("group:")) return undefined;
    const groupId = view.slice("group:".length);
    return contactGroups.find((card) => card.id === groupId);
  }, [contactGroups, view]);

  const visibleCards = useMemo(() => {
    const byView = filterCardsByView(cards, view);
    const scoped =
      view === "all" ? filterCardsByHiddenAddressBooks(byView, hiddenAddressBookIds) : byView;
    return filterCardsBySearch(scoped, searchQuery);
  }, [cards, hiddenAddressBookIds, searchQuery, view]);

  const visibleIds = useMemo(
    () => sortContactCardsForList(visibleCards).map((card) => card.id),
    [visibleCards],
  );

  const stashActiveEditDraft = useCallback(() => {
    if (!editMode || createMode || !editDraft || !activeId || activeId === CONTACTS_CREATE_ID)
      return;
    contactDraftsRef.current.set(activeId, editDraft);
  }, [activeId, createMode, editDraft, editMode]);

  const restoreEditDraftForContact = useCallback((contactId: string) => {
    const stashed = contactDraftsRef.current.get(contactId);
    if (stashed) {
      setEditMode(true);
      setEditDraft(stashed);
    } else {
      setEditMode(false);
      setEditDraft(null);
    }
  }, []);

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
    queueMutation,
    undoLatest,
    navigateListByKeyboard,
  } = useWorkspaceListController<ContactCard>({
    items: cards,
    setItems: setCards,
    visibleIds,
    activeId,
    setActiveId,
    onPrimarySelect: (id) => {
      if (createMode) return;
      stashActiveEditDraft();
      restoreEditDraftForContact(id);
      const during = () => {
        setActiveId(id);
      };
      const handle = workspaceLayoutRef.current;
      if (handle) {
        handle.openMobileDetail(during);
        return;
      }
      void during();
    },
    onNavigateToId: () => workspaceLayoutRef.current?.openMobileDetail(),
    onMutationError: showMutationError,
    queueDelayMs: WRITE_QUEUE_DELAY_MS,
  });

  const closeMobileDetail = useCallback(() => {
    const during = () => {
      setActiveId("");
      setSelectedIds([]);
      setSelectionMode(false);
    };
    const handle = workspaceLayoutRef.current;
    if (handle) {
      handle.closeMobileDetail(during);
      return;
    }
    void during();
  }, [setSelectedIds, setSelectionMode]);

  useSelectionResetOnKeyChange({
    resetKey: view,
    setSelectedIds,
    setSelectionMode,
  });

  const active = useMemo(
    () =>
      activeId && activeId !== CONTACTS_CREATE_ID
        ? cards.find((card) => card.id === activeId)
        : undefined,
    [activeId, cards],
  );

  const viewLabel = useMemo(() => {
    if (view === "all") return L.sidebarAllContacts;
    if (view.startsWith("book:")) {
      const bookId = view.slice(5);
      return addressBooks.find((book) => book.id === bookId)?.name ?? bookId;
    }
    if (view.startsWith("group:")) {
      const groupId = view.slice("group:".length);
      const group = contactGroups.find((card) => card.id === groupId);
      return group ? contactDisplayName(group) : L.sidebarAllContacts;
    }
    return L.sidebarAllContacts;
  }, [L.sidebarAllContacts, addressBooks, contactGroups, view]);

  const canCreateContact = useMemo(
    () => canCreateContactInView(view, addressBooks, selectedGroup, Boolean(operations)),
    [addressBooks, operations, selectedGroup, view],
  );

  // Import lands in a book only — it does not add members, so stay off group views.
  const canImportVcf = canCreateContact && !view.startsWith("group:");

  const canCreateGroup = writableGroupAddressBooks(addressBooks).length > 0;

  const canRenameGroup = useMemo(
    () => canWriteContactGroup(selectedGroup, addressBooks, Boolean(operations)),
    [addressBooks, operations, selectedGroup],
  );

  const canDeleteGroup = useMemo(
    () => canWriteContactGroup(selectedGroup, addressBooks, Boolean(operations)),
    [addressBooks, operations, selectedGroup],
  );

  const canSaveCreate = useMemo(
    () => createMode && editDraft !== null && contactEditDraftHasContent(editDraft),
    [createMode, editDraft],
  );

  const canEdit = useMemo(() => {
    if (createMode) return true;
    if (!active) return false;
    const bookIds = Object.keys(active.addressBookIds ?? {});
    if (bookIds.length === 0) return Boolean(operations);
    return bookIds.some((bookId) => {
      const book = addressBooks.find((row) => row.id === bookId);
      return book?.myRights?.mayWrite !== false;
    });
  }, [active, addressBooks, createMode, operations]);

  const displayName = useMemo(() => {
    if (editDraft && (editMode || createMode)) return draftDisplayName(editDraft, L.unknownContact);
    if (active) return contactDisplayName(active);
    return L.unknownContact;
  }, [L.unknownContact, active, createMode, editDraft, editMode]);

  const selectView = useCallback((nextView: string) => {
    debouncerRef.current.flushAll((contactId, draft) => {
      void persistContactEditRef.current(contactId, draft);
    });
    contactDraftsRef.current.clear();
    setView(nextView);
    setSearchQuery("");
    setEditMode(false);
    setCreateMode(false);
    setEditDraft(null);
    setActiveId("");
  }, []);

  const updateEditDraft = useCallback((patch: Partial<ContactEditDraft>) => {
    setEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const startEdit = useCallback(() => {
    if (!active || createMode) return;
    setEditMode(true);
    setEditDraft(contactDraftsRef.current.get(active.id) ?? contactCardToEditDraft(active));
  }, [active, createMode]);

  const cancelEdit = useCallback(() => {
    if (createMode) {
      setCreateMode(false);
      setActiveId("");
    } else if (activeId && activeId !== CONTACTS_CREATE_ID) {
      contactDraftsRef.current.delete(activeId);
    }
    setEditMode(false);
    setEditDraft(null);
  }, [activeId, createMode]);

  const createContact = useCallback(() => {
    setCreateMode(true);
    setEditMode(true);
    setEditDraft(emptyContactEditDraft());
    setActiveId(CONTACTS_CREATE_ID);
    setSelectedIds([]);
    setSelectionMode(false);
    workspaceLayoutRef.current?.openMobileDetail();
  }, [setSelectedIds, setSelectionMode]);

  const mergeImportedCards = useCallback(
    (list: ContactCard[]) => {
      setCards((prev) => {
        const byId = new Map(prev.map((card) => [card.id, card]));
        for (const card of list) {
          byId.set(card.id, card);
        }
        return [...byId.values()];
      });
      onRefreshList?.();
    },
    [onRefreshList],
  );

  const {
    importFiles,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    importDialogProgress,
    beginImport,
    closeImportDialog,
    submitImportDialog,
  } = useContactsVcardImport({
    operations,
    labels: L,
    onImported: mergeImportedCards,
  });

  const handleImportVcf = beginImport;

  const updatePhone = useCallback((id: string, number: string, phoneType?: ContactPhoneType) => {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            phones: phonesAfterNumberChange({
              phones: prev.phones,
              rowId: id,
              number,
              phoneType,
            }),
          }
        : prev,
    );
  }, []);

  const updateEmail = useCallback(
    (id: string, address: string, contextType?: ContactChannelContext) => {
      setEditDraft((prev) =>
        prev
          ? {
              ...prev,
              emails: emailsAfterAddressChange({
                emails: prev.emails,
                rowId: id,
                address,
                contextType,
              }),
            }
          : prev,
      );
    },
    [],
  );

  const updatePhoneContext = useCallback((id: string, phoneType: ContactPhoneType) => {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            phones: prev.phones.map((row) => (row.id === id ? { ...row, phoneType } : row)),
          }
        : prev,
    );
  }, []);

  const updateEmailContext = useCallback((id: string, contextType: ContactChannelContext) => {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            emails: prev.emails.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }
        : prev,
    );
  }, []);

  const updateAddress = useCallback(
    (
      id: string,
      field: "street" | "locality" | "region" | "postalCode" | "country",
      value: string,
      contextType?: ContactChannelContext,
    ) => {
      setEditDraft((prev) =>
        prev
          ? {
              ...prev,
              addresses: addressesAfterFieldChange({
                addresses: prev.addresses,
                rowId: id,
                field,
                value,
                contextType,
              }),
            }
          : prev,
      );
    },
    [],
  );

  const updateAddressContext = useCallback((id: string, contextType: ContactChannelContext) => {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            addresses: prev.addresses.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }
        : prev,
    );
  }, []);

  const removePhone = useCallback((id: string) => {
    setEditDraft((prev) =>
      prev ? { ...prev, phones: prev.phones.filter((row) => row.id !== id) } : prev,
    );
  }, []);

  const removeEmail = useCallback((id: string) => {
    setEditDraft((prev) =>
      prev ? { ...prev, emails: prev.emails.filter((row) => row.id !== id) } : prev,
    );
  }, []);

  const removeAddress = useCallback((id: string) => {
    setEditDraft((prev) =>
      prev ? { ...prev, addresses: prev.addresses.filter((row) => row.id !== id) } : prev,
    );
  }, []);

  const updateUrl = useCallback((id: string, uri: string, contextType?: ContactChannelContext) => {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            urls: urlsAfterUriChange({
              urls: prev.urls,
              rowId: id,
              uri,
              contextType,
            }),
          }
        : prev,
    );
  }, []);

  const updateUrlContext = useCallback((id: string, contextType: ContactChannelContext) => {
    setEditDraft((prev) =>
      prev
        ? {
            ...prev,
            urls: prev.urls.map((row) => (row.id === id ? { ...row, contextType } : row)),
          }
        : prev,
    );
  }, []);

  const removeUrl = useCallback((id: string) => {
    setEditDraft((prev) =>
      prev ? { ...prev, urls: prev.urls.filter((row) => row.id !== id) } : prev,
    );
  }, []);

  const deleteCards = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const previousCards = cards;
      const previousActiveId = activeId;
      const previousSelectedIds = selectedIds;
      const shouldExitSelection =
        ids.length === selectedIds.length &&
        selectedIds.length > 0 &&
        ids.every((id) => selectedIds.includes(id));

      setCards((prev) => prev.filter((card) => !ids.includes(card.id)));
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
      if (ids.includes(activeId)) {
        setActiveId("");
        setEditMode(false);
        setEditDraft(null);
        setCreateMode(false);
      }
      for (const id of ids) {
        contactDraftsRef.current.delete(id);
      }
      if (shouldExitSelection) setSelectionMode(false);

      const rollback = () => {
        setCards(previousCards);
        setSelectedIds(previousSelectedIds);
        setActiveId(previousActiveId);
        if (previousSelectedIds.length > 0) setSelectionMode(true);
      };

      queueMutation({
        key: `contacts:delete:${ids.slice().sort().join(",")}`,
        toastMessage: L.toastDeleted,
        execute: (signal) =>
          operations
            ? Promise.all(
                ids.map((id) => {
                  const card = previousCards.find((row) => row.id === id);
                  return operations.deleteCard(id, contactMutationOpts(card, signal));
                }),
              ).then(() => {})
            : Promise.resolve(),
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Deletion undone.",
      });
    },
    [
      L.toastDeleted,
      activeId,
      cards,
      operations,
      queueMutation,
      selectedIds,
      setSelectedIds,
      setSelectionMode,
    ],
  );

  const openDeleteConfirm = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      requestConfirm({
        title: L.deleteContactTitle,
        description: L.deleteContactDescription(ids.length),
        confirmLabel: L.deleteConfirm,
        cancelLabel: L.deleteCancel,
        variant: "destructive",
        onConfirm: () => deleteCards(ids),
      });
    },
    [L, deleteCards, requestConfirm],
  );

  const deleteActive = useCallback(() => {
    if (!active) return;
    openDeleteConfirm([active.id]);
  }, [active, openDeleteConfirm]);

  const downloadActive = useCallback(() => {
    if (!active) return;
    if (operations?.downloadCardVcf) {
      const cardId = active.id;
      const filename = vcardFilename(contactDisplayName(active));
      operations.downloadCardVcf(cardId).then((vcfText) => {
        const blob = new Blob([vcfText], { type: "text/vcard;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
      });
    } else {
      downloadContactVCard(active);
    }
  }, [active, operations]);

  const downloadSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    const cardsToDownload = selectedIds
      .map((id) => cards.find((card) => card.id === id))
      .filter((card): card is ContactCard => card !== undefined);

    if (operations?.downloadCardVcf && cardsToDownload.length > 0) {
      const downloadVcf = operations.downloadCardVcf;
      Promise.all(cardsToDownload.map((card) => downloadVcf(card.id))).then((vcfParts) => {
        const vcfText = vcfParts.join("\r\n");
        const filename =
          cardsToDownload.length === 1
            ? vcardFilename(contactDisplayName(cardsToDownload[0]))
            : `${cardsToDownload.length}-contacts.vcf`;
        const blob = new Blob([vcfText], { type: "text/vcard;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          anchor.style.display = "none";
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
      });
    } else {
      downloadMultipleContactsVCard(cardsToDownload);
    }
  }, [cards, operations, selectedIds]);

  const requestDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    openDeleteConfirm(selectedIds);
  }, [openDeleteConfirm, selectedIds]);

  const removeFromGroup = useCallback(
    (cardIds: string[]) => {
      if (!selectedGroup || cardIds.length === 0) return;
      const groupId = selectedGroup.id;
      const group = cards.find((card) => card.id === groupId);
      if (!group) return;

      const patch = groupRemoveMembersPatch(group, cardIds, cards);
      if (!patch) return;

      const removedCount = Object.keys(patch.members ?? {}).length;
      const previousCard = group;
      const merged: ContactCard = {
        ...group,
        members: { ...group.members, ...patch.members } as ContactCard["members"],
      };

      const previousSelectedIds = selectedIds;
      const previousActiveId = activeId;
      const shouldExitSelection =
        cardIds.length === selectedIds.length &&
        selectedIds.length > 0 &&
        cardIds.every((id) => selectedIds.includes(id));

      setCards((prev) => prev.map((card) => (card.id === groupId ? merged : card)));
      setSelectedIds((prev) => prev.filter((id) => !cardIds.includes(id)));
      if (cardIds.includes(activeId)) {
        setActiveId("");
        setEditMode(false);
        setEditDraft(null);
        setCreateMode(false);
      }
      if (shouldExitSelection) setSelectionMode(false);

      const rollback = () => {
        setCards((prev) => prev.map((card) => (card.id === groupId ? previousCard : card)));
        setSelectedIds(previousSelectedIds);
        setActiveId(previousActiveId);
        if (previousSelectedIds.length > 0) setSelectionMode(true);
      };

      queueMutation({
        key: `contacts:remove-from-group:${groupId}:${cardIds.slice().sort().join(",")}`,
        toastMessage: L.toastRemovedFromGroup(removedCount),
        icon: <UserMinus className="size-4" />,
        execute: async (signal) => {
          if (!operations) return;
          const saved = await patchGroupWithFreshEtag(
            operations,
            groupId,
            (fresh) => groupRemoveMembersPatch(fresh, cardIds, cardsRef.current),
            signal,
          );
          setCards((prev) => prev.map((card) => (card.id === groupId ? saved : card)));
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Removal undone.",
      });
    },
    [
      L.toastRemovedFromGroup,
      activeId,
      cards,
      operations,
      queueMutation,
      selectedGroup,
      selectedIds,
      setSelectedIds,
      setSelectionMode,
    ],
  );

  const requestRemoveSelectedFromGroup = useCallback(() => {
    if (selectedIds.length === 0) return;
    removeFromGroup(selectedIds);
  }, [removeFromGroup, selectedIds]);

  const renameGroup = useCallback(
    (groupId: string, newName: string) => {
      const value = newName.trim();
      const group = cards.find((card) => card.id === groupId);
      if (!value || !group || value === contactDisplayName(group)) return;

      const previousCard = group;
      const merged: ContactCard = {
        ...group,
        name: {
          ...(group.name ?? { "@type": "Name", isOrdered: false }),
          full: value,
        },
      };

      setCards((prev) => prev.map((card) => (card.id === groupId ? merged : card)));
      const rollback = () => {
        setCards((prev) => prev.map((card) => (card.id === groupId ? previousCard : card)));
      };

      queueMutation({
        key: `contacts:rename-group:${groupId}`,
        toastMessage: L.toastGroupRenamed(value),
        icon: <Tag className="size-4" />,
        execute: async (signal) => {
          if (!operations) return;
          const saved = await patchGroupWithFreshEtag(
            operations,
            groupId,
            () => groupRenamePatch(value),
            signal,
          );
          setCards((prev) => prev.map((card) => (card.id === groupId ? saved : card)));
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Rename undone.",
      });
    },
    [L.toastGroupRenamed, cards, operations, queueMutation],
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      const group = cards.find((card) => card.id === groupId);
      if (!group) return;

      const groupName = contactDisplayName(group);
      const previousCards = cards;
      const previousView = view;

      setCards((prev) => prev.filter((card) => card.id !== groupId));
      // Navigate away from the deleted group to the all-contacts view.
      setView("all");
      setSearchQuery("");
      setEditMode(false);
      setCreateMode(false);
      setEditDraft(null);
      setActiveId("");

      const rollback = () => {
        setCards(previousCards);
        setView(previousView);
      };

      queueMutation({
        key: `contacts:delete-group:${groupId}`,
        toastMessage: L.toastGroupDeleted(groupName),
        execute: (signal) =>
          operations
            ? operations.deleteCard(groupId, contactMutationOpts(group, signal)).then(() => {})
            : Promise.resolve(),
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Group deletion undone.",
      });
    },
    [L.toastGroupDeleted, cards, operations, queueMutation, view],
  );

  const openDeleteGroupConfirm = useCallback(
    (groupId: string) => {
      const group = cards.find((card) => card.id === groupId);
      if (!group) return;
      const groupName = contactDisplayName(group);
      requestConfirm({
        title: L.deleteGroupTitle,
        description: L.deleteGroupDescription(groupName),
        confirmLabel: L.deleteConfirm,
        cancelLabel: L.deleteCancel,
        variant: "destructive",
        onConfirm: () => deleteGroup(groupId),
      });
    },
    [L, cards, deleteGroup, requestConfirm],
  );

  const createGroup = useCallback(
    (name: string, addressBookId: string, memberIds: string[] = []) => {
      const value = name.trim();
      const book = addressBooks.find((row) => row.id === addressBookId);
      if (!value || !canCreateGroupInAddressBook(book)) return;

      const membersToAdd = memberIds
        .map((id) => cards.find((card) => card.id === id))
        .filter((card): card is ContactCard => card !== undefined);
      const addressBookIds = { [addressBookId]: true as const };
      const membersPatch = groupAddMembersPatch(
        { members: {}, addressBookIds } as ContactCard,
        membersToAdd,
      );
      const body: ContactCardCreate = {
        addressBookIds,
        kind: "group",
        name: { "@type": "Name", isOrdered: false, full: value },
        ...(membersPatch?.members ? { members: membersPatch.members } : {}),
      };
      const optimisticId = `card-${newContactMapId()}`;
      const optimisticCard: ContactCard = {
        "@type": "Card",
        version: "1.0",
        id: optimisticId,
        uid: `urn:uuid:${newContactMapId()}`,
        ...body,
      };
      const previousCards = cards;

      setCards((prev) => [...prev, optimisticCard]);
      const rollback = () => {
        setCards(previousCards);
      };

      queueMutation({
        key: `contacts:create-group:${optimisticId}`,
        toastMessage: L.toastGroupCreated(value),
        icon: <Check className="size-4" />,
        execute: async (signal) => {
          if (!operations) return;
          const created = await operations.createCard(body, { signal });
          setCards((prev) => prev.map((card) => (card.id === optimisticId ? created : card)));
          if (membersToAdd.length === 0) return;
          const saved = await patchGroupWithFreshEtag(
            operations,
            created.id,
            (fresh) => groupAddMembersPatch(fresh, membersToAdd),
            signal,
          );
          setCards((prev) => prev.map((card) => (card.id === created.id ? saved : card)));
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Group creation undone.",
      });
    },
    [L.toastGroupCreated, addressBooks, cards, operations, queueMutation],
  );

  const addMembersToGroup = useCallback(
    (groupId: string, cardIds: string[]) => {
      const group = cards.find((card) => card.id === groupId);
      if (!group) return;

      const cardsToAdd = cardIds
        .map((id) => cards.find((card) => card.id === id))
        .filter((card): card is ContactCard => card !== undefined)
        .filter((card) => contactAndGroupShareAddressBook(card, group));

      const patch = groupAddMembersPatch(group, cardsToAdd);
      if (!patch) return;

      const groupName = contactDisplayName(group);
      const addedCount = Object.keys(patch.members ?? {}).length;
      const previousCard = group;
      const merged: ContactCard = {
        ...group,
        members: { ...group.members, ...patch.members } as ContactCard["members"],
      };

      setCards((prev) => prev.map((card) => (card.id === groupId ? merged : card)));
      const rollback = () => {
        setCards((prev) => prev.map((card) => (card.id === groupId ? previousCard : card)));
      };

      queueMutation({
        key: `contacts:add-members:${groupId}:${cardIds.slice().sort().join(",")}`,
        toastMessage: L.toastMembersAdded(addedCount, groupName),
        icon: <UserPlus className="size-4" />,
        execute: async (signal) => {
          if (!operations) return;
          const saved = await patchGroupWithFreshEtag(
            operations,
            groupId,
            (fresh) => {
              const cardsToAdd = cardIds
                .map((id) => cardsRef.current.find((card) => card.id === id))
                .filter((card): card is ContactCard => card !== undefined);
              return groupAddMembersPatch(fresh, cardsToAdd);
            },
            signal,
          );
          setCards((prev) => prev.map((card) => (card.id === groupId ? saved : card)));
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Add members undone.",
      });
    },
    [L, cards, operations, queueMutation],
  );

  const removeContactFromGroup = useCallback(
    (groupId: string, cardIds: string[]) => {
      if (cardIds.length === 0) return;
      const group = cards.find((card) => card.id === groupId);
      if (!group) return;

      const patch = groupRemoveMembersPatch(group, cardIds, cards);
      if (!patch) return;

      const removedCount = Object.keys(patch.members ?? {}).length;
      const previousCard = group;
      const merged: ContactCard = {
        ...group,
        members: { ...group.members, ...patch.members } as ContactCard["members"],
      };

      setCards((prev) => prev.map((card) => (card.id === groupId ? merged : card)));
      const rollback = () => {
        setCards((prev) => prev.map((card) => (card.id === groupId ? previousCard : card)));
      };

      queueMutation({
        key: `contacts:remove-members:${groupId}:${cardIds.slice().sort().join(",")}`,
        toastMessage: L.toastRemovedFromGroup(removedCount),
        icon: <UserMinus className="size-4" />,
        execute: async (signal) => {
          if (!operations) return;
          const saved = await patchGroupWithFreshEtag(
            operations,
            groupId,
            (fresh) => groupRemoveMembersPatch(fresh, cardIds, cardsRef.current),
            signal,
          );
          setCards((prev) => prev.map((card) => (card.id === groupId ? saved : card)));
        },
        undo: rollback,
        onError: rollback,
        undoToastMessage: "Removal undone.",
      });
    },
    [L.toastRemovedFromGroup, cards, operations, queueMutation],
  );

  const addActiveGroupTag = useCallback(
    (idOrLabel: string) => {
      if (!active || createMode || isContactGroupCard(active)) return;
      const existing = contactGroups.find((group) => group.id === idOrLabel);
      if (existing) {
        if (!canWriteContactGroup(existing, addressBooks, Boolean(operations))) return;
        if (!contactAndGroupShareAddressBook(active, existing)) return;
        addMembersToGroup(existing.id, [active.id]);
        return;
      }
      if (!canCreateGroup) return;
      const bookId = firstEnabledAddressBookId(active.addressBookIds);
      if (!bookId) return;
      if (!canCreateGroupInAddressBook(addressBooks.find((row) => row.id === bookId))) return;
      createGroup(idOrLabel, bookId, [active.id]);
    },
    [
      active,
      addMembersToGroup,
      addressBooks,
      canCreateGroup,
      contactGroups,
      createGroup,
      createMode,
      operations,
    ],
  );

  const removeActiveGroupTag = useCallback(
    (groupId: string) => {
      if (!active || createMode) return;
      const group = contactGroups.find((card) => card.id === groupId);
      if (!group || !canWriteContactGroup(group, addressBooks, Boolean(operations))) return;
      removeContactFromGroup(groupId, [active.id]);
    },
    [active, addressBooks, contactGroups, createMode, operations, removeContactFromGroup],
  );

  const persistContactEdit = useCallback(
    async (contactId: string, draft: ContactEditDraft) => {
      const card = cardsRef.current.find((row) => row.id === contactId);
      if (!card) {
        contactDraftsRef.current.delete(contactId);
        return;
      }
      if (!contactEditDraftHasChanges(draft, card)) {
        contactDraftsRef.current.delete(contactId);
        return;
      }

      const patch = editDraftToPatch(draft, card);
      const previousCard = card;
      const merged = mergeContactFromPatch(card, patch);

      const existingAbort = abortControllersRef.current.get(contactId);
      existingAbort?.abort();
      const controller = new AbortController();
      abortControllersRef.current.set(contactId, controller);

      setCards((prev) => prev.map((row) => (row.id === contactId ? merged : row)));

      try {
        if (!operations) {
          contactDraftsRef.current.delete(contactId);
          if (activeIdRef.current === contactId) {
            setEditDraft(contactCardToEditDraft(merged));
          }
          return;
        }
        const saved = await operations.patchCard(contactId, patch, {
          ...contactMutationOpts(card, controller.signal),
        });
        contactDraftsRef.current.delete(contactId);
        setCards((prev) => prev.map((row) => (row.id === contactId ? saved : row)));
        if (activeIdRef.current === contactId) {
          setEditDraft(contactCardToEditDraft(saved));
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCards((prev) => prev.map((row) => (row.id === contactId ? previousCard : row)));
        showMutationError();
      } finally {
        if (abortControllersRef.current.get(contactId) === controller) {
          abortControllersRef.current.delete(contactId);
        }
      }
    },
    [operations, showMutationError],
  );

  useEffect(() => {
    persistContactEditRef.current = persistContactEdit;
  }, [persistContactEdit]);

  useEffect(() => {
    if (!editMode || createMode || !editDraft || !activeId || activeId === CONTACTS_CREATE_ID)
      return;

    contactDraftsRef.current.set(activeId, editDraft);

    const card = cardsRef.current.find((row) => row.id === activeId);
    if (!card || !contactEditDraftHasChanges(editDraft, card)) return;

    debouncerRef.current.schedule(activeId, editDraft, (contactId, draft) => {
      void persistContactEditRef.current(contactId, draft);
    });
  }, [activeId, createMode, editDraft, editMode]);

  useEffect(() => {
    const debouncer = debouncerRef.current;
    return () => {
      debouncer.flushAll((contactId, draft) => {
        void persistContactEditRef.current(contactId, draft);
      });
    };
  }, []);

  const saveEdit = useCallback(() => {
    if (!editDraft || !createMode) return;

    if (!contactEditDraftHasContent(editDraft)) return;
    const body = editDraftToCreateBody(
      editDraft,
      resolveCreateAddressBookIds(view, addressBooks, cards),
    );
    const optimisticId = `card-${newContactMapId()}`;
    const optimisticCard: ContactCard = {
      "@type": "Card",
      version: "1.0",
      id: optimisticId,
      uid: `urn:uuid:${newContactMapId()}`,
      ...body,
    };
    const previousCards = cards;
    const groupId = selectedGroup?.id;

    setCards((prev) => cardsWithGroupMember([optimisticCard, ...prev], groupId, optimisticCard));
    setCreateMode(false);
    setEditMode(false);
    setEditDraft(null);
    setActiveId(optimisticId);
    const rollback = () => {
      setCards(previousCards);
      setActiveId("");
    };

    queueMutation({
      key: `contacts:create:${optimisticId}`,
      toastMessage: L.toastCreated,
      icon: <Check className="size-4" />,
      execute: async (signal) => {
        if (!operations) return;
        const created = await operations.createCard(body, { signal });
        setCards((prev) => {
          const replaced = prev.map((card) => (card.id === optimisticId ? created : card));
          return cardsWithGroupMember(replaced, groupId, created);
        });
        setActiveId(created.id);

        if (!groupId) return;
        const saved = await patchGroupWithFreshEtag(
          operations,
          groupId,
          (fresh) => groupAddMembersPatch(fresh, [created]),
          signal,
        );
        setCards((prev) => prev.map((card) => (card.id === groupId ? saved : card)));
      },
      undo: rollback,
      onError: rollback,
      undoToastMessage: "Create undone.",
    });
  }, [
    L.toastCreated,
    addressBooks,
    cards,
    createMode,
    editDraft,
    operations,
    queueMutation,
    selectedGroup,
    view,
  ]);

  useWorkspaceListKeyboardShortcuts({
    searchInputRef,
    selectedCount: selectedIds.length,
    onRequestDeleteSelection: selectedGroup
      ? requestRemoveSelectedFromGroup
      : requestDeleteSelected,
    onNavigateList: navigateListByKeyboard,
    onUndoQueuedAction: undoLatest,
  });

  const selectionActionButtons = useMemo(
    () =>
      selectedGroup
        ? [
            {
              label: L.selectionDownload,
              icon: <Download className="size-4" />,
              onClick: downloadSelected,
            },
            {
              label: L.selectionRemoveFromGroup,
              icon: <UserMinus className="size-4" />,
              onClick: requestRemoveSelectedFromGroup,
            },
          ]
        : [
            {
              label: L.selectionDownload,
              icon: <Download className="size-4" />,
              onClick: downloadSelected,
            },
            {
              label: L.selectionDelete,
              icon: <Trash2 className="size-4" />,
              onClick: requestDeleteSelected,
            },
          ],
    [
      L.selectionDelete,
      L.selectionDownload,
      L.selectionRemoveFromGroup,
      downloadSelected,
      requestDeleteSelected,
      requestRemoveSelectedFromGroup,
      selectedGroup,
    ],
  );

  const { selectionBarButtons, selectionBar } = useWorkspaceSelectionPresentation({
    selectedIds,
    selectionMode,
    activeId,
    exitSelection,
    actionButtons: selectionActionButtons,
    doneLabel: L.selectionDone,
    floatingClassName: "md:hidden",
  });

  return {
    L,
    cards,
    contactGroups,
    addressBooks,
    active,
    activeId,
    view,
    viewLabel,
    visibleCards,
    selectedIds,
    selectionMode,
    searchQuery,
    searchInputRef,
    workspaceLayoutRef,
    listLoading,
    isTouch,
    editMode,
    createMode,
    editDraft,
    displayName,
    canCreateContact,
    canImportVcf,
    canCreateGroup,
    canRenameGroup,
    canDeleteGroup,
    canEdit,
    canSaveCreate,
    confirmDialog,
    groupRenameDialog,
    createGroupDialog,
    setCreateGroupDialog,
    selectedGroup,
    selectionBar,
    selectionBarButtons,
    isItemDragging,
    itemDragHandlers,
    sidebarDropZoneProps,
    handleSelect,
    enterSelectionFor,
    closeMobileDetail,
    selectView,
    setSearchQuery,
    createContact,
    handleImportVcf,
    importFiles,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    importDialogProgress,
    closeImportDialog,
    submitImportDialog,
    dropImportActive,
    setDropImportActive,
    fileInputRef,
    startEdit,
    cancelEdit,
    saveEdit,
    deleteActive,
    downloadActive,
    downloadSelected,
    openDeleteConfirm,
    updateEditDraft,
    updatePhone,
    updateEmail,
    updatePhoneContext,
    updateEmailContext,
    updateAddress,
    updateAddressContext,
    updateUrl,
    updateUrlContext,
    removeUrl,
    removePhone,
    removeEmail,
    removeAddress,
    requestDeleteSelected,
    removeFromGroup,
    removeContactFromGroup,
    addActiveGroupTag,
    removeActiveGroupTag,
    renameGroup,
    deleteGroup,
    openDeleteGroupConfirm,
    createGroup,
    setGroupRenameDialog,
    addMembersToGroup,
    hiddenAddressBookIds,
    toggleAddressBookVisibility,
  };
}

export type ContactsControllerState = ReturnType<typeof useContactsController>;
