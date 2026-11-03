import type { StepperDialogLabels } from "@/stepper-dialog/src/stepper-dialog";

const files = (count: number) => (count === 1 ? "1 file" : `${count} files`);

/** Copy of the batch dialog (#1521) and the batch notices. */
export const driveUploadBatchLabels = {
  stepper: {
    back: "Back",
    next: "Next",
    cancel: "Cancel",
    dots: "Upload steps",
    stepOf: (number, total, dotLabel) => `Step ${number} of ${total}: ${dotLabel}`,
  } satisfies StepperDialogLabels,
  upload: "Upload",

  spaceDot: "Server space",
  spaceTitle: "Not enough space on the server",
  /** "These 12 files need 1.4 GB; the server has 800 MB free." */
  spaceNeeded: (count: number, needed: string, free: string, withQueue: boolean) =>
    `${count === 1 ? "This file needs" : `These ${count} files need`} ${needed}${
      withQueue ? ", together with the uploads already waiting" : ""
    }; the server has ${free} free.`,
  spaceTrash: "Files in the trash still take up space, so emptying the trash helps.",
  spaceStale: (when: string) =>
    `This is the free space the server reported on ${when}. It may be out of date.`,
  spaceAddAnyway: "Add anyway",

  /** Folder upload (#1620): the top-level folder's name is taken. */
  foldersDot: "Folder name",
  foldersTitle: (count: number) =>
    count === 1 ? "A folder with this name already exists" : "Some folder names already exist",
  foldersLead: (count: number) =>
    count === 1
      ? "This folder already has a folder with this name:"
      : `This folder already has folders with these ${count} names:`,
  foldersChoice: "What should happen to your folder?",
  foldersKeepBoth: "Keep both",
  foldersKeepBothDetail: (count: number, keptAs: string) =>
    count === 1
      ? `Your folder is added as ${keptAs}.`
      : `Your folders are added with a number, like ${keptAs}.`,
  foldersMerge: "Merge",
  foldersMergeDetail:
    "Your files go into the existing folder. If a file name is taken there, you choose what happens next.",

  conflictsDot: "Name conflicts",
  conflictsTitle: (count: number) =>
    count === 1 ? "A file with this name already exists" : "Some names already exist",
  conflictsLead: (count: number) =>
    count === 1
      ? "This folder already has a file with this name:"
      : `This folder already has files with these ${count} names:`,
  conflictsMore: (count: number) => `and ${files(count)} more`,
  conflictsChoice: "What should happen to them?",
  conflictReplace: "Replace",
  conflictReplaceDetail: "Your files take the place of the existing ones.",
  conflictKeepBoth: "Keep both",
  conflictKeepBothDetail: "Your files are added with a number, like report (1).pdf.",
  conflictSkip: "Skip",
  conflictSkipDetail: "These files are not uploaded. The other files still are.",

  keepOfflineDot: "Keep offline",
  keepOfflineTitle: (count: number) =>
    count === 1 ? "Keep this file on this device?" : "Keep these files on this device?",
  keepOfflineOverLimit: (count: number, limit: string) =>
    `${count === 1 ? "This file is" : `These ${count} files are`} larger than ${limit}, so ${
      count === 1 ? "it is" : "they are"
    } not kept offline on its own:`,
  keepOfflineSyncOff: (count: number) =>
    `Make files available offline is switched off on this device, so ${
      count === 1 ? "this file is" : `these ${count} files are`
    } not kept offline on ${count === 1 ? "its" : "their"} own:`,
  keepOfflineChoice: "After the upload:",
  keepOfflineRemove: "Remove from this device",
  keepOfflineRemoveDetail: "The file stays on the server. You can make it available offline later.",
  keepOfflineKeep: "Keep available offline",
  keepOfflineKeepDetail: "The file stays on this device too, so you can open it offline.",

  /** Batch notices (#1519): shown until the user has seen them. */
  noticeReplaceFellBack: (name: string, keptAs: string) =>
    `${name} was changed by someone else in the meantime. Your version was added as ${keptAs}.`,
  noticeKeptBoth: (name: string, keptAs: string) =>
    `${name} already existed when it was uploaded. Your file was added as ${keptAs}.`,
  noticeOfflineCopyFailed: (name: string) =>
    `${name} was uploaded, but this device had no room to keep it offline.`,
  noticeDismiss: "OK",
  noticesRegion: "Upload notices",
} as const;
