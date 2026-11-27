import { useId, useState } from "react";
import { Copy } from "lucide-react";
import { Button, buttonVariants } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { LoadingSpinner } from "@/loading-spinner/src/loading-spinner";
import { calendarAvailabilityLabels as labels } from "@/settings-core/src/settings-calendar-availability-labels";
import type { SettingsCalendarPublicLinkController } from "@/settings-core/src/use-settings-calendar-public-link";
import { ShareDialogInput } from "@/share-ui/share-dialog-input";
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
import { FieldLabelRow } from "@/ui/field-label-row";
import { Switch } from "@/ui/switch";
import "@/share-ui/share-ui.css";

type Confirm = "turn-off" | "new-link" | null;

/**
 * The public availability link in Settings → Calendar (#2406), built like the published-calendar
 * section: a switch, the read-only address with a copy button, and a confirm before anything that
 * ends the current link. Turning off or making a new link both stop the old address at once.
 */
export function SettingsCalendarPublicLinkRow({
  controller,
}: {
  controller: SettingsCalendarPublicLinkController;
}) {
  const { phase, link, busy, setEnabled, regenerate, copy, retry } = controller;
  const switchId = useId();
  const [confirm, setConfirm] = useState<Confirm>(null);

  if (phase === "loading") {
    return (
      <FieldLabelRow layout="inline" label={labels.publicLink} description={labels.publicLinkHint}>
        <span className="settings-availability__pending" role="status" aria-label={labels.loading}>
          <LoadingSpinner size="sm" />
        </span>
      </FieldLabelRow>
    );
  }
  if (phase !== "ready" || !link) {
    return (
      <FieldLabelRow layout="inline" label={labels.publicLink} description={labels.publicLinkHint}>
        <span
          className="settings-availability__error"
          role={phase === "error" ? "alert" : "status"}
        >
          <span className="settings-availability__status">
            {phase === "offline" ? labels.publicLinkOffline : labels.publicLinkLoadError}
          </span>
          <Button type="button" variant="outline" size="sm" label={labels.retry} onClick={retry} />
        </span>
      </FieldLabelRow>
    );
  }

  const enabled = link.enabled;
  return (
    <>
      <FieldLabelRow
        layout="inline"
        label={labels.publicLink}
        description={labels.publicLinkHint}
        htmlFor={switchId}
        below={
          enabled && link.httpsUrl ? (
            <div className="share-dialog__link-row">
              <ShareDialogInput
                type="text"
                value={link.httpsUrl}
                readOnly
                aria-label={labels.publicLinkAddress}
              />
              <IconButton
                label={labels.publicLinkCopy}
                icon={<Copy aria-hidden />}
                variant="outline"
                onClick={() => void copy()}
              />
              <Button
                type="button"
                variant="outline"
                label={labels.publicLinkNew}
                disabled={busy}
                onClick={() => setConfirm("new-link")}
              />
            </div>
          ) : null
        }
      >
        <Switch
          id={switchId}
          tooltip={enabled ? labels.publicLinkTurnOff : labels.publicLinkTurnOn}
          checked={enabled}
          disabled={busy}
          onCheckedChange={(next) => {
            if (!next && enabled) setConfirm("turn-off");
            else void setEnabled(next);
          }}
        />
      </FieldLabelRow>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => !busy && !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "new-link" ? labels.newLinkTitle : labels.turnOffTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "new-link" ? labels.newLinkDescription : labels.turnOffDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{labels.cancel}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                const action = confirm;
                setConfirm(null);
                void (action === "new-link" ? regenerate() : setEnabled(false));
              }}
            >
              {confirm === "new-link" ? labels.newLinkConfirm : labels.turnOffConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
