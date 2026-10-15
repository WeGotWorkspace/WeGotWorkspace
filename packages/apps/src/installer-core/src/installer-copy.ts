/** Single user-facing label while Account → createWorkspace runs (siteNext + install + optional DB persist). */
export const INSTALLER_PROGRESS_STEPS = ["Creating your workspace"] as const;

export const installerCopy = {
  welcomeTitle: "Your work. Your space.",
  welcomeLead: "An open source workspace, truly yours.",
  getStarted: "Get started",
  accountTitle: "Your account.",
  username: "Username",
  email: "Email",
  emailHint: "Used if you forget your password.",
  emailInvalid: "Enter a valid email address.",
  password: "Password",
  passwordHint: "At least 10 characters.",
  siteAddress: "Site address",
  siteAddressHint: "Public address of this install. Confirm it before continuing.",
  siteAddressInvalid: "Use http or https, with a host and no extra path.",
  usernameTaken: "That username is taken. Pick another.",
  usernameInvalid: "Use 2–63 lowercase letters, numbers, - or _.",
  databaseTitle: "Your database.",
  databaseType: "Type",
  sqlite: "SQLite",
  mysql: "MySQL / MariaDB",
  sqliteHint: "Uses the default SQLite file.",
  dataDirLabel: "Data folder",
  dataDirOutside:
    "This folder sits outside the published website, so the web server cannot serve the database or keys.",
  dataDirEnvironment: "Using the data folder set on the server.",
  dataDirFallbackOwned:
    "Another installation already uses the folder outside this website. This install keeps its data inside the website folder until you choose a different absolute path.",
  dataDirFallbackUnavailable:
    "No writable folder outside the published website was available. This install keeps its data inside the website folder until you choose a different absolute path.",
  dataDirOverride: "Different folder",
  dataDirOverrideHint: "Absolute path. Leave empty to use the folder above.",
  mysqlHost: "Host",
  mysqlPort: "Port",
  mysqlDatabase: "Database",
  mysqlUser: "User",
  mysqlPassword: "Password",
  continueSetup: "Continue",
  createWorkspace: "Create workspace",
  readyTitle: "You got workspace",
  readyLead: "Your workspace is ready.",
  openWorkspace: "Open workspace",
  serverTitle: "Needs attention.",
  serverLead: "This server is not ready yet. Fix the items below, then re-run the checks.",
  rerunChecks: "Re-run checks",
  rerunChecksBusy: "Checking...",
} as const;

export function dataDirReasonText(reason: string | undefined): string {
  switch (reason) {
    case "environment":
      return installerCopy.dataDirEnvironment;
    case "fallback_owned":
      return installerCopy.dataDirFallbackOwned;
    case "fallback_unavailable":
      return installerCopy.dataDirFallbackUnavailable;
    default:
      return installerCopy.dataDirOutside;
  }
}
