import type { ReactNode } from "react";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import "@/login-core/src/login-screen.css";

export type AuthenticationPageProps = {
  title: ReactNode;
  eyebrow?: string;
  /** Rendered above the hero title. */
  beforeTitle?: ReactNode;
  hideHeader?: boolean;
  children?: ReactNode;
};

/**
 * Shared presentational chrome for credential / gated entry surfaces
 * (login, password-protected public share). Callers own copy and form body.
 */
export function AuthenticationPage({
  title,
  eyebrow,
  beforeTitle,
  hideHeader = false,
  children,
}: AuthenticationPageProps) {
  return (
    <main className="login-screen min-h-screen">
      <section className="flex flex-col min-h-screen">
        {hideHeader ? null : <WorkspaceShellHeader brandLockup />}

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            {eyebrow ? <p className="login-screen__eyebrow">{eyebrow}</p> : null}
            {beforeTitle}
            <h2 className="login-screen__hero text-6xl md:text-7xl leading-[0.95] tracking-tight">
              {title}
            </h2>
            {children}
          </div>
        </div>
      </section>
    </main>
  );
}
