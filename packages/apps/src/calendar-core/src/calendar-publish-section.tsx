import { useState } from "react";
import { Copy, ExternalLink, Globe2 } from "lucide-react";
import { Card } from "@/card/src/card";
import { IconButton } from "@/button/src/icon-button";
import { Button, buttonVariants } from "@/button/src/button";
import {
  BUTTON_ICON_SLOT_CLASSNAME,
  ICON_BUTTON_SIZE_CLASSNAMES,
} from "@/button/src/button.shared";
import { Switch } from "@/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
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
import { cn } from "@/lib/utils";
import "@/share-ui/share-ui.css";
import "./calendar-publish-section.css";

export type CalendarPublishSectionProps = {
  labels: CalendarUILabels;
  feed: CalendarFeedInfo | null;
  busy?: boolean;
  disabled?: boolean;
  onToggle: (enabled: boolean) => void;
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
        <div className="share-dialog__link-controls calendar-publish-section__link-controls">
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="outline"
                  className={cn("calendar-publish-section__open", ICON_BUTTON_SIZE_CLASSNAMES.sm)}
                  aria-label={labels.openInCalendar}
                >
                  <a href={feed.webcalUrl}>
                    <span className={BUTTON_ICON_SLOT_CLASSNAME}>
                      <ExternalLink className="size-3.5" aria-hidden />
                    </span>
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{labels.openInCalendar}</TooltipContent>
            </Tooltip>
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
