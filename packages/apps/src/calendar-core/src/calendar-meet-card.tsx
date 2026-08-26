import { useRef, useState, type MutableRefObject } from "react";
import { Copy, Video } from "lucide-react";
import { buttonVariants } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { Card } from "@/card/src/card";
import { CardRow } from "@/card/src/card-row";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import { copyShareText } from "@/share-ui/share-path-utils";
import "@/share-ui/share-ui.css";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import {
  patchCalendarEventForm,
  type CalendarEventFormValue,
} from "@/calendar-core/src/calendar-editor-model";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import {
  calendarMeetOwnerPrincipal,
  formEventEndMs,
  isHttpUrl,
  meetRemoveExpiresAt,
  parseCalendarMeetHref,
  resolveCalendarMeetReserveScope,
  resolveMeetReserveExpiresAt,
  roomCodeFromMeetingUrl,
  type CalendarMeetOperations,
} from "@/calendar-core/src/calendar-meet-link";
import type { RecurrenceEditScope } from "@/calendar-core/src/calendar-recurrence-scope";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import { createMeetRoomCode } from "@/meet-core/src/meet-room-id";
import { buildMeetGuestCallLink } from "@/meet-core/src/meet-route-search";
import { CalendarMeetJoin } from "@/calendar-core/src/calendar-meet-join";

export type CalendarMeetCardProps = {
  form: CalendarEventFormValue;
  labels: CalendarUILabels;
  calendar?: CalendarInfo;
  username?: string;
  workspaceOrigin: string;
  recurrenceId?: string;
  recurrenceSaveScope?: RecurrenceEditScope;
  thisInstanceLocked?: boolean;
  meetOperations?: CalendarMeetOperations;
  disabled?: boolean;
  readOnly?: boolean;
  /** Parent calls this on dialog cancel/dismiss (not save) to expire a staged reserve. */
  abandonStagedReserveRef?: MutableRefObject<(() => void) | null>;
  onChange: (next: CalendarEventFormValue) => void;
  onRecurrenceSaveScopeChange?: (scope: RecurrenceEditScope) => void;
  onJoin?: (href: string) => void;
};

function applyForm(
  form: CalendarEventFormValue,
  patch: Partial<CalendarEventFormValue>,
  onChange: (next: CalendarEventFormValue) => void,
): CalendarEventFormValue {
  const next = patchCalendarEventForm(form, patch);
  onChange(next);
  return next;
}

function CalendarMeetUrlRow({
  href,
  labels,
  readOnly = false,
  disabled = false,
  generateDisabled = false,
  reserving = false,
  onGenerate,
  onChange,
  onBlur,
}: {
  href: string;
  labels: CalendarUILabels;
  readOnly?: boolean;
  disabled?: boolean;
  generateDisabled?: boolean;
  reserving?: boolean;
  onGenerate?: () => void;
  onChange?: (value: string) => void;
  onBlur?: () => void;
}) {
  const trimmed = href.trim();
  return (
    <div className="calendar-event-dialog__meet-row share-dialog__link-row">
      <ShareDialogInput
        type="url"
        value={href}
        readOnly={readOnly}
        disabled={disabled}
        placeholder={labels.eventMeetUrlPlaceholder}
        aria-label={labels.eventMeetUrlLabel}
        onChange={
          onChange
            ? (event) => {
                onChange(event.target.value);
              }
            : undefined
        }
        onBlur={onBlur}
      />
      <IconButton
        label={labels.copyHttpsUrl}
        icon={<Copy className="size-3.5" aria-hidden />}
        size="sm"
        variant="outline"
        disabled={!trimmed}
        onClick={() => {
          void copyShareText(trimmed);
        }}
      />
      {onGenerate ? (
        <IconButton
          className="calendar-event-dialog__meet-generate"
          label={labels.eventMeetAdd}
          icon={
            reserving ? <LoadingSpinner size="sm" /> : <Video className="size-3.5" aria-hidden />
          }
          size="sm"
          variant="outline"
          disabled={generateDisabled}
          onClick={() => {
            onGenerate();
          }}
        />
      ) : null}
    </div>
  );
}

