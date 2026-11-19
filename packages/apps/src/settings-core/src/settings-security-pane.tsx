import { useId } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { DataTable, type DataTableColumn } from "@/data-table/src/data-table";
import { useAppToast } from "@/hooks/use-app-toast";
import { formatListDateTime } from "@/lib/datetime/format-list-date";
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
import { FieldLabelRow } from "@/ui/field-label-row";
import { Form } from "@/ui/form";
import { FormTextField } from "@/ui/form-text-field";
import { Input } from "@/ui/input";
import "./settings-security-pane.css";

/**
 * Settings → Security: two-factor sign-in (#2275), then app passwords for calendar, contacts
 * and meeting apps (#2272). Each app password is made for one app, shown once, and can be
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
  const controller = useSettingsAppPasswords(operations);
  const twoFactorController = useSettingsTwoFactor(twoFactor);
  const ready = controller.phase === "ready";
  return (
    <>
      <SettingsTwoFactorSection
        controller={twoFactorController}
        onMakeAppPassword={controller.openCreate}
      />
      <SettingsPaneCard
        title={labels.title}
        icon={<KeyRound aria-hidden />}
        action={
          ready ? (
            <span className="settings-security-pane__actions">
              {controller.rows.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => controller.askRemove({ kind: "all" })}
                >
                  {labels.removeAllButton}
                </Button>
              ) : null}
              <IconButton
                type="button"
                variant="outline"
                size="md"
                icon={<Plus aria-hidden />}
                label={labels.newButton}
                onClick={controller.openCreate}
              />
            </span>
          ) : null
        }
      >
        <p className="workspace-page-section__lead">{labels.lead}</p>
        <AppPasswordsBody controller={controller} />
      </SettingsPaneCard>
      <CreateAppPasswordDialog controller={controller} />
      <RemoveAppPasswordDialog controller={controller} />
    </>
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
    return <p className="settings-security-pane__note">{labels.empty}</p>;
  }
  return (
    <DataTable
      className="settings-security-pane__table"
      data={rows}
      columns={appPasswordColumns((row) => controller.askRemove({ kind: "one", row }))}
      rowKey={(row) => String(row.id)}
    />
  );
}

function appPasswordColumns(onRemove: (row: AppPassword) => void): DataTableColumn<AppPassword>[] {
  return [
    {
      key: "name",
      header: labels.columns.name,
      render: (row) => <span className="list-table__name">{row.name}</span>,
    },
    {
      key: "client",
      header: labels.columns.client,
      muted: true,
      render: (row) =>
        row.lastUsedClient ? (
          <span className="settings-security-pane__client" title={row.lastUsedClient}>
            {row.lastUsedClient}
          </span>
        ) : null,
    },
    {
      key: "lastUsed",
      header: labels.columns.lastUsed,
      muted: true,
      shrink: true,
      render: (row) => (row.lastUsedAt ? formatListDateTime(row.lastUsedAt) : labels.neverUsed),
    },
    {
      key: "created",
      header: labels.columns.created,
      muted: true,
      shrink: true,
      render: (row) => formatListDateTime(row.createdAt),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "end",
      shrink: true,
      render: (row) => (
        <IconButton
          type="button"
          variant="ghost"
          size="md"
          icon={<Trash2 aria-hidden />}
          label={labels.remove(row.name)}
          onClick={() => onRemove(row)}
        />
      ),
    },
  ];
}

function CreateAppPasswordDialog({ controller }: { controller: SettingsAppPasswordsController }) {
  const { form, createOpen, closeCreate, submitCreate, created } = controller;
  const busy = form.formState.isSubmitting;
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
                <FormTextField
                  layout="inline"
                  name="currentPassword"
                  label={labels.currentPasswordLabel}
                  variant="password"
                  autoComplete="current-password"
                />
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
