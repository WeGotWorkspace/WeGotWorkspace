import type { ReactNode } from "react";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { installerCopy } from "@/installer-core/src/installer-copy";
import { StepDots } from "@/step-dots/src/step-dots";

import "@/installer-core/src/installer.css";

export type InstallerFlowStep = "welcome" | "database" | "account" | "ready";
export type InstallerStep = InstallerFlowStep | "interrupt";

const STEPS_WITH_DATABASE: InstallerFlowStep[] = ["welcome", "database", "account", "ready"];
const STEPS_WITHOUT_DATABASE: InstallerFlowStep[] = ["welcome", "account", "ready"];

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
  return (
    <StepDots
      className="installer__dots"
      steps={flowSteps(includeDatabaseStep)}
      current={step}
      label={installerCopy.setupProgress}
      describeStep={(id, { status }) =>
        `${installerCopy.stepLabels[id]}${
          status === "current"
            ? installerCopy.stepCurrent
            : status === "done"
              ? installerCopy.stepDone
              : ""
        }`
      }
    />
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
      >
        {children}
      </AuthenticationPage>
    </div>
  );
}
