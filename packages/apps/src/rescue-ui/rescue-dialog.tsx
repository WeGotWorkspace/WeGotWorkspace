import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { CollectionGhostButton } from "@/ui/collection-ghost-select";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { CalendarPickerMenuItem } from "@/lib/calendar-event-calendar-picker";
import type { ParkedWrite } from "@/lib/offline/core/parked-writes";
import { groupParkedWrites, type RescueTarget } from "@/lib/offline/core/rescue-parked-writes";
import type { RescueContainer, RescueView } from "@/rescue-ui/rescue-adapter";
import "@/rescue-ui/rescue-dialog.css";

export type RescueDialogProps<T, C extends RescueContainer> = {
  open: boolean;
  writes: ParkedWrite<T>[];
  /** Containers the person can add items to. */
  containers: C[];
  busy?: boolean;
  view: RescueView<C>;
  onMove: (ids: string[], target: RescueTarget) => void;
  onDiscard: (ids: string[]) => void;
  /** Closing without a choice keeps the writes parked. */
  onLater: () => void;
};

/** The menu value for a new container; never a real container id. */
const NEW_CONTAINER = "__new-container__";

/** The choice for one container's writes; a draft for another container no longer applies. */
type RescueDraft = { containerId: string; destinationId: string; newName: string };

/**
 * Asks where writes the server refused should go (#1825, #1565), one container
 * at a time: all writes that lost the same container share one reason and one
 * choice. With several containers, their dialogs follow each other; "Decide
 * later" skips to the next one and keeps the writes parked.
 */
export function RescueDialog<T, C extends RescueContainer>({
  open,
  writes,
  containers,
  busy = false,
  view: { labels: L, containerIcon, surfaceClassName },
  onMove,
  onDiscard,
  onLater,
}: RescueDialogProps<T, C>) {
  const id = useId();
  const groups = useMemo(() => groupParkedWrites(writes), [writes]);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // Every container offered since the dialog opened, so the step count stays put.
  const [offered, setOffered] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState<RescueDraft | null>(null);

  // Cleared on close, so a reopened dialog starts with every container waiting.
  useEffect(() => {
    if (open) return;
    setSkipped(new Set());
    setOffered(new Set());
    setDraft(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setOffered((current) => {
      const missing = groups.filter((group) => !current.has(group.containerId));
      return missing.length === 0
        ? current
        : new Set([...current, ...missing.map((group) => group.containerId)]);
    });
  }, [groups, open]);

  const waiting = groups.filter((group) => !skipped.has(group.containerId));
  const current = waiting[0];
  const total = Math.max(offered.size, groups.length);

  const later = () => {
    if (!current || waiting.length <= 1) onLater();
    else setSkipped((skip) => new Set([...skip, current.containerId]));
  };

  // Moving or discarding the last container on screen while earlier ones were
  // put off leaves only skipped ones: close as "later" so the lock is let go and
  // the header entry can ask about them again.
  const onLaterRef = useRef(onLater);
  useEffect(() => {
    onLaterRef.current = onLater;
  }, [onLater]);
  const onlySkippedLeft = open && groups.length > 0 && waiting.length === 0;
  useEffect(() => {
    if (onlySkippedLeft) onLaterRef.current();
  }, [onlySkippedLeft]);

  // A new container keeps the rescued items together; an existing one is one pick away.
  const own = current && draft?.containerId === current.containerId ? draft : null;
  const destinationId = own?.destinationId ?? NEW_CONTAINER;
  const newName = current
    ? (own?.newName ?? L.newContainerName(current.containerName, current.reason))
    : "";
  // A container that stops being writable while the dialog is open is no longer a choice.
  const selected = containers.find((container) => container.id === destinationId);
  const creating = !selected;
  const destinationName = selected ? selected.name : L.newContainer;
  const target: RescueTarget | null = selected
    ? { containerId: selected.id }
    : newName.trim()
      ? { newContainerName: newName.trim() }
      : null;

  const updateDraft = (patch: Partial<Omit<RescueDraft, "containerId">>) => {
    if (current) setDraft({ containerId: current.containerId, destinationId, newName, ...patch });
  };

  const ids = current?.writes.map((write) => write.id) ?? [];
  const count = ids.length;
  const hasEdits = current?.writes.some((write) => write.kind === "edit") ?? false;

  return (
    <Dialog open={open && !!current} onOpenChange={(next) => !next && !busy && onLater()}>
      <DialogContent className={surfaceClassName}>
        {current ? (
          <>
            <DialogHeader>
              {total > 1 ? (
                <p className="field-label-row__label rescue-dialog__step">
                  {L.step(total - waiting.length + 1, total)}
                </p>
              ) : null}
              <DialogTitle>{L.title(count, current.containerName)}</DialogTitle>
              <DialogDescription>
                {L.reason(current.containerName, current.reason)}
                {hasEdits ? ` ${L.editsAsNew}` : ""}
              </DialogDescription>
            </DialogHeader>
            <FieldLabelRow layout="inline" label={L.destinationLabel} htmlFor={`${id}-destination`}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <CollectionGhostButton
                    id={`${id}-destination`}
                    aria-label={`${L.destinationLabel}: ${destinationName}`}
                    leading={selected ? containerIcon(selected) : null}
                    label={destinationName}
                    disabled={busy}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="calendar-event-dialog__calendar-menu">
                  {containers.map((container) => (
                    <CalendarPickerMenuItem
                      key={container.id}
                      name={container.name}
                      icon={containerIcon(container)}
                      selected={destinationId === container.id}
                      onSelect={() => updateDraft({ destinationId: container.id })}
                    />
                  ))}
                  {containers.length > 0 ? <DropdownMenuSeparator /> : null}
                  <CalendarPickerMenuItem
                    name={L.newContainer}
                    selected={creating}
                    onSelect={() => updateDraft({ destinationId: NEW_CONTAINER })}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            </FieldLabelRow>
            {creating ? (
              <FieldLabelRow
                layout="inline"
                fill
                label={L.newContainerLabel}
                htmlFor={`${id}-new-name`}
              >
                <Input
                  id={`${id}-new-name`}
                  value={newName}
                  onChange={(event) => updateDraft({ newName: event.target.value })}
                  disabled={busy}
                />
              </FieldLabelRow>
            ) : null}
            <DialogFooter
              start={
                <Button
                  variant="outline"
                  severity="danger"
                  onClick={() => onDiscard(ids)}
                  disabled={busy}
                >
                  {L.discard(count)}
                </Button>
              }
            >
              <Button variant="outline" onClick={later} disabled={busy}>
                {L.later}
              </Button>
              <Button
                variant="primary"
                onClick={() => target && onMove(ids, target)}
                disabled={busy || !target}
              >
                {L.move(count)}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
