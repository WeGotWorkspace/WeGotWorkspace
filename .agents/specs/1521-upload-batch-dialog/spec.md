Source: #1521 (body-hash: 8b71f365)
Goal: WeGotWorkspace/Product#140

# Drive upload batch dialog: shared step dots, stepper dialog, notices

Second UI slice of Epic #1499, on top of the queue (#1501), the chunked client with its conflict policy (#1519), and the space pre-check (#1520). The issue is the source of truth for every acceptance criterion; this file records the choices the issue leaves open.

## Goal

When a signed-in user adds files to Drive, the batch is stored and shown as placeholders at once. If any question applies (server space, name conflicts, keep offline), one dialog asks only those, in that order, with step dots, Back / Next, and _Upload_. _Cancel_ (or Escape) drops the whole batch. Notices that come back from the upload (a _Replace_ that kept both, a conflict found at upload time) stay on screen until the user presses OK.

## Non-goals

- Other uses of the stepper outside Drive and the installer.
- A "Don't ask again" option on the keep-offline step.
- Error and pause states, sign-out and leave warnings (#1522). Folder upload (#1620).

## Affected packages

- packages/apps

## Decisions

- **Shared primitives.** `step-dots/` (`StepDots`, generic over its step ids; the caller gives the list name and each dot's text) and `stepper-dialog/` (`StepperDialog` on the existing Radix `Dialog`). The installer keeps its markup and texts; its labels move to `installerCopy`.
- **Screen readers.** Each dot reads "Step 2 of 3: Name conflicts"; the current one has `aria-current="step"`. The step heading is the dialog title, so the dialog's name follows the step, and it takes focus on open and on every step change.
- **Primary button.** Next, or _Upload_ on the last step. The space step's button says _Add anyway_ (also when it is the only step).
- **Questions are worked out before the batch shows.** `enqueueUploads` stores the batch, runs the space pre-check, then the conflict check and the keep-offline check, and only then tells the queue watchers. A batch without questions is released at once and never shows "Waiting for your answer".
- **Keep offline.** Same rule as the hand-off: a file is asked about when _Make files available offline_ is off, or when it is larger than the device limit. Direct uploads (no local copy), files that already failed (`quota`), and Docs-editable files are left out. Default answer: _Remove from this device_.
- **Name conflicts.** One answer for all names; default _Keep both_. _Replace_ is listed only when `describeUploadConflicts` offers it (version check known, no hash-pending file). The answer goes to `releaseUploadBatch` with the replace targets for _Replace_.
- **A tab closed with the dialog open.** The asking tab marks the batch on the existing upload-memory BroadcastChannel. On load, a Drive tab takes over every `awaiting_input` batch that no open tab answers for and shows its dialog again (or releases it when no question applies any more). A dialog closes when its batch is answered or cancelled in another tab.
- **Toasts.** "Added N files to uploads" and the batch tracker start when the batch is released, not when it is stored, so _Cancel_ shows no toast.
- **Notices.** A batch's notices show as a floating stack of callouts in the Drive main pane, in every tab and after a reload, each with _OK_; _OK_ calls `dismissUploadNotices` for that batch. `offline_copy_failed` shows there too.

## Edge cases

- Two tabs loading at the same moment may both take over the same left-over batch; answering in one closes the other's dialog.
- A batch added while another dialog is open waits its turn; dialogs show one at a time, oldest first.
- Free space from the last known reading (offline or the server did not answer) says when it was measured and that it may be out of date.
