import { useState } from "react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
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
import { buttonVariants } from "@/ui/button";
import { TIMEZONES } from "@/admin-core/src/admin-workspace-utils";
import { FeatureRow } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminWebdavPaneProps = {
  controller: AdminControllerState;
};

type DavFeatureKey = "sabreUi" | "contacts" | "calendars";

const DAV_CONFIRM: Record<
  DavFeatureKey,
  { title: string; description: string; confirmLabel: string }
> = {
  sabreUi: {
    title: "Turn off Files (WebDAV)?",
    description:
      "Clients will lose access to files over WebDAV until you turn this back on and save changes.",
    confirmLabel: "Turn off Files",
  },
  contacts: {
    title: "Turn off CardDAV?",
    description:
      "Address book sync over CardDAV will stop for all users until you re-enable this and save.",
    confirmLabel: "Turn off Contacts",
  },
  calendars: {
    title: "Turn off CalDAV?",
    description:
      "Calendar and task sync over CalDAV will stop until you re-enable this and save changes.",
    confirmLabel: "Turn off Calendars",
  },
};

export function AdminWebdavPane({ controller }: AdminWebdavPaneProps) {
  const [davOffConfirm, setDavOffConfirm] = useState<DavFeatureKey | null>(null);

  const requestDavToggle = (key: DavFeatureKey, next: boolean) => {
    if (!next && controller.settingsForm[key]) {
      setDavOffConfirm(key);
      return;
    }
    controller.setSettingsForm((prev) => ({ ...prev, [key]: next }));
  };

  const confirmCopy = davOffConfirm ? DAV_CONFIRM[davOffConfirm] : null;

  return (
    <>
      <Card title="Server defaults">
        <FormField label="Default timezone">
          <Select
            value={controller.settingsForm.timezone}
            onValueChange={(value) =>
              controller.setSettingsForm((prev) => ({ ...prev, timezone: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {TIMEZONES.map((timezone) => (
                <SelectItem key={timezone} value={timezone}>
                  {timezone}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Auth realm">
          <Input
            value={controller.settingsForm.authRealm}
            onChange={(event) =>
              controller.setSettingsForm((prev) => ({
                ...prev,
                authRealm: event.currentTarget.value,
              }))
            }
          />
        </FormField>
        <FormField label="Base URI">
          <Input
            value={controller.settingsForm.baseUri}
            onChange={(event) =>
              controller.setSettingsForm((prev) => ({
                ...prev,
                baseUri: event.currentTarget.value,
              }))
            }
          />
        </FormField>
      </Card>

      <Card title="DAV features">
        <FeatureRow
          label="Files"
          desc="Expose user files via WebDAV."
          value={controller.settingsForm.sabreUi}
          onChange={(next) => requestDavToggle("sabreUi", next)}
        />
        <FeatureRow
          label="Contacts"
          desc="Enable CardDAV for address books."
          value={controller.settingsForm.contacts}
          onChange={(next) => requestDavToggle("contacts", next)}
        />
        <FeatureRow
          label="Calendars"
          desc="Enable CalDAV for calendars and tasks."
          value={controller.settingsForm.calendars}
          onChange={(next) => requestDavToggle("calendars", next)}
        />
      </Card>
      <div className="flex justify-end">
        <Button
          label="Save changes"
          variant="primary"
          onClick={() => void controller.actions.saveSettings()}
        />
      </div>

      <AlertDialog
        open={davOffConfirm !== null}
        onOpenChange={(open) => !open && setDavOffConfirm(null)}
      >
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmCopy?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmCopy?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (!davOffConfirm) return;
                controller.setSettingsForm((prev) => ({ ...prev, [davOffConfirm]: false }));
                setDavOffConfirm(null);
              }}
            >
              {confirmCopy?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
