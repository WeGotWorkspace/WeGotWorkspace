import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { buttonVariants } from "@/button/src/button";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarShareGrantEntries,
  calendarSharePermissionFromRights,
  calendarShareRightsForPermission,
  displayNameForSharePrincipal,
  type CalendarSharePrincipal,
  type CalendarShareWith,
} from "@/calendar-core/src/calendar-share";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { NOTES_SHARE_UI_PERMISSIONS } from "@/share-ui/share-access-map";
import { ShareAccessCard } from "@/share-ui/share-access-card";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { shareLabels } from "@/share-ui/share-labels";
import { SharePrincipalMark } from "@/share-ui/share-principal-mark";
import { SharePrincipalRow } from "@/share-ui/share-principal-row";
import {
  SharePrincipalSearchDropdown,
  type ShareSearchOption,
} from "@/share-ui/share-principal-search-dropdown";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ui/dialog";
import { cn } from "@/lib/utils";
import "@/share-ui/share-ui.css";

export type CalendarShareDialogProps = {
  open: boolean;
  calendar: CalendarInfo | null;
  labels: CalendarUILabels;
  knownPrincipals?: readonly CalendarSharePrincipal[];
  disabled?: boolean;
  online?: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchPrincipals: (query: string) => Promise<CalendarSharePrincipal[]>;
  onPatchShareWith: (calendarId: string, shareWith: CalendarShareWith) => Promise<void>;
};

export function CalendarShareDialog({
  open,
  calendar,
  labels,
  knownPrincipals = [],
  disabled = false,
  online = true,
  onOpenChange,
  onSearchPrincipals,
  onPatchShareWith,
}: CalendarShareDialogProps) {
  const locked = disabled || !online;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CalendarSharePrincipal[]>([]);
  const [searching, setSearching] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setPendingRemoval(null);
    }
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setSearching(true);
      void onSearchPrincipals(trimmed)
        .then((entries) => setResults(entries))
        .finally(() => setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [onSearchPrincipals, open, query]);

  const grants = useMemo(
    () => calendarShareGrantEntries(calendar?.shareWith),
    [calendar?.shareWith],
  );
  const existingIds = useMemo(() => new Set(grants.map((grant) => grant.id)), [grants]);
  const selectableResults = results.filter((entry) => !existingIds.has(entry.id));
  const searchOptions: ShareSearchOption[] = selectableResults.map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    principalType: entry.principalType,
    meta: entry.memberCount != null ? shareLabels.membersSuffix(entry.memberCount) : undefined,
  }));

  const patchShare = async (shareWith: CalendarShareWith): Promise<void> => {
    if (!calendar || locked || busy) return;
    setBusy(true);
    try {
      await onPatchShareWith(calendar.id, shareWith);
      setQuery("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn("share-dialog", "calendar-dialog-surface", "share-dialog__content")}
          onPointerDownOutside={(event) => {
            const target = event.target as Element | null;
            if (target?.closest("[data-radix-popper-content-wrapper]")) {
              event.preventDefault();
            }
          }}
        >
          <DialogHeader className="share-dialog__header">
            <DialogTitle>
              {calendar ? labels.shareCalendarTitle(calendar.name) : labels.shareCalendar}
            </DialogTitle>
            <DialogDescription>{labels.shareCalendarDescription}</DialogDescription>
          </DialogHeader>

          {calendar ? (
            <div className="share-dialog__body">
              {!online ? (
                <p className="share-dialog__error">{labels.shareCalendarOffline}</p>
              ) : null}
              <ShareAccessCard
                titleIcon={<Users className="size-4" />}
                title={labels.shareCalendarSectionTitle}
                description={labels.shareCalendarSectionHint}
                addControl={
                  <SharePrincipalSearchDropdown
                    query={query}
                    searching={searching}
                    results={searchOptions}
                    emptyLabel={labels.shareCalendarSearchEmpty}
                    listLabel={labels.shareCalendarSectionTitle}
                    onSelect={(option) => {
                      const entry = selectableResults.find((row) => row.id === option.id);
                      if (!entry) return;
                      void patchShare({
                        [entry.id]: calendarShareRightsForPermission("view"),
                      });
                    }}
                  >
                    <ShareDialogInput
                      value={query}
                      disabled={locked || busy}
                      placeholder={labels.shareCalendarAddPlaceholder}
                      className="share-dialog__add-grant-input"
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </SharePrincipalSearchDropdown>
                }
              >
                {grants.map((grant) => {
                  const title = displayNameForSharePrincipal(grant.id, knownPrincipals);
                  const permission = calendarSharePermissionFromRights(grant.rights);
                  return (
                    <SharePrincipalRow
                      key={grant.id}
                      mark={
                        <SharePrincipalMark
                          principalType={grant.isGroup ? "group" : "user"}
                          displayName={title}
                          active
                        />
                      }
                      title={title}
                      subtitle={grant.isGroup ? undefined : grant.id}
                      access={permission === "edit" ? "edit" : "view"}
                      editable={!locked && !busy}
                      removeDisabled={locked || busy}
                      permissions={NOTES_SHARE_UI_PERMISSIONS}
                      onAccessChange={(next) => {
                        void patchShare({
                          [grant.id]: calendarShareRightsForPermission(next),
                        });
                      }}
                      onRemove={() => setPendingRemoval(grant.id)}
                    />
                  );
                })}
              </ShareAccessCard>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemoval != null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent className="calendar-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.removeCalendarShareTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.removeCalendarShareConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{shareLabels.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (!pendingRemoval) return;
                const id = pendingRemoval;
                setPendingRemoval(null);
                void patchShare({ [id]: null });
              }}
            >
              {shareLabels.confirmContinue}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
