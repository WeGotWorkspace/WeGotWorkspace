import { useId, useState } from "react";
import { formatBytesCompact } from "@/drive-core/src/drive-file-utils";
import { driveUploadBatchLabels as L } from "@/drive-core/src/drive-upload-batch-labels";
import type { DriveUploadBatchAnswers } from "@/drive-core/src/drive-types";
import type {
  DriveUploadBatchQuestions,
  DriveUploadKnownSpaceCheck,
} from "@/lib/offline/drive/upload/drive-upload-batch-questions";
import type { DriveUploadConflictChoice } from "@/lib/offline/drive/upload/drive-upload-schema";
import type { DriveUploadKeepOfflineQuestion } from "@/lib/offline/drive/upload/drive-upload-keep-offline";
import { StepperDialog, type StepperDialogStep } from "@/stepper-dialog/src/stepper-dialog";
import { Label } from "@/ui/label";
import { RadioGroup, RadioGroupItem } from "@/ui/radio-group";
import "@/drive-core/src/drive-upload-batch-dialog.css";

/** Names shown in a step's list before "and N more". */
const LISTED_NAMES = 5;

export type DriveUploadBatchStepId = "space" | "conflicts" | "keepOffline";

/** The steps that apply, in the fixed order: server space → name conflicts → keep offline. */
export function driveUploadBatchStepIds(
  questions: DriveUploadBatchQuestions,
): DriveUploadBatchStepId[] {
  const ids: DriveUploadBatchStepId[] = [];
  if (questions.space) ids.push("space");
  if (questions.conflicts && questions.conflicts.choices.length > 0) ids.push("conflicts");
  if (questions.keepOffline && questions.keepOffline.files.length > 0) ids.push("keepOffline");
  return ids;
}

type DraftAnswers = { conflict: DriveUploadConflictChoice; keepOffline: "remove" | "keep" };

/** The release answers for the dialog's choices; only what was asked is answered. */
export function driveUploadBatchAnswers(
  questions: DriveUploadBatchQuestions,
  draft: DraftAnswers,
): DriveUploadBatchAnswers {
  const conflicts = questions.conflicts;
  const asked = Boolean(conflicts && conflicts.choices.length > 0);
  const conflict =
    asked && conflicts!.choices.includes(draft.conflict) ? draft.conflict : undefined;
  return {
    keepOffline: questions.keepOffline ? draft.keepOffline : "remove",
    ...(conflict ? { conflict } : {}),
    ...(conflict === "replace" ? { replaceTargets: conflicts!.replaceTargets } : {}),
  };
}

function NameList({ names }: { names: readonly string[] }) {
  const shown = names.slice(0, LISTED_NAMES);
  const more = names.length - shown.length;
  return (
    <ul className="drive-upload-batch-dialog__names">
      {shown.map((name, index) => (
        <li key={`${name}-${index}`} className="drive-upload-batch-dialog__name">
          {name}
        </li>
      ))}
      {more > 0 ? (
        <li className="drive-upload-batch-dialog__more">{L.conflictsMore(more)}</li>
      ) : null}
    </ul>
  );
}

function ChoiceGroup<Value extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: Value;
  options: readonly { value: Value; label: string; detail: string }[];
  onChange: (value: Value) => void;
}) {
  const id = useId();
  return (
    <fieldset className="drive-upload-batch-dialog__choice">
      <legend className="drive-upload-batch-dialog__legend">{legend}</legend>
      <RadioGroup
        className="drive-upload-batch-dialog__options"
        value={value}
        onValueChange={(next) => onChange(next as Value)}
      >
        {options.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <div key={option.value} className="drive-upload-batch-dialog__option">
              <RadioGroupItem
                value={option.value}
                id={optionId}
                aria-describedby={`${optionId}-detail`}
              />
              <Label htmlFor={optionId} className="drive-upload-batch-dialog__option-label">
                <span className="drive-upload-batch-dialog__option-heading">{option.label}</span>
                <span
                  id={`${optionId}-detail`}
                  className="drive-upload-batch-dialog__option-detail"
                >
                  {option.detail}
                </span>
              </Label>
            </div>
          );
        })}
      </RadioGroup>
    </fieldset>
  );
}

function formatMeasuredAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function SpaceStep({ space, count }: { space: DriveUploadKnownSpaceCheck; count: number }) {
  return (
    <>
      <p>
        {L.spaceNeeded(
          count,
          formatBytesCompact(space.neededBytes),
          formatBytesCompact(Math.max(0, space.freeBytes)),
          space.queuedBytes > 0,
        )}
      </p>
      <p>{L.spaceTrash}</p>
      {space.fresh ? null : (
        <p className="drive-upload-batch-dialog__stale">
          {L.spaceStale(formatMeasuredAt(space.measuredAt))}
        </p>
      )}
    </>
  );
}

