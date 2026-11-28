import { Button } from "@/button/src/button";

export type CollectionDialogActionsProps = {
  /**
   * Only access changed (it saves at once), so there is nothing to apply or discard:
   * show Done alone. False while name, colour or owner is edited, or on create.
   */
  doneOnly: boolean;
  doneLabel: string;
  cancelLabel: string;
  submitLabel: string;
  canSubmit: boolean;
  /** Disables Cancel while a save is running. */
  busy?: boolean;
  onClose: () => void;
};

/** Footer actions of a collection dialog that embeds a {@link CollectionShareSection}. */
export function CollectionDialogActions({
  doneOnly,
  doneLabel,
  cancelLabel,
  submitLabel,
  canSubmit,
  busy = false,
  onClose,
}: CollectionDialogActionsProps) {
  if (doneOnly) {
    return (
      <Button type="button" onClick={onClose} disabled={busy}>
        {doneLabel}
      </Button>
    );
  }
  return (
    <>
      <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
        {cancelLabel}
      </Button>
      <Button type="submit" disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </>
  );
}
