import { cn } from "@/lib/utils";
import "@/step-dots/src/step-dots.css";

export type StepDotStatus = "done" | "current" | "upcoming";

/** Where one dot sits in the flow, for its screen reader text. */
export type StepDotPosition = {
  /** 1-based. */
  number: number;
  total: number;
  status: StepDotStatus;
};

export type StepDotsProps<Step extends string> = {
  /** The steps in order; one dot each. */
  steps: readonly Step[];
  current: Step;
  /** Accessible name of the list, e.g. "Setup progress". */
  label: string;
  /** Screen reader text of one dot, e.g. "Step 2 of 3: Name conflicts, current". */
  describeStep: (step: Step, position: StepDotPosition) => string;
  className?: string;
};

/**
 * A row of dots for a flow of steps: done and current dots are filled, the
 * rest are muted. The dots are decorative; each carries its text for screen
 * readers, and the current one has `aria-current="step"`.
 */
export function StepDots<Step extends string>({
  steps,
  current,
  label,
  describeStep,
  className,
}: StepDotsProps<Step>) {
  const activeIndex = Math.max(0, steps.indexOf(current));
  return (
    <ol className={cn("step-dots", className)} role="list" aria-label={label}>
      {steps.map((step, index) => {
        const status: StepDotStatus =
          index === activeIndex ? "current" : index < activeIndex ? "done" : "upcoming";
        return (
          <li
            key={step}
            className={cn("step-dots__dot", `step-dots__dot--${status}`)}
            aria-current={status === "current" ? "step" : undefined}
          >
            <span className="sr-only">
              {describeStep(step, { number: index + 1, total: steps.length, status })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
