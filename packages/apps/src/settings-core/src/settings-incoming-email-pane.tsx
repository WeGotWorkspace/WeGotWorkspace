import { useEffect, useId, useState, type ReactNode } from "react";
import { useForm, useFormState, useWatch } from "react-hook-form";
import { Mail } from "lucide-react";
import { Button } from "@/button/src/button";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { incomingEmailLabels as labels } from "@/settings-core/src/settings-incoming-email-labels";
import {
  usualIncomingEmailPort,
  type IncomingEmailFormValues,
  type IncomingMailbox,
  type IncomingMailboxOperations,
} from "@/settings-core/src/settings-incoming-email-source";
import { SettingsInfoButton } from "@/settings-core/src/settings-info-button";
import { SettingsPageStatus } from "@/settings-core/src/settings-page-status";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";
import {
  useSettingsIncomingEmail,
  type IncomingEmailBusy,
  type SettingsIncomingEmailController,
} from "@/settings-core/src/use-settings-incoming-email";
import { Tag, type TagTone } from "@/tag/src/tag";
import { Form, FormField } from "@/ui/form";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { FormTextField } from "@/ui/form-text-field";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import "./settings-incoming-email-pane.css";

/** Stands in for the saved password in its read-only row; the real one is never loaded. */
const PASSWORD_MASK = "••••••••••";

/**
 * Settings → Incoming email (#1589): the IMAP mailbox apps read for the user. What an app
 * reads from it is that app's setting (Calendar: Invitation replies). Connect logs in to the mailbox first; nothing is stored when that
 * fails. Every login counts against a small server limit, so nothing logs in by itself: edits
 * wait for Test connection. Which folder an app reads is that app's own setting.
 */
export function SettingsIncomingEmailPane({
  operations,
}: {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: IncomingMailboxOperations;
}) {
  const controller = useSettingsIncomingEmail(operations);
  const { isDirty } = useFormState({ control: controller.form.control });
  const tag =
    controller.phase === "ready" ? (
      <IncomingEmailTag
        {...incomingEmailTag({
          mailbox: controller.mailbox,
          busy: controller.busy,
          dirty: isDirty,
        })}
      />
    ) : null;
  return (
    <SettingsPaneCard
      title={labels.title}
      icon={<Mail aria-hidden />}
      action={
        <span className="settings-incoming-email__header-action">
          <AboutMailbox />
          {/* In the page title row, where other panes show Saved; the card when there is none. */}
          <SettingsPageStatus fallback={tag}>{tag}</SettingsPageStatus>
        </span>
      }
    >
      <IncomingEmailBody controller={controller} />
    </SettingsPaneCard>
  );
}

/** What apps read and which providers work: behind an info button, not on the page. */
function AboutMailbox() {
  return (
    <SettingsInfoButton label={labels.about}>
      <p>{labels.reading}</p>
      <p>{labels.providers}</p>
    </SettingsInfoButton>
  );
}

type IncomingEmailTagState = { label: string; tone?: TagTone; detail?: string | null };

function IncomingEmailTag({ label, tone, detail }: IncomingEmailTagState) {
  const tag = (
    <span
      role="status"
      tabIndex={detail ? 0 : undefined}
      aria-description={detail ?? undefined}
      className="settings-incoming-email__tag"
    >
      <Tag label={label} tone={tone} dot={tone !== undefined} />
    </span>
  );
  if (!detail) return tag;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tag}</TooltipTrigger>
      <TooltipContent className="settings-incoming-email__tooltip">{detail}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The connection state in a word or two, with what it cannot say in its tooltip. It shows the
 * server's last answer; unsaved edits say Unsaved until Test connection saves them.
 */
