import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/button/src/button";
import { recordUnexpectedError } from "@/lib/diagnostics/error-diagnostics-recorder";
import "./wegotworkspace-error-boundary.css";

type State = { failed: boolean };

/**
 * Shell-level error boundary (#2204). A render error outside a route (the router
 * has its own boundary and reports through `defaultOnCatch`) lands here: it is
 * kept for Copy diagnostics and the page offers a reload instead of going blank.
 */
export class WeGotWorkspaceErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void recordUnexpectedError(error, "render");
  }

  render(): ReactNode {
    return this.state.failed ? <WeGotWorkspaceErrorFallback /> : this.props.children;
  }
}

/** What the shell shows after a crash: reload, and where to copy the error from. */
export function WeGotWorkspaceErrorFallback({
  onReload = () => window.location.reload(),
}: {
  onReload?: () => void;
}): ReactNode {
  return (
    <main className="wegotworkspace-error-boundary">
      <div className="wegotworkspace-error-boundary__body">
        <h1 className="wegotworkspace-error-boundary__title">Something went wrong</h1>
        <p className="wegotworkspace-error-boundary__text">
          Reload the page to continue. The error is kept on this device. To report it, open{" "}
          <a href="/settings/diagnostics">Settings → Diagnostics</a> and copy it into your bug
          report.
        </p>
        <Button type="button" onClick={onReload}>
          Reload
        </Button>
      </div>
    </main>
  );
}