export function CalendarMeetCard({
  form,
  labels,
  calendar,
  username,
  workspaceOrigin,
  recurrenceId,
  recurrenceSaveScope,
  thisInstanceLocked = false,
  meetOperations,
  disabled = false,
  readOnly = false,
  abandonStagedReserveRef,
  onChange,
  onRecurrenceSaveScopeChange,
  onJoin,
}: CalendarMeetCardProps) {
  const [reserving, setReserving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const inflightRef = useRef(false);
  const pendingAbandonRef = useRef(false);
  const stagedRoomRef = useRef(form.meetRoomCode?.trim() ?? "");
  const reservedThisSessionRef = useRef(Boolean(form.meetRoomCode));
  const hrefDraftRef = useRef(form.meetingUrl);
  const canChooseScope = Boolean(recurrenceId) && !thisInstanceLocked && !readOnly;
  const scope = resolveCalendarMeetReserveScope({
    recurrencePreset: form.recurrencePreset,
    recurrenceId,
    recurrenceSaveScope: thisInstanceLocked ? "thisInstance" : recurrenceSaveScope,
  });

  const expireStagedRoom = async (room: string): Promise<void> => {
    const patch = meetOperations?.patchRoomExpiresAt;
    if (!patch) return;
    try {
      await patch({ room, expiresAt: meetRemoveExpiresAt() });
    } catch {
      // Best-effort GC clock; the form still clears.
    }
  };

  const abandonStagedReserve = async (): Promise<void> => {
    if (inflightRef.current) {
      pendingAbandonRef.current = true;
      return;
    }
    const room = stagedRoomRef.current.trim();
    if (!room || !reservedThisSessionRef.current) return;
    await expireStagedRoom(room);
    reservedThisSessionRef.current = false;
  };

  if (abandonStagedReserveRef) {
    abandonStagedReserveRef.current = () => {
      void abandonStagedReserve();
    };
  }

  const addMeet = async (replaceExisting = false): Promise<void> => {
    const reserve = meetOperations?.reserveRoom;
    const ownerPrincipal = calendarMeetOwnerPrincipal(calendar, username);
    if (!reserve || !ownerPrincipal || inflightRef.current || reserving) return;
    if (!replaceExisting && hrefDraftRef.current.trim()) return;
    inflightRef.current = true;
    setReserving(true);
    const previousRoom =
      stagedRoomRef.current.trim() ||
      form.meetRoomCode?.trim() ||
      roomCodeFromMeetingUrl(hrefDraftRef.current, workspaceOrigin) ||
      roomCodeFromMeetingUrl(form.meetingUrl, workspaceOrigin);
    if (replaceExisting && previousRoom) {
      await expireStagedRoom(previousRoom);
    }
    const room = createMeetRoomCode();
    stagedRoomRef.current = room;
    hrefDraftRef.current = "";
    applyForm(form, { meetRoomCode: room, meetingUrl: "" }, onChange);
    try {
      const eventEndMs = formEventEndMs(form);
      await reserve({
        room,
        ownerPrincipal,
        expiresAt: resolveMeetReserveExpiresAt(scope, eventEndMs),
      });
      reservedThisSessionRef.current = true;
      const href = buildMeetGuestCallLink(room, workspaceOrigin);
      const drafted = hrefDraftRef.current.trim();
      const draftedParsed = parseCalendarMeetHref(drafted, workspaceOrigin);
      if (draftedParsed?.kind === "https") {
        await expireStagedRoom(room);
        reservedThisSessionRef.current = false;
        stagedRoomRef.current = "";
        applyForm(
          { ...form, meetRoomCode: room },
          { meetingUrl: drafted, meetRoomCode: undefined },
          onChange,
        );
        return;
      }
      hrefDraftRef.current = href;
      applyForm(
        { ...form, meetRoomCode: room },
        { meetingUrl: href, meetRoomCode: room },
        onChange,
      );
    } finally {
      inflightRef.current = false;
      setReserving(false);
      if (pendingAbandonRef.current) {
        pendingAbandonRef.current = false;
        await expireStagedRoom(room);
        reservedThisSessionRef.current = false;
      }
    }
  };

  const requestGenerate = (): void => {
    if (hrefDraftRef.current.trim()) {
      setConfirmReplace(true);
      return;
    }
    void addMeet(false);
  };

  const removeMeet = async (): Promise<void> => {
    const room =
      stagedRoomRef.current.trim() ||
      form.meetRoomCode?.trim() ||
      roomCodeFromMeetingUrl(form.meetingUrl, workspaceOrigin);
    if (room) await expireStagedRoom(room);
    stagedRoomRef.current = "";
    reservedThisSessionRef.current = false;
    hrefDraftRef.current = "";
    applyForm(form, { meetingUrl: "", meetRoomCode: undefined }, onChange);
  };

  const changeScope = async (next: RecurrenceEditScope): Promise<void> => {
    if (next === recurrenceSaveScope) return;
    if (reservedThisSessionRef.current || form.meetRoomCode) {
      await removeMeet();
    } else if (form.meetingUrl.trim()) {
      applyForm(form, { meetingUrl: "" }, onChange);
    }
    onRecurrenceSaveScopeChange?.(next);
  };

  const expireLocalWgwRoom = async (): Promise<void> => {
    const room = stagedRoomRef.current.trim() || form.meetRoomCode?.trim() || "";
    if (room) await expireStagedRoom(room);
    stagedRoomRef.current = "";
    reservedThisSessionRef.current = false;
  };

  const onUrlBlur = async (): Promise<void> => {
    const raw = hrefDraftRef.current.trim();
    if (!raw) {
      await expireLocalWgwRoom();
      applyForm(form, { meetingUrl: "", meetRoomCode: undefined }, onChange);
      return;
    }
    if (!isHttpUrl(raw)) {
      applyForm(form, { meetingUrl: "" }, onChange);
      return;
    }
    const parsed = parseCalendarMeetHref(raw, workspaceOrigin);
    if (!parsed) {
      applyForm(form, { meetingUrl: "" }, onChange);
      return;
    }
    if (parsed.kind === "https") {
      await expireLocalWgwRoom();
      applyForm(form, { meetingUrl: raw, meetRoomCode: undefined }, onChange);
      return;
    }
    const reserve = meetOperations?.reserveRoom;
    const ownerPrincipal = calendarMeetOwnerPrincipal(calendar, username);
    if (!reserve || !ownerPrincipal) return;
    try {
      await reserve({
        room: parsed.room,
        ownerPrincipal,
        expiresAt: meetRemoveExpiresAt(),
      });
      stagedRoomRef.current = parsed.room;
      reservedThisSessionRef.current = true;
      applyForm(form, { meetRoomCode: parsed.room, meetingUrl: raw }, onChange);
    } catch {
      // Paste still stores the href; persist-path reserve is authoritative.
    }
  };

  if (readOnly) {
    if (!form.meetingUrl.trim()) return null;
    return (
      <div className="calendar-event-dialog__meet-readonly">
        <CalendarMeetUrlRow href={form.meetingUrl} labels={labels} readOnly />
        <CalendarMeetJoin
          href={form.meetingUrl}
          labels={labels}
          workspaceOrigin={workspaceOrigin}
          meetOperations={meetOperations}
          onJoin={onJoin}
        />
      </div>
    );
  }

  const canGenerate = !disabled && !reserving && Boolean(meetOperations?.reserveRoom);

  return (
    <Card
      className="calendar-event-dialog__card calendar-event-dialog__meet"
      titleIcon={<Video className="size-4" />}
      title={labels.eventMeetSectionTitle}
    >
      {canChooseScope ? (
        <CardRow title={labels.eventMeetApplyTo}>
          <Select
            value={recurrenceSaveScope ?? "thisAndFuture"}
            onValueChange={(value) => {
              void changeScope(value as RecurrenceEditScope);
            }}
            disabled={disabled || reserving}
          >
            <SelectTrigger
              className="calendar-event-dialog__meet-scope-trigger"
              aria-label={labels.eventMeetApplyTo}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="thisInstance">{labels.recurrenceScopeThisInstance}</SelectItem>
              <SelectItem value="thisAndFuture">{labels.recurrenceScopeThisAndFuture}</SelectItem>
            </SelectContent>
          </Select>
        </CardRow>
      ) : null}
      <CardRow fill>
        <CalendarMeetUrlRow
          href={form.meetingUrl}
          labels={labels}
          disabled={disabled}
          generateDisabled={!canGenerate}
          reserving={reserving}
          onGenerate={requestGenerate}
          onChange={(value) => {
            hrefDraftRef.current = value;
            applyForm(form, { meetingUrl: value }, onChange);
          }}
          onBlur={() => {
            void onUrlBlur();
          }}
        />
      </CardRow>
      <AlertDialog
        open={confirmReplace}
        onOpenChange={(open) => !reserving && setConfirmReplace(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.eventMeetDisableTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.eventMeetDisableDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reserving}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={reserving}
              onClick={(event) => {
                event.preventDefault();
                setConfirmReplace(false);
                void addMeet(true);
              }}
            >
              {labels.eventMeetDisableConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
