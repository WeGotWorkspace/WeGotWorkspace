import { useId } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { useAppToast } from "@/hooks/use-app-toast";
import { formatRelativeDay, parseTimestamp } from "@/lib/datetime/format-list-date";
import {
  formatAppPassword,
  type AppPassword,
  type AppPasswordOperations,
} from "@/lib/api/wgw/app-passwords";
import { copyShareText } from "@/share-ui/share-path-utils";
import { appPasswordLabels as labels } from "@/settings-core/src/settings-app-passwords-labels";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import { SettingsTwoFactorSection } from "@/settings-core/src/settings-two-factor-section";
import {
  useSettingsTwoFactor,
  type SettingsTwoFactorOptions,
} from "@/settings-core/src/use-settings-two-factor";
import {
  useSettingsAppPasswords,
  type SettingsAppPasswordsController,
} from "@/settings-core/src/use-settings-app-passwords";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { TwoFactorCodeField } from "@/two-factor-ui/src/two-factor-fields";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form } from "@/ui/form";
import { FormTextField } from "@/ui/form-text-field";
import { Input } from "@/ui/input";
import "./settings-security-pane.css";

/**
 * Settings → Security: two-factor sign-in (#2275), then app passwords for calendar and
 * contacts apps (#2272). Each app password is made for one app, shown once, and can be
 * removed on its own or all at once.
 */
