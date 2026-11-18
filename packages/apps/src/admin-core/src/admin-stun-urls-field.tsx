import { useState } from "react";
import { Button } from "@/button/src/button";
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
import { FieldLabelRow } from "@/ui/field-label-row";
import { parseUrlList } from "@/lib/rtc/config";
import { DEFAULT_PUBLIC_STUN_URLS, DEFAULT_PUBLIC_STUN_URLS_CSV } from "@/lib/rtc/default-stun";

export type AdminStunUrlsFieldProps = {
  value: string;
  /** Typing in the fields (saved when the field is left). */
  onChange: (value: string) => void;
  /** Remove a URL: saves after the short pause, like a choice. */
  onRemove?: (value: string) => void;
  /** Restore default, confirmed: saves at once. */
  onRestore: (value: string) => void;
};

function sameUrls(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((url, index) => url === b[index]);
}

/**
 * The STUN list plus the least an admin needs to choose it on purpose: whose
 * server the default is, a warning when it is empty, and a confirmed way back
 * to the default.
 */
export function AdminStunUrlsField({
  value,
  onChange,
  onRemove,
  onRestore,
}: AdminStunUrlsFieldProps) {
  const [confirmRestore, setConfirmRestore] = useState(false);
  const urls = parseUrlList(value, "stun");
  const isDefault = sameUrls(urls, DEFAULT_PUBLIC_STUN_URLS);

  const description =
    urls.length === 0
      ? "Without one, calls may only work between people on the same network."
      : isDefault
        ? "Default: Nextcloud's public server, which can see the IP address of people in a call."
        : "Help people find a direct route to each other.";

  return (
    <>
      <FieldLabelRow
        layout="inline"
        fill
        label="STUN servers"
        description={description}
        htmlFor="admin-realtime-stun-urls-1"
      >
        <div className="admin-ice-field">
          <AdminIceUrlList
            id="admin-realtime-stun-urls"
            label="STUN servers"
            itemLabel="STUN URL"
            value={value}
            onChange={onChange}
            onRemove={onRemove}
          />
          {!isDefault ? (
            <Button
              label="Restore default"
              variant="ghost"
              severity="danger"
              size="sm"
              onClick={() => setConfirmRestore(true)}
            />
          ) : null}
        </div>
      </FieldLabelRow>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore the default STUN server?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your STUN servers with Nextcloud&apos;s public one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                onRestore(DEFAULT_PUBLIC_STUN_URLS_CSV);
                setConfirmRestore(false);
              }}
            >
              Restore default
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
