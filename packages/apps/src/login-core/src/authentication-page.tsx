import type { ReactNode } from "react";
import { WorkspaceShellHeader } from "@/workspace-shell/src/workspace-shell-header";
import "@/login-core/src/login-screen.css";

export type AuthenticationPageProps = {
  title: string;
  children?: ReactNode;
};

/**
 * Shared presentational chrome for credential / gated entry surfaces
 * (login, password-protected public share). Callers own copy and form body.
 */
export function AuthenticationPage({ title, children }: AuthenticationPageProps) {
  return (
    <main className="login-screen min-h-screen">
      <section className="flex flex-col min-h-screen">
        <WorkspaceShellHeader appSwitchDisabled appSwitchSubtitle="Workspace" />

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            <h2 className="login-screen__hero text-6xl md:text-7xl leading-[0.95] tracking-tight mb-10">
              {title}
            </h2>
            {children}
          </div>
        </div>

        <footer className="login-screen__footer px-8 pb-6 flex items-center justify-between text-xs">
          <span>© {new Date().getFullYear()} WeGotWorkspace</span>
        </footer>
      </section>
    </main>
  );
}
