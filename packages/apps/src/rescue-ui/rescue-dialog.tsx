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
import { ColorSwatchTrigger } from "@/ui/color-swatch-trigger";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { CalendarPickerMenuItem } from "@/lib/calendar-event-calendar-picker";
import { cn } from "@/lib/utils";
import type { ParkedWrite } from "@/lib/offline/core/parked-writes";
import {
  groupParkedWrites,
  type RescueGroup,
  type RescueTarget,
} from "@/lib/offline/core/rescue-parked-writes";
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
  view,
  onMove,
  onDiscard,
  onLater,
}: RescueDialogProps<T, C>) {
  const groups = useMemo(() => groupParkedWrites(writes), [writes]);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // Every container offered since the dialog opened, so the step count stays put.
  const [offered, setOffered] = useState<ReadonlySet<string>>(new Set());

  // Cleared on close, so a reopened dialog starts with every container waiting.
  useEffect(() => {
    if (open) return;
    setSkipped(new Set());
    setOffered(new Set());
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

  return (
    <Dialog open={open && !!current} onOpenChange={(next) => !next && !busy && onLater()}>
      <DialogContent className={cn(view.surfaceClassName, "rescue-dialog")}>
        {current ? (
          <RescueContainerStep
            key={current.containerId}
            group={current}
            step={total - waiting.length + 1}
            total={total}
            containers={containers}
            busy={busy}
            view={view}
            onMove={onMove}
            onDiscard={onDiscard}
            onLater={later}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RescueContainerStep<T, C extends RescueContainer>({
  group,
  step,
  total,
  containers,
  busy,
  view: { labels: L, containerIcon },
  onMove,
  onDiscard,
  onLater,
}: {
  group: RescueGroup<T>;
  step: number;
  total: number;
  containers: C[];
  busy: boolean;
  view: RescueView<C>;
  onMove: (ids: string[], target: RescueTarget) => void;
  onDiscard: (ids: string[]) => void;
  onLater: () => void;
}) {
  const id = useId();
  // A new container keeps the rescued items together; an existing one is one pick away.
  const [destinationId, setDestinationId] = useState(NEW_CONTAINER);
  const [newName, setNewName] = useState(() =>
    L.newContainerName(group.containerName, group.reason),
  );

  // A container that stops being writable while the dialog is open is no longer a choice.
  useEffect(() => {
    if (
      destinationId !== NEW_CONTAINER &&
      !containers.some((container) => container.id === destinationId)
    ) {
      setDestinationId(NEW_CONTAINER);
    }
  }, [destinationId, containers]);

  const ids = group.writes.map((write) => write.id);
  const count = ids.length;
  const hasEdits = group.writes.some((write) => write.kind === "edit");

  const creating = destinationId === NEW_CONTAINER;
  const selected = containers.find((container) => container.id === destinationId);
  const destinationName = creating ? L.newContainer : (selected?.name ?? "");
  const target: RescueTarget | null = creating
    ? newName.trim()
      ? { newContainerName: newName.trim() }
      : null
    : selected
      ? { containerId: selected.id }
      : null;

  return (
    <>
      <DialogHeader>
        {total > 1 ? (
          <p className="field-label-row__label rescue-dialog__step">{L.step(step, total)}</p>
        ) : null}
        <DialogTitle>{L.title(count, group.containerName)}</DialogTitle>
        <DialogDescription>
          {L.reason(group.containerName, group.reason)}
          {hasEdits ? ` ${L.editsAsNew}` : ""}
        </DialogDescription>
      </DialogHeader>
      <div className="rescue-dialog__destination">
        <FieldLabelRow label={L.destinationLabel} htmlFor={`${id}-destination`}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ColorSwatchTrigger
                id={`${id}-destination`}
                icon={selected ? containerIcon(selected) : undefined}
                showSwatch={false}
                size="md"
                label={`${L.destinationLabel}: ${destinationName}`}
                className="rescue-dialog__destination-trigger"
                disabled={busy}
              >
                {destinationName}
              </ColorSwatchTrigger>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="calendar-event-dialog__calendar-menu calendar-event-dialog__calendar-menu--match-trigger"
            >
              {containers.map((container) => (
                <CalendarPickerMenuItem
                  key={container.id}
                  name={container.name}
                  icon={containerIcon(container)}
                  selected={destinationId === container.id}
                  onSelect={() => setDestinationId(container.id)}
                />
              ))}
              {containers.length > 0 ? <DropdownMenuSeparator /> : null}
              <CalendarPickerMenuItem
                name={L.newContainer}
                selected={creating}
                onSelect={() => setDestinationId(NEW_CONTAINER)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldLabelRow>
        {creating ? (
          <FieldLabelRow label={L.newContainerLabel} htmlFor={`${id}-new-name`}>
            <Input
              id={`${id}-new-name`}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              disabled={busy}
            />
          </FieldLabelRow>
        ) : null}
      </div>
      <DialogFooter className="rescue-dialog__actions">
        <Button
          className="rescue-dialog__discard"
          variant="outline"
          severity="danger"
          onClick={() => onDiscard(ids)}
          disabled={busy}
        >
          {L.discard(count)}
        </Button>
        <div className="rescue-dialog__choices">
          <Button variant="outline" onClick={onLater} disabled={busy}>
            {L.later}
          </Button>
          <Button
            variant="primary"
            onClick={() => target && onMove(ids, target)}
            disabled={busy || !target}
          >
            {L.move(count)}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** The way back to the dialog while writes wait for a container, in the view header. */
export function RescueEntry<C extends RescueContainer>({
  containers,
  view,
  onOpen,
}: {
  /** How many containers have writes waiting. */
  containers: number;
  view: Pick<RescueView<C>, "labels" | "entryIcon">;
  onOpen: () => void;
}) {
  if (containers === 0) return null;
  return (
    <Button
      className="rescue-entry"
      variant="outline"
      size="md"
      icon={view.entryIcon}
      label={view.labels.entry(containers)}
      onClick={onOpen}
    />
  );
}
