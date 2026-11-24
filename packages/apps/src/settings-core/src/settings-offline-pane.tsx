import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw } from "lucide-react";
import { Button } from "@/button/src/button";
import { Switch } from "@/ui/switch";
import { useTrackAutosave } from "@/ui/autosave-status";
import { FieldLabelRow } from "@/ui/field-label-row";
import { CollectionGhostSelectTrigger } from "@/ui/collection-ghost-select";
import { Select, SelectContent, SelectItem, SelectValue } from "@/ui/select";
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
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";
import { useAppToast } from "@/hooks/use-app-toast";
import { formatBytesCompact } from "@/lib/files/file-name-utils";
import { resolveOfflineUsername } from "@/lib/offline/core/offline-account";
import {
  mbToOfflineFileSizeBytes,
  maxOfflineFileSizeMb,
  readOfflineDeviceContentSettings,
  writeOfflineDeviceContentSettings,
} from "@/lib/offline/core/offline-device-settings";
import { clearAutoOfflineCopies } from "@/lib/offline/drive/drive-offline-cache-clear";
import { DRIVE_DOMAIN } from "@/lib/offline/drive/drive-schema";
import { SettingsPaneCard } from "@/settings-core/src/settings-pane-card";

/** Steps for the max file size; a value saved before (a free number) is kept as its own option. */
const MAX_FILE_SIZE_STEPS_MB = [1, 2, 4, 8, 16, 32, 64, 100];

const CLEAR_CACHE_EXPLAINER =
  "Removes the file contents saved automatically on this device. Files you made available offline yourself, and changes not sent yet, stay.";

function maxFileSizeOptions(current: number): number[] {
  if (MAX_FILE_SIZE_STEPS_MB.includes(current)) return MAX_FILE_SIZE_STEPS_MB;
  return [...MAX_FILE_SIZE_STEPS_MB, current].sort((a, b) => a - b);
}

/** Bytes this app keeps on the device, or null when the browser cannot say (no secure context). */
async function estimateDeviceUsageBytes(): Promise<number | null> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") {
    return null;
  }
  try {
    const { usage } = await navigator.storage.estimate();
    return typeof usage === "number" && Number.isFinite(usage) ? usage : null;
  } catch {
    return null;
  }
}

export function SettingsOfflinePane() {
  const [contentSyncEnabled, setContentSyncEnabled] = useState(true);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(8);
  const [usageBytes, setUsageBytes] = useState<number | null>(null);
  /** The account whose offline cache is on this device; null when there is none (or after logout). */
  const [username, setUsername] = useState<string | null>(null);
  const [turnOffOpen, setTurnOffOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { confirmDialog, requestConfirm } = useConfirmDialog();
  const { show, showError } = useAppToast();
  const trackSave = useTrackAutosave();

  const refreshUsage = useCallback(async () => {
    setUsageBytes(await estimateDeviceUsageBytes());
  }, []);

  useEffect(() => {
    const settings = readOfflineDeviceContentSettings();
    setContentSyncEnabled(settings.contentSyncEnabled);
    setMaxFileSizeMb(maxOfflineFileSizeMb(settings));
    setUsername(resolveOfflineUsername(DRIVE_DOMAIN, undefined));
    let cancelled = false;
    void estimateDeviceUsageBytes().then((bytes) => {
      if (!cancelled) setUsageBytes(bytes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = (next: { contentSyncEnabled?: boolean; maxFileSizeMb?: number }) => {
    const enabled = next.contentSyncEnabled ?? contentSyncEnabled;
    const mb = next.maxFileSizeMb ?? maxFileSizeMb;
    setContentSyncEnabled(enabled);
    setMaxFileSizeMb(mb);
    void trackSave(() =>
      writeOfflineDeviceContentSettings({
        contentSyncEnabled: enabled,
        maxFileSizeBytes: mbToOfflineFileSizeBytes(mb),
      }),
    );
  };

  const clearCache = async () => {
    if (!username) return;
    setClearing(true);
    try {
      const { removedPaths } = await clearAutoOfflineCopies(username);
      show(
        removedPaths.length === 0
          ? "No saved files to clear"
          : removedPaths.length === 1
            ? "Cleared 1 offline file"
            : `Cleared ${removedPaths.length} offline files`,
      );
      await refreshUsage();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      setClearing(false);
    }
  };

  const requestClearCache = () =>
    requestConfirm({
      title: "Clear cache?",
      description: CLEAR_CACHE_EXPLAINER,
      confirmLabel: "Clear cache",
      cancelLabel: "Cancel",
      variant: "destructive",
      onConfirm: () => void clearCache(),
    });

  const turnOff = () => {
    persist({ contentSyncEnabled: false });
    setTurnOffOpen(false);
  };

  return (
    <>
      <SettingsPaneCard title="Content sync" icon={<RefreshCw aria-hidden />}>
        <FieldLabelRow
          layout="inline"
          label="Offline file contents"
          description="Automatically save file contents on this device. File and folder names always sync."
          htmlFor="offline-content-sync"
        >
          <Switch
            id="offline-content-sync"
            checked={contentSyncEnabled}
            onCheckedChange={(checked) => {
              // Turning on needs no question; turning off asks what to do with the saved files.
              if (checked) persist({ contentSyncEnabled: true });
              else setTurnOffOpen(true);
            }}
          />
        </FieldLabelRow>
        {contentSyncEnabled ? (
          <FieldLabelRow
            layout="inline"
            label="Maximum file size"
            description="Larger files are not saved automatically. You can still make them available offline one by one in Drive."
          >
            <Select
              value={String(maxFileSizeMb)}
              onValueChange={(value) => {
                const mb = Number.parseInt(value, 10);
                if (!Number.isNaN(mb)) persist({ maxFileSizeMb: mb });
              }}
            >
              <CollectionGhostSelectTrigger
                aria-label="Maximum file size"
                label={<SelectValue />}
              />
              <SelectContent align="end">
                {maxFileSizeOptions(maxFileSizeMb).map((mb) => (
                  <SelectItem key={mb} value={String(mb)}>
                    {mb} MB
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabelRow>
        ) : null}
      </SettingsPaneCard>
      {username ? (
        <SettingsPaneCard title="Storage" icon={<HardDrive aria-hidden />}>
          <FieldLabelRow
            layout="inline"
            label="Offline storage"
            description={
              usageBytes === null
                ? "Files saved on this device for offline use."
                : `${formatBytesCompact(usageBytes)} in use on this device`
            }
          >
            <Button variant="outline" size="sm" disabled={clearing} onClick={requestClearCache}>
              Clear cache
            </Button>
          </FieldLabelRow>
        </SettingsPaneCard>
      ) : null}
      {confirmDialog}
      <AlertDialog open={turnOffOpen} onOpenChange={setTurnOffOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off offline file contents?</AlertDialogTitle>
            <AlertDialogDescription>
              New files are no longer saved on this device. Files saved so far stay until you clear
              the cache.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild onClick={turnOff}>
              <Button variant="primary">Turn off</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
