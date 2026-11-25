import { useId, type FormEvent } from "react";
import { Button } from "@/button/src/button";
import { Callout } from "@/callout/src/callout";
import { RECOVERY_CODE_COUNT, type TwoFactorSetup } from "@/lib/api/wgw/two-factor-settings";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { twoFactorSettingsLabels as labels } from "@/settings-core/src/settings-two-factor-labels";
import type { TwoFactorDialog } from "@/settings-core/src/settings-two-factor-model";
import type { SettingsTwoFactorController } from "@/settings-core/src/use-settings-two-factor";
import { Tag } from "@/tag/src/tag";
import { AuthenticatorQrCode } from "@/two-factor-ui/src/authenticator-qr-code";
import {
  AuthenticatorSecretField,
  RecoveryCodesList,
  TwoFactorCodeField,
} from "@/two-factor-ui/src/two-factor-fields";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

/**
 * Settings → Security → Two-factor sign-in (#2275): on or off, how many recovery codes are
 * left, and the dialogs that turn it on, turn it off and replace the codes.
 * `onMakeAppPassword` opens the app password dialog from the setup's DAV warning.
 */
export function SettingsTwoFactorSection({
  controller,
  onMakeAppPassword,
}: {
  controller: SettingsTwoFactorController;
  onMakeAppPassword: () => void;
}) {
  return (
    <>
      <SettingsPaneCard title={labels.title}>
        <TwoFactorRows controller={controller} />
      </SettingsPaneCard>
      <TwoFactorStepDialog controller={controller} onMakeAppPassword={onMakeAppPassword} />
      <RecoveryCodesDialog controller={controller} />
    </>
  );
}

function TwoFactorRows({ controller }: { controller: SettingsTwoFactorController }) {
  const { phase, state } = controller;
  if (phase !== "ready") {
    return phase === "error" ? (
      <div className="settings-security-pane__failure" role="alert">
        <p className="settings-security-pane__note">{labels.loadFailed}</p>
        <Button type="button" variant="outline" onClick={controller.retry}>
          {labels.retry}
        </Button>
      </div>
    ) : (
      <p className="settings-security-pane__note" role="status">
        {phase === "loading" ? labels.loading : labels.offline}
      </p>
    );
  }
  const left = state.recoveryCodesRemaining;
  return (
    <>
      <FieldLabelRow
        layout="inline"
        label={labels.statusLabel}
        description={labels.statusDescription}
        labelAccessory={
          <Tag
            label={state.enabled ? labels.statusOn : labels.statusOff}
            tone={state.enabled ? "success" : "warning"}
            dot={state.enabled}
          />
        }
      >
        <Button
          type="button"
          variant="outline"
          severity={state.enabled ? "danger" : undefined}
          onClick={state.enabled ? controller.openDisable : controller.openSetup}
        >
          {state.enabled ? labels.turnOff : labels.turnOn}
        </Button>
      </FieldLabelRow>
      {state.enabled ? (
        <FieldLabelRow
          layout="inline"
          label={labels.codesLabel}
          description={
            left === null
              ? labels.codesLeftUnknown
              : left === 0
                ? labels.codesNoneLeft
                : labels.codesLeft(left, RECOVERY_CODE_COUNT)
          }
        >
          <Button type="button" variant="outline" onClick={controller.openReplace}>
            {labels.replaceCodes}
          </Button>
        </FieldLabelRow>
      ) : null}
    </>
  );
}

function dialogText(dialog: TwoFactorDialog): {
  title: string;
  description: string;
  submit: string;
} {
  switch (dialog.kind) {
    case "setup-password":
      return {
        title: labels.setupTitle,
        description: labels.setupPasswordDescription,
        submit: labels.next,
      };
    case "setup-scan":
      return {
        title: labels.setupTitle,
        description: labels.scanDescription,
        submit: labels.turnOnConfirm,
      };
    case "disable":
      return {
        title: labels.disableTitle,
        description: labels.disableDescription,
        submit: labels.disableConfirm,
      };
    default:
      return {
        title: labels.replaceTitle,
        description: labels.replaceDescription,
        submit: labels.replaceConfirm,
      };
  }
}