function incomingEmailTag({
  mailbox,
  busy,
  dirty = false,
}: {
  mailbox: IncomingMailbox | null;
  busy: IncomingEmailBusy;
  dirty?: boolean;
}): IncomingEmailTagState {
  if (busy === "connect") return { label: labels.tag.connecting, tone: "pending" };
  if (!mailbox) return { label: labels.tag.notConnected };
  if (busy === "save" || busy === "test") return { label: labels.tag.checking, tone: "pending" };
  if (busy === "disconnect") return { label: labels.tag.disconnecting, tone: "pending" };
  if (dirty) return { label: labels.tag.unsaved, tone: "warning", detail: labels.unsavedDetail };
  const detail = incomingEmailStatusLine(mailbox);
  if (!mailbox.active) return { label: labels.tag.paused, tone: "warning", detail };
  const error = incomingEmailError(mailbox);
  if (error && !REPLY_WAITING_ERRORS.has(error)) {
    return { label: labels.tag.failed, tone: "warning", detail };
  }
  // A reply that waits for its sender's DNS does not stop the connection: the detail says it.
  return { label: labels.tag.connected, tone: "success", detail };
}

/** Errors about one waiting reply, not about signing in to the mailbox. */
const REPLY_WAITING_ERRORS: ReadonlySet<string> = new Set(["dns_unavailable"]);

/**
 * The error to show, if any. `untrusted_server_unknown` is no longer reported (senders are
 * checked by DKIM without a trusted server) and only lingers until the next check.
 */
function incomingEmailError(mailbox: IncomingMailbox): string | null {
  const error = mailbox.lastError;
  return error && error !== "untrusted_server_unknown" ? error : null;
}

function IncomingEmailBody({ controller }: { controller: SettingsIncomingEmailController }) {
  const { phase, retry } = controller;
  if (phase === "loading" || phase === "offline") {
    return (
      <p className="settings-incoming-email__note">
        {phase === "loading" ? labels.loading : labels.offline}
      </p>
    );
  }
  if (phase === "error") {
    return (
      <div className="settings-incoming-email__actions" role="alert">
        <p className="settings-incoming-email__note">{labels.loadError}</p>
        <Button type="button" variant="outline" size="sm" label={labels.retry} onClick={retry} />
      </div>
    );
  }
  return controller.mailbox ? (
    <ConnectedMailbox controller={controller} />
  ) : (
    <NewMailbox controller={controller} />
  );
}

/** "13 Nov, 02:19"; the year only when it is not this year. */
function formatChecked(iso: string): string {
  const date = new Date(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** What the tag cannot say: the error, why it pauses, or when it last checked. */
function incomingEmailStatusLine(mailbox: IncomingMailbox): string | null {
  const checked = mailbox.lastCheckedAt
    ? labels.lastChecked(formatChecked(mailbox.lastCheckedAt))
    : null;
  if (!mailbox.active) return labels.statusPaused;
  const error = incomingEmailError(mailbox);
  if (error) {
    const reason = labels.errors[error] ?? labels.failed;
    return checked ? `${reason} ${checked}` : reason;
  }
  return checked;
}

function TextRow({
  name,
  label,
  description,
  control,
  type = "text",
  autoComplete,
  placeholder,
}: {
  name: Exclude<keyof IncomingEmailFormValues, "security">;
  label: string;
  description?: string;
  control: SettingsIncomingEmailController["form"]["control"];
  type?: "text" | "password";
  autoComplete?: string;
  placeholder?: string;
}): ReactNode {
  const id = useId();
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FieldLabelRow layout="inline" fill label={label} description={description} htmlFor={id}>
          <Input
            id={id}
            {...field}
            variant={type === "password" ? "password" : "default"}
            inputMode={name === "port" ? "numeric" : undefined}
            autoComplete={autoComplete}
            spellCheck={false}
            placeholder={placeholder}
          />
        </FieldLabelRow>
      )}
    />
  );
}

/** Mail server, security, port and username: the same rows before and after connecting. */
function ConnectionRows({ controller }: { controller: SettingsIncomingEmailController }) {
  const { form } = controller;
  const securityId = useId();
  const security = useWatch({ control: form.control, name: "security" });
  return (
    <>
      <TextRow
        name="host"
        label={labels.host}
        description={labels.hostHint}
        control={form.control}
      />
      <FormField
        control={form.control}
        name="security"
        render={({ field }) => (
          <FieldLabelRow layout="inline" label={labels.security} htmlFor={securityId}>
            <Select value={field.value} onValueChange={field.onChange}>
              <CollectionGhostSelectTrigger id={securityId} label={<SelectValue />} />
              <SelectContent align="end">
                <SelectItem value="ssl">{labels.securitySsl}</SelectItem>
                <SelectItem value="starttls">{labels.securityStarttls}</SelectItem>
              </SelectContent>
            </Select>
          </FieldLabelRow>
        )}
      />
      <TextRow
        name="port"
        label={labels.port}
        description={labels.portHint}
        control={form.control}
        placeholder={String(usualIncomingEmailPort(security))}
      />
      <TextRow
        name="username"
        label={labels.username}
        description={labels.usernameHint}
        control={form.control}
        autoComplete="off"
      />
    </>
  );
}

