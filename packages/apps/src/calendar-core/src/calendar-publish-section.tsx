import { useState } from "react";
import { Copy, Globe2 } from "lucide-react";
import { Card } from "@/card/src/card";
import { IconButton } from "@/button/src/icon-button";
import { buttonVariants } from "@/button/src/button";
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
import type { CalendarFeedInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import "@/share-ui/share-ui.css";
import "./calendar-publish-section.css";

export type CalendarPublishSectionProps = {
  labels: CalendarUILabels;
  feed: CalendarFeedInfo | null;
  busy?: boolean;
  disabled?: boolean;
  onToggle: (enabled: boolean) => void;
  onCopyHttps: () => void;
  onCopyWebcal: () => void;
};

export function CalendarPublishSection({
  labels,
  feed,
  busy = false,
  disabled = false,
  onToggle,
  onCopyHttps,
  onCopyWebcal,
}: CalendarPublishSectionProps) {
  const enabled = Boolean(feed);
  const [confirmUnpublish, setConfirmUnpublish] = useState(false);

  return (
    <Card
      className="calendar-publish-section"
      titleIcon={<Globe2 className="size-4" />}
      title={labels.publishCalendarTitle}
      description={enabled ? labels.publishCalendarEnabledHint : labels.publishCalendarDisabledHint}
      action={
        <span className="share-dialog__switch-touch">
          <Switch
            checked={enabled}
            disabled={disabled || busy}
            onCheckedChange={(next) => {
              if (!next && enabled) {
                setConfirmUnpublish(true);
                return;
              }
              onToggle(next);
            }}
            aria-label={labels.publishCalendarTitle}
          />
        </span>
      }
    >
      {enabled && feed ? (
        <div className="share-dialog__link-controls">
          <div className="share-dialog__link-row">
            <ShareDialogInput
              type="text"
              value={feed.httpsUrl}
              readOnly
              mono
              aria-label={labels.publishCalendarHttpsLabel}
            />
            <IconButton
              label={labels.copyHttpsUrl}
              icon={<Copy className="size-3.5" aria-hidden />}
              size="sm"
              variant="outline"
              onClick={onCopyHttps}
            />
          </div>
          <div className="share-dialog__link-row">
            <ShareDialogInput
              type="text"
              value={feed.webcalUrl}
              readOnly
              mono
              aria-label={labels.publishCalendarWebcalLabel}
            />
            <IconButton
              label={labels.copyWebcalUrl}
              icon={<Copy className="size-3.5" aria-hidden />}
              size="sm"
              variant="outline"
              onClick={onCopyWebcal}
            />
          </div>
        </div>
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
    </Card>
  );
}