/** One dialog for every step that asks for something: the password, a code. */
function TwoFactorStepDialog({
  controller,
  onMakeAppPassword,
}: {
  controller: SettingsTwoFactorController;
  onMakeAppPassword: () => void;
}) {
  const { dialog, busy } = controller;
  const open = dialog !== null && dialog.kind !== "codes";
  const text = open ? dialogText(dialog) : null;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void controller.submit();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && controller.close()}>
      <DialogContent>
        {open && text ? (
          <>
            <DialogHeader>
              <DialogTitle>{text.title}</DialogTitle>
              <DialogDescription>{text.description}</DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} noValidate>
              {dialog.kind === "setup-password" ? (
                <SetupPasswordStep controller={controller} unsynced={dialog.unsynced} />
              ) : null}
              {dialog.kind === "setup-scan" ? (
                <SetupScanStep
                  setup={dialog.setup}
                  onMakeAppPassword={() => {
                    controller.close();
                    onMakeAppPassword();
                  }}
                />
              ) : null}
              {dialog.kind !== "setup-password" ? (
                <TwoFactorCodeField
                  layout="inline"
                  value={controller.code}
                  onChange={controller.setCode}
                  disabled={busy}
                  autoFocus
                  error={controller.codeError || undefined}
                  clockHint={controller.wrongCode}
                />
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={controller.close}>
                  {labels.cancel}
                </Button>
                <Button
                  type="submit"
                  variant={dialog.kind === "disable" ? "destructive" : "primary"}
                  disabled={busy}
                >
                  {text.submit}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SetupPasswordStep({
  controller,
  unsynced,
}: {
  controller: SettingsTwoFactorController;
  unsynced: number | null;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <>
      <FieldLabelRow layout="inline" fill label={labels.currentPasswordLabel} htmlFor={id}>
        <div className="two-factor-code-control">
          <Input
            id={id}
            variant="password"
            autoComplete="current-password"
            value={controller.password}
            onChange={(event) => controller.setPassword(event.target.value)}
            disabled={controller.busy}
            autoFocus
            aria-invalid={controller.passwordError ? true : undefined}
            aria-describedby={controller.passwordError ? errorId : undefined}
          />
          {controller.passwordError ? (
            <p id={errorId} className="two-factor-field-error" role="alert">
              {controller.passwordError}
            </p>
          ) : null}
        </div>
      </FieldLabelRow>
      <p className="settings-security-pane__note settings-two-factor__note">{labels.signOutNote}</p>
      {unsynced !== 0 ? (
        <Callout
          className="settings-two-factor__callout"
          severity="warning"
          title={labels.unsyncedNote(unsynced)}
        />
      ) : null}
    </>
  );
}

/** "18 Nov": the warning reads "on 18 Nov", never "on Yesterday". */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(iso),
  );
}

function SetupScanStep({
  setup,
  onMakeAppPassword,
}: {
  setup: TwoFactorSetup;
  onMakeAppPassword: () => void;
}) {
  return (
    <>
      {setup.davPasswordUsedAt ? (
        <Callout
          className="settings-two-factor__callout"
          severity="warning"
          title={labels.davWarningTitle}
          message={labels.davWarning(formatDay(setup.davPasswordUsedAt))}
          action={
            <Button type="button" variant="outline" onClick={onMakeAppPassword}>
              {labels.davWarningAction}
            </Button>
          }
        />
      ) : null}
      <div className="settings-two-factor__qr">
        <AuthenticatorQrCode uri={setup.otpauthUri} />
      </div>
      <AuthenticatorSecretField layout="inline" secret={setup.secret} />
    </>
  );
}

/** The new recovery codes: no close button, and Done waits for "I saved them". */
function RecoveryCodesDialog({ controller }: { controller: SettingsTwoFactorController }) {
  const { dialog } = controller;
  const codes = dialog?.kind === "codes" ? dialog.codes : null;
  return (
    <AlertDialog open={codes !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.codesTitle}</AlertDialogTitle>
          <AlertDialogDescription>{labels.codesDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {codes ? (
          <RecoveryCodesList
            codes={codes}
            saved={controller.codesSaved}
            onSavedChange={controller.setCodesSaved}
          />
        ) : null}
        <AlertDialogFooter>
          <Button
            type="button"
            variant="primary"
            disabled={!controller.codesSaved || controller.busy}
            onClick={() => void controller.submit()}
          >
            {labels.done}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
