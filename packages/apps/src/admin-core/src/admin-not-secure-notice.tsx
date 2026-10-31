import { Callout } from "@/callout/src/callout";
import { adminCopy } from "@/admin-core/src/admin-copy";
import { isPageSecureContext } from "@/lib/secure-context";

/** Stays up for as long as Admin is open on a page that is not https or localhost. */
export function AdminNotSecureNotice({
  secureContext = isPageSecureContext(),
}: {
  /** Whether the page is https or localhost; defaults to the browser's answer. */
  secureContext?: boolean;
}) {
  if (secureContext) {
    return null;
  }

  return (
    <div className="admin-security-warnings">
      <Callout
        severity="warning"
        title={adminCopy.notSecureTitle}
        message={adminCopy.notSecureMessage}
      />
    </div>
  );
}