function keepOfflineLead(question: DriveUploadKeepOfflineQuestion): string {
  const count = question.files.length;
  return question.limitBytes === null
    ? L.keepOfflineSyncOff(count)
    : L.keepOfflineOverLimit(count, formatBytesCompact(question.limitBytes));
}

/** The dialog's steps for `questions`, wired to the draft answers. */
function buildSteps(
  questions: DriveUploadBatchQuestions,
  fileCount: number,
  draft: DraftAnswers,
  setDraft: (next: DraftAnswers) => void,
): StepperDialogStep[] {
  const steps: StepperDialogStep[] = [];
  for (const id of driveUploadBatchStepIds(questions)) {
    if (id === "space" && questions.space) {
      steps.push({
        id,
        title: L.spaceTitle,
        dotLabel: L.spaceDot,
        actionLabel: L.spaceAddAnyway,
        content: <SpaceStep space={questions.space} count={fileCount} />,
      });
    } else if (id === "conflicts" && questions.conflicts) {
      const { conflicts, choices } = questions.conflicts;
      const all = {
        replace: {
          value: "replace" as const,
          label: L.conflictReplace,
          detail: L.conflictReplaceDetail,
        },
        keep_both: {
          value: "keep_both" as const,
          label: L.conflictKeepBoth,
          detail: L.conflictKeepBothDetail,
        },
        skip: { value: "skip" as const, label: L.conflictSkip, detail: L.conflictSkipDetail },
      };
      steps.push({
        id,
        title: L.conflictsTitle(conflicts.length),
        dotLabel: L.conflictsDot,
        content: (
          <>
            <p>{L.conflictsLead(conflicts.length)}</p>
            <NameList names={conflicts.map((conflict) => conflict.name)} />
            <ChoiceGroup
              legend={L.conflictsChoice}
              value={choices.includes(draft.conflict) ? draft.conflict : "keep_both"}
              options={choices.map((choice) => all[choice])}
              onChange={(conflict) => setDraft({ ...draft, conflict })}
            />
          </>
        ),
      });
    } else if (id === "keepOffline" && questions.keepOffline) {
      const question = questions.keepOffline;
      steps.push({
        id,
        title: L.keepOfflineTitle(question.files.length),
        dotLabel: L.keepOfflineDot,
        content: (
          <>
            <p>{keepOfflineLead(question)}</p>
            <NameList names={question.files.map((file) => file.name)} />
            <ChoiceGroup
              legend={L.keepOfflineChoice}
              value={draft.keepOffline}
              options={[
                { value: "remove", label: L.keepOfflineRemove, detail: L.keepOfflineRemoveDetail },
                { value: "keep", label: L.keepOfflineKeep, detail: L.keepOfflineKeepDetail },
              ]}
              onChange={(keepOffline) => setDraft({ ...draft, keepOffline })}
            />
          </>
        ),
      });
    }
  }
  return steps;
}

export type DriveUploadBatchRequest = {
  batchId: string;
  /** Files in the batch ("These 12 files need …"); the toasts track them once released. */
  itemIds: readonly string[];
  questions: DriveUploadBatchQuestions;
};

export type DriveUploadBatchDialogProps = {
  request: DriveUploadBatchRequest | null;
  onCancel: (batchId: string) => void;
  onUpload: (batchId: string, answers: DriveUploadBatchAnswers) => void;
  dialogSurfaceClassName?: string;
};

const DEFAULT_DRAFT: DraftAnswers = { conflict: "keep_both", keepOffline: "remove" };

/**
 * The batch dialog: only the steps that apply, one answer for all files per
 * step. *Cancel* (or Escape) drops the whole batch; *Upload* releases it.
 */
export function DriveUploadBatchDialog({
  request,
  onCancel,
  onUpload,
  dialogSurfaceClassName = "drive-dialog-surface",
}: DriveUploadBatchDialogProps) {
  const [draft, setDraft] = useState<DraftAnswers>(DEFAULT_DRAFT);
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const batchId = request?.batchId ?? null;
  if (batchId !== draftFor) {
    setDraftFor(batchId);
    setDraft(DEFAULT_DRAFT);
  }
  const steps = request
    ? buildSteps(request.questions, request.itemIds.length, draft, setDraft)
    : [];
  return (
    <StepperDialog
      key={batchId ?? "none"}
      open={Boolean(request) && steps.length > 0}
      steps={steps}
      labels={L.stepper}
      finishLabel={L.upload}
      className={`${dialogSurfaceClassName} drive-upload-batch-dialog`}
      onCancel={() => request && onCancel(request.batchId)}
      onFinish={() =>
        request && onUpload(request.batchId, driveUploadBatchAnswers(request.questions, draft))
      }
    />
  );
}
