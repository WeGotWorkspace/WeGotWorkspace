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
  usernameTaken: "That username is taken. Pick another.",
  usernameInvalid: "Use 2–63 lowercase letters, numbers, - or _.",
  databaseTitle: "Your data.",
  databaseType: "Database type",
  sqlite: "SQLite",
  mysql: "MySQL / MariaDB",
  sqliteHint: "Uses the default SQLite file.",
  dataDirLabel: "Data folder",
  dataDirPublic:
    "That folder is inside the website, so anyone could download the database. Pick one outside it.",
  dataDirInsideUnavailable:
    "No writable folder outside the website was found, so this one is inside it, where anyone could download the database. A folder outside the website keeps it private.",
  dataDirInsideOwned:
    "The folder outside the website belongs to another installation, so this one is inside it, where anyone could download the database. A folder outside the website keeps it private.",
  dataDirInsideEnvironment:
    "WGW_DATA_DIR on the server points inside the website, so anyone could download the database. A folder outside the website keeps it private.",
  dataDirEnvironment: "Set on the server with WGW_DATA_DIR.",
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