function Failure({ text }: { text: string | null }) {
  return text ? (
    <p className="settings-incoming-email__failure" role="alert">
      {text}
    </p>
  ) : null;
}

/** Before the first connect: every row, the password typed in, and Connect. */
function NewMailbox({ controller }: { controller: SettingsIncomingEmailController }) {
  const { form, busy, failure } = controller;
  const connecting = busy === "connect";
  return (
    <Form {...form}>
      <form
        className="settings-incoming-email"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          controller.connect();
        }}
      >
        <ConnectionRows controller={controller} />
        <TextRow
          name="password"
          label={labels.password}
          control={form.control}
          type="password"
          autoComplete="new-password"
        />
        <div className="settings-incoming-email__actions">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            label={connecting ? labels.connecting : labels.connect}
            disabled={busy !== null}
          />
        </div>
        <Failure text={failure} />
      </form>
    </Form>
  );
}

/** Connected: Test connection saves edits, the password changes in a dialog, Disconnect asks first. */
function ConnectedMailbox({ controller }: { controller: SettingsIncomingEmailController }) {
  const { form, busy, failure } = controller;
  const checking = busy === "save" || busy === "test";
  const passwordId = useId();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const { confirmDialog, requestConfirm } = useConfirmDialog();

  const requestDisconnect = () =>
    requestConfirm({
      title: labels.disconnectTitle,
      description: labels.disconnectDescription,
      confirmLabel: labels.disconnect,
      cancelLabel: labels.cancel,
      variant: "destructive",
      onConfirm: () => void controller.disconnect(),
    });

  return (
    <>
      <Form {...form}>
        <form
          className="settings-incoming-email"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            controller.check();
          }}
        >
          <ConnectionRows controller={controller} />
          <FieldLabelRow layout="inline" fill label={labels.password} htmlFor={passwordId}>
            <div className="settings-value-control">
              {/* Plain text, not type=password: there is nothing to reveal. */}
              <Input
                id={passwordId}
                value={PASSWORD_MASK}
                readOnly
                aria-label={labels.passwordHidden}
              />
              <Button type="button" variant="outline" onClick={() => setPasswordOpen(true)}>
                {labels.passwordChange}
              </Button>
            </div>
          </FieldLabelRow>
          {/* Under the rows it is about, above the buttons. */}
          <Failure text={failure} />
          <div className="settings-incoming-email__actions">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              label={checking ? labels.checking : labels.check}
              disabled={busy !== null}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              label={labels.disconnect}
              disabled={busy !== null}
              onClick={requestDisconnect}
            />
          </div>
        </form>
      </Form>
      <ChangeMailboxPasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        changePassword={controller.changePassword}
      />
      {confirmDialog}
    </>
  );
}

type PasswordDialogValues = { password: string };

function ChangeMailboxPasswordDialog({
  open,
  onOpenChange,
  changePassword,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changePassword: SettingsIncomingEmailController["changePassword"];
}) {
  const form = useForm<PasswordDialogValues>({ defaultValues: { password: "" } });
  const busy = form.formState.isSubmitting;

  useEffect(() => {
    if (open) form.reset({ password: "" });
  }, [open, form]);

  const submit = form.handleSubmit(async ({ password }) => {
    if (!password) {
      form.setError("password", { message: labels.passwordRequired });
      return;
    }
    const failed = await changePassword(password);
    if (failed) form.setError("password", { message: failed });
    else onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.passwordDialogTitle}</DialogTitle>
          <DialogDescription>{labels.passwordDialogDescription}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} noValidate>
            <FormTextField
              layout="inline"
              name="password"
              label={labels.passwordNew}
              variant="password"
              autoComplete="new-password"
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onOpenChange(false)}
              >
                {labels.cancel}
              </Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? labels.passwordChecking : labels.passwordSubmit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
