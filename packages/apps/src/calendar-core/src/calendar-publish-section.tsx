import { useId, useState } from "react";
import { Copy } from "lucide-react";
import { IconButton } from "@/button/src/icon-button";
import { buttonVariants } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Switch } from "@/ui/switch";
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
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
import type { CalendarFeedInfo, CalendarFeedMode } from "@/lib/models/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import "@/share-ui/share-ui.css";

export type CalendarPublishSectionProps = {
  labels: CalendarUILabels;
  feed: CalendarFeedInfo | null;
  busy?: boolean;
  disabled?: boolean;
  onToggle: (enabled: boolean, mode?: CalendarFeedMode) => void;
  onCopyHttps: () => void;
};

export function CalendarPublishSection({
  labels,
  feed,
  busy = false,
  disabled = false,
  onToggle,
  onCopyHttps,
}: CalendarPublishSectionProps) {
  const enabled = Boolean(feed);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);
  const publishSwitchId = useId();
  const busySwitchId = useId();

  return (
    <>
      <FieldLabelRow
        layout="inline"
        section
        label={labels.publishCalendarTitle}
        htmlFor={publishSwitchId}
        description={
          enabled ? labels.publishCalendarEnabledHint : labels.publishCalendarDisabledHint
        }
        below={
          enabled && feed ? (
            <div className="share-dialog__link-row">
              <ShareDialogInput
                type="text"
                value={feed.httpsUrl}
                readOnly
                aria-label={labels.publishCalendarHttpsLabel}
              />
              <IconButton
                label={labels.copyHttpsUrl}
                icon={<Copy aria-hidden />}
                variant="outline"
                onClick={onCopyHttps}
              />
            </div>
          ) : null
        }
      >
        <Switch
          id={publishSwitchId}
          tooltip={enabled ? labels.publishCalendarTurnOff : labels.publishCalendarTurnOn}
          checked={enabled}
          disabled={disabled || busy}
          onCheckedChange={(next) => {
            if (!next && enabled) {
              setConfirmUnpublish(true);
              return;
            }
            onToggle(next);
          }}
        />
      </FieldLabelRow>

      {enabled && feed ? (
        <>
          <FieldLabelRow
            layout="inline"
            label={labels.publishCalendarBusyLabel}
            htmlFor={busySwitchId}
            description={labels.publishCalendarBusyHint}
          >
            <Switch
              id={busySwitchId}
              tooltip={
                feed.mode === "busy"
                  ? labels.publishCalendarBusyTurnOff
                  : labels.publishCalendarBusyTurnOn
              }
              checked={feed.mode === "busy"}
              disabled={disabled || busy}
              onCheckedChange={(next) => onToggle(true, next ? "busy" : "full")}
            />
          </FieldLabelRow>
        </>
      ) : null}

      <AlertDialog
        open={confirmUnpublish}
        onOpenChange={(open) => !busy && setConfirmUnpublish(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.unpublishCalendarTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.unpublishCalendarDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                setConfirmUnpublish(false);
                onToggle(false);
              }}
            >
              {labels.unpublishCalendarConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
