import type { ReactNode } from "react";
import { AuthenticationPage } from "@/login-core/src/authentication-page";

import "@/installer-core/src/installer.css";

export type InstallerFlowStep = "welcome" | "database" | "account" | "ready";
export type InstallerStep = InstallerFlowStep | "interrupt";

const STEPS_WITH_DATABASE: InstallerFlowStep[] = ["welcome", "database", "account", "ready"];
const STEPS_WITHOUT_DATABASE: InstallerFlowStep[] = ["welcome", "account", "ready"];

const DOT_LABELS: Record<InstallerFlowStep, string> = {
  welcome: "Welcome",
  database: "Database",
  account: "Your account",
  ready: "Ready",
};

export type InstallerLayoutProps = {
  title: ReactNode;
  step: InstallerStep;
  /** When false, env already supplied the database — omit that step from the dots. */
  includeDatabaseStep?: boolean;
  children?: ReactNode;
};

function flowSteps(includeDatabaseStep: boolean): InstallerFlowStep[] {
  return includeDatabaseStep ? STEPS_WITH_DATABASE : STEPS_WITHOUT_DATABASE;
}

function InstallerStepDots({
  step,
  includeDatabaseStep,
}: {
  step: InstallerFlowStep;
  includeDatabaseStep: boolean;
}) {
  const steps = flowSteps(includeDatabaseStep);
  const activeIndex = Math.max(0, steps.indexOf(step));

  return (
    <ol className="installer__dots" role="list" aria-label="Setup progress">
      {steps.map((id, index) => {
        const current = index === activeIndex;
        const done = index < activeIndex;
        return (
          <li
            key={id}
            className={
              current
                ? "installer__dot installer__dot--current"
                : done
                  ? "installer__dot installer__dot--done"
                  : "installer__dot"
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

export function InstallerLayout({
  title,
  step,
  includeDatabaseStep = true,
  children,
}: InstallerLayoutProps) {
  return (
    <div className="installer">
      <AuthenticationPage
        title={title}
        beforeTitle={
          step !== "interrupt" ? (
            <InstallerStepDots step={step} includeDatabaseStep={includeDatabaseStep} />
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
