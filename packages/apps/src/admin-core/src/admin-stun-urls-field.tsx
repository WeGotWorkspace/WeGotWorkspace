import { useState } from "react";
import { Button } from "@/button/src/button";
import { Tag } from "@/tag/src/tag";
import { AdminIceUrlList } from "@/admin-core/src/admin-ice-url-list";
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
import { buttonVariants } from "@/button/src/button";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { parseUrlList } from "@/lib/rtc/config";
import { DEFAULT_PUBLIC_STUN_URLS, DEFAULT_PUBLIC_STUN_URLS_CSV } from "@/lib/rtc/default-stun";

export type AdminStunUrlsFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

function sameUrls(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((url, index) => url === b[index]);
}

/**
 * The STUN list plus the least an admin needs to choose it on purpose: whose
 * server the default is, a warning when it is empty, and a confirmed way back
 * to the default.
 */
export function AdminStunUrlsField({ value, onChange }: AdminStunUrlsFieldProps) {
  const [confirmRestore, setConfirmRestore] = useState(false);
  const urls = parseUrlList(value, "stun");
  const isDefault = sameUrls(urls, DEFAULT_PUBLIC_STUN_URLS);

  return (
    <div className="mb-6">
      <FormField htmlFor="admin-realtime-stun-urls-1" label="STUN URLs">
        <AdminIceUrlList
          id="admin-realtime-stun-urls"
          label="STUN URLs"
          itemLabel="STUN URL"
          value={value}
          onChange={onChange}
        />
      </FormField>
      {isDefault ? (
        <div className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
          <Tag label="Default" className="shrink-0" />
          <p>Provided by Nextcloud, which can see the IP address of people in a call.</p>
        </div>
      ) : null}
      {urls.length === 0 ? (
        <p className="mb-3 text-sm text-destructive">
          Without one, calls may only work between people on the same network.
        </p>
      ) : null}
      {!isDefault ? (
        <div className="mb-3 flex justify-start">
          <Button
            label="Restore default"
            variant="outline"
            severity="danger"
            onClick={() => setConfirmRestore(true)}
          />
        </div>
      ) : null}

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the default STUN server?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your STUN servers with Nextcloud&apos;s public one. Nothing changes
              until you save.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                onChange(DEFAULT_PUBLIC_STUN_URLS_CSV);
                setConfirmRestore(false);
              }}
            >
              Restore default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