export function SettingsSecurityPane({
  operations,
  twoFactor,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: AppPasswordOperations;
  twoFactor?: SettingsTwoFactorOptions;
}) {
  const twoFactorController = useSettingsTwoFactor(twoFactor);
  const controller = useSettingsAppPasswords(operations, twoFactorController.state.enabled);
  const ready = controller.phase === "ready";
  return (
    <div className="settings-security-pane">
      <SettingsTwoFactorSection
        controller={twoFactorController}
        onMakeAppPassword={controller.openCreate}
      />
      <SettingsPaneCard
        title={labels.title}
        action={
          ready && controller.rows.length > 0 ? (
            <span className="settings-security-pane__actions">
              {controller.rows.length > 1 ? (
                <Button
                  type="button"
                  variant="outline"
                  severity="danger"
                  onClick={() => controller.askRemove({ kind: "all" })}
                >
                  {labels.removeAllButton}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={controller.openCreate}>
                {labels.newButton}
              </Button>
            </span>
          ) : null
        }
      >
        <p className="workspace-page-section__lead">{labels.lead}</p>
        <AppPasswordsBody controller={controller} />
      </SettingsPaneCard>
      <CreateAppPasswordDialog controller={controller} />
      <RemoveAppPasswordDialog controller={controller} />
    </div>
  );
}

function AppPasswordsBody({ controller }: { controller: SettingsAppPasswordsController }) {
  const { phase, rows } = controller;
  if (phase === "loading" || phase === "offline") {
    return (
      <p className="settings-security-pane__note" role="status">
        {phase === "loading" ? labels.loading : labels.offline}
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div className="settings-security-pane__failure" role="alert">
        <p className="settings-security-pane__note">{labels.loadFailed}</p>
        <Button type="button" variant="outline" onClick={controller.retry}>
          {labels.retry}
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    // Nothing to list: the create button takes the place of the empty note.
    return (
      <div className="mt-3">
        <Button type="button" variant="outline" className="-ms-3" onClick={controller.openCreate}>
          {labels.newButton}
        </Button>
      </div>
    );
  }
  return (
    <>
      {rows.map((row) => (
        <FieldLabelRow
          key={row.id}
          layout="inline"
          className="settings-security-pane__row"
          label={row.name}
          description={appPasswordDescription(row)}
        >
          <Button
            type="button"
            variant="outline"
            severity="danger"
            aria-label={labels.remove(row.name)}
            onClick={() => controller.askRemove({ kind: "one", row })}
          >
            {labels.removeButton}
          </Button>
        </FieldLabelRow>
      ))}
    </>
  );
}

/** "Created 20 Nov · Last used 2 days ago · Thunderbird/128.4", or "· Not used yet". */
export function appPasswordDescription(row: AppPassword, now = new Date()): string {
  const parts = [labels.created(formatDay(row.createdAt, now))];
  const used = row.lastUsedAt ? parseTimestamp(row.lastUsedAt) : null;
  if (used === null) parts.push(labels.notUsed);
  else {
    parts.push(labels.lastUsed(formatRelativeDay(new Date(used), now, { capitalised: false })));
    if (row.lastUsedClient) parts.push(row.lastUsedClient);
  }
  return parts.join(" · ");
}

/** Day and month; the year too when it is not this year. */
function formatDay(raw: string, now: Date): string {
  const ms = parseTimestamp(raw);
  if (ms === null) return raw;
  const date = new Date(ms);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

function CreateAppPasswordDialog({ controller }: { controller: SettingsAppPasswordsController }) {
  const { form, createOpen, closeCreate, submitCreate, created, asksCode } = controller;
  const busy = form.formState.isSubmitting;
  const code = form.watch("code");
  const codeError = form.formState.errors.code?.message;
  return (
    <Dialog open={createOpen} onOpenChange={(open) => !open && !busy && closeCreate()}>
      <DialogContent>
        {created ? (
          <CreatedAppPassword password={created} onDone={closeCreate} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{labels.createTitle}</DialogTitle>
              <DialogDescription>{labels.createDescription}</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={submitCreate} noValidate>
                <FormTextField
                  layout="inline"
                  name="name"
                  label={labels.nameLabel}
                  placeholder={labels.namePlaceholder}
                  autoComplete="off"
                  autoFocus
                />
                {asksCode ? (
                  <TwoFactorCodeField
                    layout="inline"
                    value={code}
                    onChange={(value) => {
                      form.setValue("code", value);
                      // Emptying the boxes after a wrong code keeps the message.
                      if (value !== "") form.clearErrors("code");
                    }}
                    disabled={busy}
                    error={codeError}
                    clockHint={controller.wrongCode}
                  />
                ) : (
                  <FormTextField
                    layout="inline"
                    name="currentPassword"
                    label={labels.currentPasswordLabel}
                    variant="password"
                    autoComplete="current-password"
                  />
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" disabled={busy} onClick={closeCreate}>
                    {labels.cancel}
                  </Button>
                  <Button type="submit" variant="primary" disabled={busy}>
                    {labels.create}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The plaintext, once: grouped in fours to read and type, copied without the spaces. */
function CreatedAppPassword({ password, onDone }: { password: string; onDone: () => void }) {
  const fieldId = useId();
  const { showSuccess, showError } = useAppToast();
  const copy = async () => {
    if (await copyShareText(password)) showSuccess(labels.copied);
    else showError(labels.copyFailed);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>{labels.createdTitle}</DialogTitle>
        <DialogDescription>{labels.createdDescription}</DialogDescription>
      </DialogHeader>
      <FieldLabelRow layout="inline" fill label={labels.createdLabel} htmlFor={fieldId}>
        <div className="settings-security-pane__secret-row">
          <Input
            id={fieldId}
            className="settings-security-pane__secret"
            value={formatAppPassword(password)}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <IconButton
            type="button"
            variant="outline"
            size="md"
            icon={<Copy aria-hidden />}
            label={labels.copy}
            onClick={() => void copy()}
          />
        </div>
      </FieldLabelRow>
      <DialogFooter>
        <Button type="button" variant="primary" onClick={onDone}>
          {labels.done}
        </Button>
      </DialogFooter>
    </>
  );
}

function RemoveAppPasswordDialog({ controller }: { controller: SettingsAppPasswordsController }) {
  const { removal, askRemove, confirmRemove, removing } = controller;
  const all = removal?.kind === "all";
  const name = removal?.kind === "one" ? removal.row.name : "";
  return (
    <AlertDialog
      open={removal !== null}
      onOpenChange={(open) => !open && !removing && askRemove(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {all ? labels.removeAllTitle : labels.removeTitle(name)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {all ? labels.removeAllDescription : labels.removeDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" disabled={removing}>
              {labels.cancel}
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={(event) => {
                event.preventDefault();
                void confirmRemove();
              }}
            >
              {all ? labels.removeAllConfirm : labels.removeConfirm}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
