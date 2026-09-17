import type { ReactNode } from "react";
import { AuthenticationPage } from "@/login-core/src/authentication-page";

import "@/install-core/src/install-first-run.css";

export type InstallFirstRunFlowStep = "welcome" | "database" | "account" | "ready";
export type InstallFirstRunStep = InstallFirstRunFlowStep | "interrupt";

const STEPS_WITH_DATABASE: InstallFirstRunFlowStep[] = ["welcome", "database", "account", "ready"];
const STEPS_WITHOUT_DATABASE: InstallFirstRunFlowStep[] = ["welcome", "account", "ready"];

const DOT_LABELS: Record<InstallFirstRunFlowStep, string> = {
  welcome: "Welcome",
  database: "Database",
  account: "Your account",
  ready: "Ready",
};

export type InstallFirstRunPageProps = {
  title: ReactNode;
  step: InstallFirstRunStep;
  /** When false, env already supplied the database — omit that step from the dots. */
  includeDatabaseStep?: boolean;
  children?: ReactNode;
};

function flowSteps(includeDatabaseStep: boolean): InstallFirstRunFlowStep[] {
  return includeDatabaseStep ? STEPS_WITH_DATABASE : STEPS_WITHOUT_DATABASE;
}

function InstallFirstRunDots({
  step,
  includeDatabaseStep,
}: {
  step: InstallFirstRunFlowStep;
  includeDatabaseStep: boolean;
}) {
  const steps = flowSteps(includeDatabaseStep);
  const activeIndex = Math.max(0, steps.indexOf(step));

  return (
    <ol className="install-first-run__dots" role="list" aria-label="Setup progress">
      {steps.map((id, index) => {
        const current = index === activeIndex;
        const done = index < activeIndex;
        return (
          <li
            key={id}
            className={
              current
                ? "install-first-run__dot install-first-run__dot--current"
                : done
                  ? "install-first-run__dot install-first-run__dot--done"
                  : "install-first-run__dot"
            }
            aria-current={current ? "step" : undefined}
          >
            <span className="sr-only">
              {DOT_LABELS[id]}
              {current ? ", current" : done ? ", done" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function InstallFirstRunPage({
  title,
  step,
  includeDatabaseStep = true,
  children,
}: InstallFirstRunPageProps) {
  return (
    <div className="install-first-run">
      <AuthenticationPage
        title={title}
        beforeTitle={
          step !== "interrupt" ? (
            <InstallFirstRunDots step={step} includeDatabaseStep={includeDatabaseStep} />
          ) : undefined
        }
        hideHeader
        hideFooter
      >
        {children}
      </AuthenticationPage>
    </div>
  );
}
