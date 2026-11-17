import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LABEL = "nl.wegotworkspace.team-sim";
/** The scheduled night is cut off after this many minutes. */
export const CAP_MINUTES = 75;
export const START_HOUR = 1;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const plistPath = (home = homedir()) =>
  join(home, "Library", "LaunchAgents", `${LABEL}.plist`);

/** The launchd agent: `sim night --scheduled` at 01:00 under nice, output to one log file. */
export function buildPlist({
  node,
  simBin,
  logFile,
  path = process.env.PATH,
  home = process.env.HOME,
}) {
  const args = [
    "/usr/bin/nice",
    "-n",
    "10",
    node,
    simBin,
    "night",
    "--scheduled",
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join("\n")}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${START_HOUR}</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${esc(path)}</string>
    <key>HOME</key>
    <string>${esc(home)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${esc(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(logFile)}</string>
</dict>
</plist>
`;
}

/** The one line the maintainer runs once so the Mac wakes shortly before the night. */
export const PMSET_LINE = `sudo pmset repeat wakeorpoweron MTWRFSU 00:55:00`;

/** Writes the plist and loads it. `run(cmd, args)` runs a command; with dryRun nothing is written. */
export function install({
  node,
  simBin,
  paths,
  home = homedir(),
  uid = process.getuid?.(),
  dryRun = false,
  run,
  log = console.log,
}) {
  const file = plistPath(home);
  const plist = buildPlist({
    node,
    simBin,
    logFile: join(paths.home, "schedule.log"),
    home,
  });
  if (dryRun) {
    log(`would write ${file}:\n${plist}`);
  } else {
    mkdirSync(paths.home, { recursive: true });
    mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(file, plist);
    run("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { allowFail: true });
    run("launchctl", ["bootstrap", `gui/${uid}`, file]);
    log(
      `installed ${file}: a night runs at 0${START_HOUR}:00 (cut off after ${CAP_MINUTES} min), log ${join(paths.home, "schedule.log")}`,
    );
  }
  log(`Wake the Mac for it, once:\n  ${PMSET_LINE}`);
  return { file, plist };
}

export function uninstall({
  home = homedir(),
  uid = process.getuid?.(),
  run,
  log = console.log,
}) {
  const file = plistPath(home);
  if (!existsSync(file)) {
    log("no schedule installed");
    return { removed: false };
  }
  run("launchctl", ["bootout", `gui/${uid}/${LABEL}`], { allowFail: true });
  unlinkSync(file);
  log(`removed ${file}. Optional: sudo pmset repeat cancel`);
  return { removed: true };
}
