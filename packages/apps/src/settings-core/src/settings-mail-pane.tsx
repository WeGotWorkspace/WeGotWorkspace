import { Callout } from "@/callout/src/callout";

/**
 * The settings API still stores IMAP credentials. v0.9 does not read a mailbox,
 * so the login form stays off this pane.
 */
export function SettingsMailPane() {
  return (
    <Callout
      severity="info"
      title="Mailbox login"
      message="Credentials are stored for a later release. This release does not read a mailbox."
    />
  );
}
