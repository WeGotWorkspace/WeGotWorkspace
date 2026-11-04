import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { cn } from "@/lib/utils";
import { StepDots } from "@/step-dots/src/step-dots";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import "@/stepper-dialog/src/stepper-dialog.css";

export type StepperDialogStep = {
  id: string;
  /** Heading of the step; also the dialog's accessible name while it shows. */
  title: string;
  /** Short name for the step dot, e.g. "Name conflicts". */
  dotLabel: string;
  content: ReactNode;
  /** Label of the primary button on this step, instead of Next (or the final action). */
  actionLabel?: string;
};

export type StepperDialogLabels = {
  back: string;
  next: string;
  cancel: string;
  /** Accessible name of the dots, e.g. "Upload steps". */
  dots: string;
  /** Screen reader text of a dot, e.g. "Step 2 of 3: Name conflicts". */
  stepOf: (number: number, total: number, dotLabel: string) => string;
};

export type StepperDialogProps = {
  open: boolean;
  steps: readonly StepperDialogStep[];
  labels: StepperDialogLabels;
  /** The primary button on the last step, e.g. "Upload". */
  finishLabel: string;
  /** Cancel, Escape, the close button, or a click outside. */
  onCancel: () => void;
  onFinish: () => void;
  /** Portaled dialog theme class (repeats app accent tokens outside the workspace root). */
  className?: string;
};

/**
 * A dialog that walks through a few steps with Back / Next and a final
 * action. Dots show where the user is (hidden with a single step); focus
 * moves to each step's heading. Escape and Cancel end the whole flow.
 */
export function StepperDialog({
  open,
  steps,
  labels,
  finishLabel,
  onCancel,
  onFinish,
  className,
}: StepperDialogProps) {
  const [index, setIndex] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setIndex(0);
  }

  const current = Math.min(index, Math.max(0, steps.length - 1));
  const step = steps[current];
  const last = current === steps.length - 1;

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, current]);

  if (!step) return null;

  const advance = () => {
    if (last) onFinish();
    else setIndex(current + 1);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        className={cn("stepper-dialog", className)}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
      >
        <DialogHeader>
          {steps.length > 1 ? (
            <StepDots
              className="stepper-dialog__dots"
              steps={steps.map((s) => s.id)}
              current={step.id}
              label={labels.dots}
              describeStep={(id, { number, total }) =>
                labels.stepOf(number, total, steps.find((s) => s.id === id)?.dotLabel ?? id)
              }
            />
          ) : null}
          <DialogTitle ref={headingRef} tabIndex={-1} className="stepper-dialog__title">
            {step.title}
          </DialogTitle>
        </DialogHeader>
        <div className="stepper-dialog__step" key={step.id}>
          {step.content}
        </div>
        <DialogFooter className="stepper-dialog__footer">
          <Button variant="outline" onClick={onCancel}>
            {labels.cancel}
          </Button>
          {current > 0 ? (
            <Button variant="outline" onClick={() => setIndex(current - 1)}>
              {labels.back}
            </Button>
          ) : null}
          <Button variant="primary" onClick={advance}>
            {step.actionLabel ?? (last ? finishLabel : labels.next)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
