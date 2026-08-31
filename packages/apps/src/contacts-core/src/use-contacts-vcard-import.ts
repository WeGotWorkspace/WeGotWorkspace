import { createElement, useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { ContactCard, ContactsAPIOperations } from "@/contacts-core/src/contacts-types";
import type { ContactsUILabels } from "@/contacts-core/src/contacts-labels";
import {
  importErrorMessageFromUnknown,
  importVcfFilesBatch,
  partitionVcfFiles,
  summarizeVcfImportErrors,
  type VcardImportProgress,
} from "@/contacts-core/src/contacts-vcard-import";

export type UseContactsVcardImportOptions = {
  operations?: ContactsAPIOperations;
  labels: Pick<
    ContactsUILabels,
    | "importInvalidFile"
    | "importRequiresApi"
    | "toastImported"
    | "importFilesSkipped"
    | "importFailed"
  >;
  onImported?: (cards: ContactCard[]) => void;
  /** Override POST batch cap (tests). Default stays under the 32M PHP limit. */
  maxBatchBytes?: number;
};

export type ContactsVcardImportState = {
  importFiles: File[] | null;
  importDialogOpen: boolean;
  importDialogBusy: boolean;
  importDialogError: string | null;
  importDialogProgress: VcardImportProgress | null;
  beginImport: (fileList: FileList | null) => void;
  closeImportDialog: () => void;
  submitImportDialog: (files: File[], addressBookId: string) => void;
};

export function useContactsVcardImport({
  operations,
  labels: L,
  onImported,
  maxBatchBytes,
}: UseContactsVcardImportOptions): ContactsVcardImportState {
  const { show, showError } = useAppToast();
  const [importFiles, setImportFiles] = useState<File[] | null>(null);
  const [importSkippedCount, setImportSkippedCount] = useState(0);
  const [importDialogBusy, setImportDialogBusy] = useState(false);
  const [importDialogError, setImportDialogError] = useState<string | null>(null);
  const [importDialogProgress, setImportDialogProgress] = useState<VcardImportProgress | null>(
    null,
  );

  const importDialogOpen = importFiles !== null && importFiles.length > 0;

  const beginImport = useCallback(
    (fileList: FileList | null) => {
      const { vcfFiles, skippedCount } = partitionVcfFiles(fileList);
      if (vcfFiles.length === 0) {
        showError(L.importInvalidFile);
        return;
      }
      if (!operations?.importVcards) {
        showError(L.importRequiresApi);
        return;
      }
      setImportDialogError(null);
      setImportDialogProgress(null);
      setImportSkippedCount(skippedCount);
      setImportFiles(vcfFiles);
    },
    [L.importInvalidFile, L.importRequiresApi, operations?.importVcards, showError],
  );

  const closeImportDialog = useCallback(() => {
    if (importDialogBusy) return;
    setImportFiles(null);
    setImportSkippedCount(0);
    setImportDialogError(null);
    setImportDialogProgress(null);
  }, [importDialogBusy]);

  const submitImportDialog = useCallback(
    (files: File[], addressBookId: string) => {
      if (!operations?.importVcards) {
        showError(L.importRequiresApi);
        return;
      }
      if (!addressBookId) {
        showError(L.importFailed);
        return;
      }

      setImportDialogBusy(true);
      setImportDialogError(null);
      setImportDialogProgress(null);
      void (async () => {
        try {
          const result = await importVcfFilesBatch(
            files,
            (vcardText) => operations.importVcards!(vcardText, { addressBookId }),
            { maxBatchBytes, onProgress: setImportDialogProgress },
          );

          if (result.list.length > 0) {
            onImported?.(result.list);
            show(L.toastImported(result.list.length), {
              icon: createElement(Upload, { className: "size-4" }),
            });
            setImportFiles(null);
            setImportSkippedCount(0);
            setImportDialogProgress(null);
          }
          const failureSummary = summarizeVcfImportErrors(
            result.fileErrors,
            result.blockErrorMessages,
            L.importFailed,
          );
          if (importSkippedCount > 0) {
            showError(L.importFilesSkipped(importSkippedCount));
          }
          if (result.fileErrors.length > 0 || result.blockErrors > 0) {
            showError(failureSummary);
          }
          if (result.list.length === 0) {
            setImportDialogError(failureSummary);
          }
        } catch (error) {
          const reason = importErrorMessageFromUnknown(error, L.importFailed);
          setImportDialogError(reason);
          showError(reason);
        } finally {
          setImportDialogBusy(false);
        }
      })();
    },
    [L, importSkippedCount, maxBatchBytes, onImported, operations, show, showError],
  );

  return {
    importFiles,
    importDialogOpen,
    importDialogBusy,
    importDialogError,
    importDialogProgress,
    beginImport,
    closeImportDialog,
    submitImportDialog,
  };
}
