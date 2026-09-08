import { Button } from "@/button/src/button";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { MeetChannelEmailChoice } from "@/calendar-core/src/calendar-meet-channel-email";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import "./calendar-meet-channel-email-dialog.css";

const CHOICES: {
  id: MeetChannelEmailChoice;
  variant: "subtle" | "primary";
  label: (labels: CalendarUILabels) => string;
}[] = [
  {
    id: "keep-both",
    variant: "subtle",
    label: (row) => row.eventMeetChannelEmailKeepBoth,
  },
  {
    id: "strip-emails",
    variant: "subtle",
    label: (row) => row.eventMeetChannelEmailStripEmails,
  },
  {
    id: "replace-with-room",
    variant: "primary",
    label: (row) => row.eventMeetChannelEmailReplaceLink,
  },
];

export type CalendarMeetChannelEmailDialogProps = {
  open: boolean;
  labels: CalendarUILabels;
  busy?: boolean;
  contentClassName?: string;
  onOpenChange: (open: boolean) => void;
  onChoice: (choice: MeetChannelEmailChoice) => void;
};

export function CalendarMeetChannelEmailDialog({
  open,
  labels,
  busy = false,
  contentClassName = "calendar-dialog-surface",
  onOpenChange,
  onChoice,
}: CalendarMeetChannelEmailDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent
        className={`${contentClassName} calendar-meet-channel-email-dialog`.trim()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.eventMeetChannelEmailTitle}</AlertDialogTitle>
          <AlertDialogDescription>{labels.eventMeetChannelEmailDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter
          className="calendar-meet-channel-email-dialog__footer"
          role="group"
          aria-label={labels.eventMeetChannelEmailTitle}
        >
          {CHOICES.map((choice) => (
            <Button
              key={choice.id}
              type="button"
              variant={choice.variant}
              disabled={busy}
              className="calendar-meet-channel-email-dialog__action"
              onClick={() => onChoice(choice.id)}
            >
              {choice.label(labels)}
            </Button>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
