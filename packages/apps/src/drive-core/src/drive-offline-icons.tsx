import type { ComponentProps } from "react";
import { CloudAlert, CloudDownload, CloudOff, Loader2 } from "lucide-react";

/** Shared offline affordance icons — keep pin button and row menu in sync. */
export function DriveOfflineAvailableIcon(props: ComponentProps<typeof CloudDownload>) {
  return <CloudDownload aria-hidden {...props} />;
}

export function DriveOfflineRemoveIcon(props: ComponentProps<typeof CloudOff>) {
  return <CloudOff aria-hidden {...props} />;
}

export function DriveOfflinePinningIcon(props: ComponentProps<typeof Loader2>) {
  return <Loader2 aria-hidden {...props} />;
}

/** The automatic offline copy of this file failed. */
export function DriveOfflineFailedIcon(props: ComponentProps<typeof CloudAlert>) {
  return <CloudAlert aria-hidden {...props} />;
}
