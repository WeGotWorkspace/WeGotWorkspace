#!/usr/bin/env node
/**
 * Staleness report for plans and specs (#1645).
 *
 * Lists every committed spec directory under .agents/specs/, every markdown
 * file under docs/ and every legacy plan under .agents/plans/, with the date
 * of its last commit. For specs it also shows the state of the linked issue:
 * the `Source:` line of spec.md (`#N` or `owner/repo#N`), else the number the
 * directory name starts with.
 *
 * The output is a report, not a check: age alone is not an error, and the
 * script exits 0 unless it cannot run at all.
 *
 * Archive rule (.agents/specs/README.md): a spec whose linked issue is closed
 * and whose directory has no commit in the last 60 days moves to
 * .agents/specs/archive/<year of its last commit>/. `--archive` applies the
 * rule: it runs `git mv` for each candidate and rewrites the markdown links
 * and repo paths that point into a moved directory. A candidate is held back
 * and listed when a non-markdown file mentions it by name (code comments must
 * not point at a moved path) or when the plan.md of a spec that stays would
 * need a rewrite (check-plan-structure would then hold that older plan to
 * today's rules).
 *
 * Usage:
 *   node tools/report-doc-staleness.mjs [--json] [--offline] [--now=YYYY-MM-DD]
 *                                       [--repo=owner/name] [--archive]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ARCHIVE_AFTER_DAYS = 60;
export const SPECS_DIR = ".agents/specs";
export const SPECS_ARCHIVE_DIR = `${SPECS_DIR}/archive`;
export const DOCS_ARCHIVE_DIR = "docs/archive";
const DEFAULT_REPO = "WeGotWorkspace/WeGotWorkspace";
const REPORTED_ROOTS = ["docs", SPECS_DIR, ".agents/plans"];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The issue a spec links to, from the `Source:` line of spec.md or the
 * leading number of the directory name. `Source: ad-hoc` means no issue.
 *
 * @param {string} dirName
 * @param {string | null} specText
 * @param {string} defaultRepo
 * @returns {{ repo: string, number: number } | null}
 */
export function linkedIssue(dirName, specText, defaultRepo) {
  const sourceLine = specText?.split(/\r?\n/).find((line) => /^Source:/.test(line));
  if (sourceLine) {
    const match = /^Source:\s*(?:([\w.-]+\/[\w.-]+))?#(\d+)\b/.exec(sourceLine);
    if (match) return { repo: match[1] ?? defaultRepo, number: Number(match[2]) };
    return null;
  }
  const leading = /^(\d+)-/.exec(dirName);
  const number = leading ? Number(leading[1]) : 0;
  return number > 0 ? { repo: defaultRepo, number } : null;
}

/**
 * Parse `git log --format=%x00%cs --name-only` into the newest commit date
 * per file. Git prints newest commits first, so the first date seen wins.
 *
 * @param {string} output
 * @returns {Map<string, string>}
 */
export function parseLastCommitDates(output) {
  /** @type {Map<string, string>} */
  const dates = new Map();
  for (const chunk of output.split("\0")) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const [date, ...files] = lines;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const file of files) {
      if (!dates.has(file)) dates.set(file, date);
    }
  }
  return dates;
}

/**
 * Newest date among the files at or below `prefix`.
 *
 * @param {Map<string, string>} dates
 * @param {string} prefix
 * @returns {string | null}
 */
export function newestDateUnder(dates, prefix) {
  let newest = null;
  for (const [file, date] of dates) {
    if (file !== prefix && !file.startsWith(`${prefix}/`)) continue;
    if (newest == null || date > newest) newest = date;
  }
  return newest;
}

/** @param {string} from @param {string} to */
export function daysBetween(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * The spec directories and documents the report covers, from the list of
 * tracked files.
 *
 * @param {string[]} trackedFiles
 * @returns {{ specs: { path: string, name: string, archived: boolean }[], docs: { path: string, archived: boolean }[] }}
 */
export function collectEntries(trackedFiles) {
  /** @type {Map<string, { path: string, name: string, archived: boolean }>} */
  const specs = new Map();
  /** @type {{ path: string, archived: boolean }[]} */
  const docs = [];
  for (const file of trackedFiles) {
    if (file.startsWith(`${SPECS_ARCHIVE_DIR}/`)) {
      const parts = file.slice(SPECS_ARCHIVE_DIR.length + 1).split("/");
      if (parts.length < 3) continue;
      const dir = `${SPECS_ARCHIVE_DIR}/${parts[0]}/${parts[1]}`;
      specs.set(dir, { path: dir, name: parts[1], archived: true });
      continue;
    }
    if (file.startsWith(`${SPECS_DIR}/`)) {
      const parts = file.slice(SPECS_DIR.length + 1).split("/");
      if (parts.length < 2 || parts[0] === "_template") continue;
      const dir = `${SPECS_DIR}/${parts[0]}`;
      specs.set(dir, { path: dir, name: parts[0], archived: false });
      continue;
    }
    const isDoc = file.startsWith("docs/") || file.startsWith(".agents/plans/");
    if (isDoc && file.endsWith(".md")) {
      docs.push({ path: file, archived: file.startsWith(`${DOCS_ARCHIVE_DIR}/`) });
    }
  }
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { specs: [...specs.values()].sort(byPath), docs: docs.sort(byPath) };
}

/**
 * Status of one spec directory.
 *
 * `archive`: issue closed, no commit in ARCHIVE_AFTER_DAYS days (the rule).
 * `closed-recent`: issue closed, touched recently.
 * `open`: issue open. `missing`: the number does not resolve to an issue or
 * pull request. `unknown`: the state could not be fetched. `no-issue`:
 * ad-hoc spec. `archived`: already under .agents/specs/archive/.
 *
 * @param {{ archived: boolean, issue: unknown, state: string | null, ageDays: number | null }} spec
 */
export function specStatus({ archived, issue, state, ageDays }) {
  if (archived) return "archived";
  if (issue == null) return "no-issue";
  if (state == null) return "unknown";
  if (state === "MISSING") return "missing";
  if (state === "OPEN") return "open";
  if (ageDays != null && ageDays >= ARCHIVE_AFTER_DAYS) return "archive";
  return "closed-recent";
}

/** @param {{ archived: boolean, ageDays: number | null }} doc */
export function docStatus({ archived, ageDays }) {
  if (archived) return "archived";
  if (ageDays != null && ageDays >= ARCHIVE_AFTER_DAYS) return "stale";
  return "current";
}

/**
 * @param {{
 *   trackedFiles: string[],
 *   dates: Map<string, string>,
 *   specTexts: Map<string, string>,
 *   issueStates: Map<string, string>,
 *   codeReferences: Map<string, string[]>,
 *   now: string,
 *   defaultRepo: string,
 * }} input
 */
export function buildReport({ trackedFiles, dates, specTexts, issueStates, codeReferences, now, defaultRepo }) {
  const { specs, docs } = collectEntries(trackedFiles);
  const specRows = specs.map((spec) => {
    const issue = linkedIssue(spec.name, specTexts.get(spec.path) ?? null, defaultRepo);
    const lastCommit = newestDateUnder(dates, spec.path);
    const ageDays = lastCommit ? daysBetween(lastCommit, now) : null;
    const state = issue ? (issueStates.get(issueKey(issue)) ?? null) : null;
    const status = specStatus({ archived: spec.archived, issue, state, ageDays });
    const heldBy = status === "archive" ? (codeReferences.get(spec.name) ?? []) : [];
    return { ...spec, issue, lastCommit, ageDays, state, status, heldBy };
  });
  const docRows = docs.map((doc) => {
    const lastCommit = dates.get(doc.path) ?? null;
    const ageDays = lastCommit ? daysBetween(lastCommit, now) : null;
    return { ...doc, lastCommit, ageDays, status: docStatus({ archived: doc.archived, ageDays }) };
  });
  return { now, archiveAfterDays: ARCHIVE_AFTER_DAYS, specs: specRows, docs: docRows };
}

/** @param {{ repo: string, number: number }} issue */
export function issueKey(issue) {
  return `${issue.repo.toLowerCase()}#${issue.number}`;
}

/** @param {{ repo: string, number: number } | null} issue @param {string} defaultRepo */
function issueLabel(issue, defaultRepo) {
  if (!issue) return "—";
  return issue.repo.toLowerCase() === defaultRepo.toLowerCase()
    ? `#${issue.number}`
    : `${issue.repo}#${issue.number}`;
}

/**
 * Directory moves the archive rule asks for. Held candidates are skipped.
 *
 * @param {ReturnType<typeof buildReport>} report
 * @returns {{ from: string, to: string }[]}
 */
export function archiveMoves(report) {
  return report.specs
    .filter((spec) => spec.status === "archive" && spec.heldBy.length === 0 && spec.lastCommit)
    .map((spec) => ({
      from: spec.path,
      to: `${SPECS_ARCHIVE_DIR}/${spec.lastCommit.slice(0, 4)}/${spec.name}`,
    }));
}

/**
 * Live plan.md files (of specs that stay in place) that a move would
 * rewrite. Editing such a plan puts it through check-plan-structure, which
 * an older plan may not pass, so the candidate is held back instead.
 *
 * @param {{ path: string, name: string, lastCommit: string | null }[]} candidates
 * @param {Map<string, string>} livePlans repo path of plan.md → text
 * @returns {Map<string, string[]>}
 */
export function livePlanReferences(candidates, livePlans) {
  /** @type {Map<string, string[]>} */
  const references = new Map();
  for (const candidate of candidates) {
    const move = [{ from: candidate.path, to: `${SPECS_ARCHIVE_DIR}/0000/${candidate.name}` }];
    for (const [file, text] of livePlans) {
      if (candidates.some((other) => file.startsWith(`${other.path}/`))) continue;
      if (rewriteMarkdown(text, file, file, move) === text) continue;
      references.set(candidate.name, [...(references.get(candidate.name) ?? []), file]);
    }
  }
  return references;
}

/** @param {string} filePath @param {{ from: string, to: string }[]} moves */
export function movedPath(filePath, moves) {
  for (const move of moves) {
    if (filePath === move.from || filePath.startsWith(`${move.from}/`)) {
      return move.to + filePath.slice(move.from.length);
    }
  }
  return filePath;
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite one markdown file for a set of directory moves. `oldFile` and
 * `newFile` are repo-relative; they differ when the file itself moves.
 * Relative link targets are re-resolved from the new location; repo paths
 * written out in prose (`.agents/specs/<dir>/…`) follow the move.
 *
 * @param {string} text
 * @param {string} oldFile
 * @param {string} newFile
 * @param {{ from: string, to: string }[]} moves
 */
export function rewriteMarkdown(text, oldFile, newFile, moves) {
  let next = text;
  for (const move of moves) {
    const prose = new RegExp(`(^|[^\\w./-])${escapeRegExp(move.from)}(?=$|[^\\w-])`, "gm");
    next = next.replace(prose, (_match, before) => `${before}${move.to}`);
  }

  const oldDir = path.posix.dirname(oldFile);
  const newDir = path.posix.dirname(newFile);
  /** @param {string} target */
  const retarget = (target) => {
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return target;
    const cut = target.search(/[?#]/);
    const pathPart = cut === -1 ? target : target.slice(0, cut);
    const suffix = cut === -1 ? "" : target.slice(cut);
    if (pathPart === "") return target;
    const resolved = path.posix.normalize(path.posix.join(oldDir, pathPart));
    if (resolved.startsWith("../")) return target;
    const destination = movedPath(resolved, moves);
    if (path.posix.normalize(path.posix.join(newDir, pathPart)) === destination) return target;
    let relative = path.posix.relative(newDir, destination) || ".";
    if (pathPart.endsWith("/") && !relative.endsWith("/")) relative += "/";
    return relative + suffix;
  };

  next = next.replace(/(\]\()([^)\s]+)(\))/g, (_match, open, target, close) => `${open}${retarget(target)}${close}`);
  next = next.replace(/^(\[[^\]]+\]:\s*)(\S+)/gm, (_match, label, target) => `${label}${retarget(target)}`);
  return next;
}

/** @param {number | null} days */
function age(days) {
  return days == null ? "—" : `${days} d`;
}

/**
 * Markdown report, also used as the GitHub Actions job summary.
 *
 * @param {ReturnType<typeof buildReport>} report
 * @param {string} defaultRepo
 */
export function formatMarkdown(report, defaultRepo = DEFAULT_REPO) {
  const live = report.specs.filter((spec) => spec.status !== "archived");
  const count = (status) => report.specs.filter((spec) => spec.status === status).length;
  const archive = report.specs.filter((spec) => spec.status === "archive");
  const ready = archive.filter((spec) => spec.heldBy.length === 0);
  const held = archive.filter((spec) => spec.heldBy.length > 0);
  const staleDocs = report.docs.filter((doc) => doc.status === "stale");

  const out = [];
  out.push(`# Plan and spec staleness (${report.now})`, "");
  out.push(
    `Archive rule: a spec whose issue is closed and that has no commit in ${report.archiveAfterDays} days moves to \`${SPECS_ARCHIVE_DIR}/<year>/\` (\`.agents/specs/README.md\`, "Archive rule"). Run \`pnpm docs:archive-stale\` to apply it.`,
    "",
  );
  out.push("## Summary", "");
  out.push(`- Specs: ${live.length} in place, ${count("archived")} archived`);
  out.push(`- Archive now: ${ready.length}`);
  out.push(`- Archive candidates held back (code or a live plan.md mentions them): ${held.length}`);
  out.push(`- Closed issue, touched in the last ${report.archiveAfterDays} days: ${count("closed-recent")}`);
  out.push(`- Open issue: ${count("open")}`);
  out.push(`- Number does not resolve to an issue or PR: ${count("missing")}`);
  out.push(`- No linked issue (ad-hoc): ${count("no-issue")}`);
  out.push(`- Issue state unknown (not fetched): ${count("unknown")}`);
  out.push(
    `- Documents (docs/, .agents/plans/): ${report.docs.length}, of which ${staleDocs.length} have no commit in ${report.archiveAfterDays} days`,
    "",
  );

  /** @param {string} title @param {typeof report.specs} rows @param {boolean} [withHeld] */
  const specTable = (title, rows, withHeld = false) => {
    if (rows.length === 0) return;
    out.push(`## ${title}`, "");
    out.push(`| Spec | Last commit | Age | Issue | State |${withHeld ? " Mentioned in |" : ""}`);
    out.push(`|------|-------------|-----|-------|-------|${withHeld ? "--------------|" : ""}`);
    for (const spec of rows) {
      const cells = [
        `\`${spec.path}\``,
        spec.lastCommit ?? "—",
        age(spec.ageDays),
        issueLabel(spec.issue, defaultRepo),
        spec.state ? spec.state.toLowerCase() : "—",
      ];
      if (withHeld) cells.push(spec.heldBy.map((file) => `\`${file}\``).join(", "));
      out.push(`| ${cells.join(" | ")} |`);
    }
    out.push("");
  };

  specTable("Archive now", ready);
  specTable("Held back", held, true);
  specTable("Number does not resolve", report.specs.filter((spec) => spec.status === "missing"));
  specTable("Open issue", report.specs.filter((spec) => spec.status === "open"));

  if (staleDocs.length > 0) {
    out.push(`## Documents with no commit in ${report.archiveAfterDays} days`, "");
    out.push("Review by hand: refresh, or move a finished plan to `docs/archive/`.", "");
    out.push("| Document | Last commit | Age |", "|----------|-------------|-----|");
    for (const doc of staleDocs) out.push(`| \`${doc.path}\` | ${doc.lastCommit ?? "—"} | ${age(doc.ageDays)} |`);
    out.push("");
  }

  out.push("<details><summary>All specs</summary>", "");
  out.push("| Spec | Last commit | Age | Issue | State | Status |", "|------|-------------|-----|-------|-------|--------|");
  for (const spec of report.specs) {
    out.push(
      `| \`${spec.path}\` | ${spec.lastCommit ?? "—"} | ${age(spec.ageDays)} | ${issueLabel(spec.issue, defaultRepo)} | ${spec.state ? spec.state.toLowerCase() : "—"} | ${spec.status} |`,
    );
  }
  out.push("", "</details>", "");
  out.push("<details><summary>All documents</summary>", "");
  out.push("| Document | Last commit | Age | Status |", "|----------|-------------|-----|--------|");
  for (const doc of report.docs) {
    out.push(`| \`${doc.path}\` | ${doc.lastCommit ?? "—"} | ${age(doc.ageDays)} | ${doc.status} |`);
  }
  out.push("", "</details>", "");
  return out.join("\n");
}

/** @param {string[]} args @param {{ input?: string }} [options] */
function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Fetch issue or pull request states with one GraphQL query per 50 numbers.
 * A number that resolves to neither is MISSING. A failed request leaves the
 * numbers out, so their state shows as unknown.
 *
 * @param {{ repo: string, number: number }[]} issues
 * @returns {Map<string, string>}
 */
function fetchIssueStates(issues) {
  /** @type {Map<string, string>} */
  const states = new Map();
  /** @type {Map<string, Set<number>>} */
  const byRepo = new Map();
  for (const issue of issues) {
    const repo = issue.repo.toLowerCase();
    if (!byRepo.has(repo)) byRepo.set(repo, new Set());
    byRepo.get(repo).add(issue.number);
  }
  for (const [repo, numberSet] of byRepo) {
    const [owner, name] = repo.split("/");
    const numbers = [...numberSet];
    for (let start = 0; start < numbers.length; start += 50) {
      const batch = numbers.slice(start, start + 50);
      const fields = batch
        .map((n) => `n${n}: issueOrPullRequest(number: ${n}) { ... on Issue { state } ... on PullRequest { state } }`)
        .join(" ");
      const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields} } }`;
      let body;
      try {
        body = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        // GraphQL NOT_FOUND for one alias makes gh exit 1 but still print the data.
        body = typeof error?.stdout === "string" ? error.stdout : "";
      }
      let data;
      try {
        data = JSON.parse(body)?.data?.repository;
      } catch {
        data = null;
      }
      if (!data) {
        console.error(`report-doc-staleness: could not fetch issue states for ${repo}`);
        continue;
      }
      for (const n of batch) {
        const node = data[`n${n}`];
        states.set(`${repo}#${n}`, node?.state ?? "MISSING");
      }
    }
  }
  return states;
}

/**
 * Non-markdown tracked files that mention a spec directory name, outside
 * that directory. A move would leave those mentions pointing nowhere.
 *
 * @param {string[]} names
 * @returns {Map<string, string[]>}
 */
function findCodeReferences(names) {
  /** @type {Map<string, string[]>} */
  const references = new Map();
  for (const name of names) {
    let output = "";
    try {
      output = git(["grep", "-l", "-F", "-e", name, "--", ".", ":(exclude)*.md", ":(exclude)*.mdc"]);
    } catch {
      output = "";
    }
    const files = output
      .split("\n")
      .map((line) => line.trim())
      .filter((file) => file && !file.startsWith(`${SPECS_DIR}/${name}/`));
    if (files.length > 0) references.set(name, files);
  }
  return references;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const options = { json: false, offline: false, archive: false, now: null, repo: null };
  for (const arg of argv) {
    if (arg === "--") continue;
    if (arg === "--json") options.json = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--archive") options.archive = true;
    else if (arg.startsWith("--now=")) options.now = arg.slice("--now=".length);
    else if (arg.startsWith("--repo=")) options.repo = arg.slice("--repo=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (options.now != null && !/^\d{4}-\d{2}-\d{2}$/.test(options.now)) {
    throw new Error(`--now must be YYYY-MM-DD, got ${options.now}`);
  }
  return options;
}

/** @param {{ from: string, to: string }[]} moves */
function applyArchive(moves) {
  const markdown = git(["ls-files", "-z", "--", "*.md", "*.mdc"]).split("\0").filter(Boolean);
  /** @type {{ newFile: string, text: string }[]} */
  const rewrites = [];
  for (const file of markdown) {
    const text = readFileSync(path.join(repoRoot, file), "utf8");
    const newFile = movedPath(file, moves);
    const next = rewriteMarkdown(text, file, newFile, moves);
    if (next !== text) rewrites.push({ newFile, text: next });
  }
  for (const move of moves) {
    mkdirSync(path.join(repoRoot, path.posix.dirname(move.to)), { recursive: true });
    git(["mv", move.from, move.to]);
  }
  for (const rewrite of rewrites) {
    writeFileSync(path.join(repoRoot, rewrite.newFile), rewrite.text);
  }
  return rewrites.length;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const defaultRepo = options.repo ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
  const now = options.now ?? new Date().toISOString().slice(0, 10);

  const trackedFiles = git(["ls-files", "-z", "--", ...REPORTED_ROOTS]).split("\0").filter(Boolean);
  const dates = parseLastCommitDates(git(["log", "--format=%x00%cs", "--name-only", "--", ...REPORTED_ROOTS]));
  const { specs } = collectEntries(trackedFiles);

  /** @type {Map<string, string>} */
  const specTexts = new Map();
  for (const spec of specs) {
    try {
      specTexts.set(spec.path, readFileSync(path.join(repoRoot, spec.path, "spec.md"), "utf8"));
    } catch {
      // No spec.md: fall back to the directory number.
    }
  }

  const issues = specs
    .filter((spec) => !spec.archived)
    .map((spec) => linkedIssue(spec.name, specTexts.get(spec.path) ?? null, defaultRepo))
    .filter((issue) => issue != null);
  const issueStates = options.offline ? new Map() : fetchIssueStates(issues);

  const draft = buildReport({
    trackedFiles,
    dates,
    specTexts,
    issueStates,
    codeReferences: new Map(),
    now,
    defaultRepo,
  });
  const candidates = draft.specs.filter((spec) => spec.status === "archive");
  /** @type {Map<string, string>} */
  const livePlans = new Map();
  for (const file of trackedFiles) {
    if (!/^\.agents\/specs\/[^/]+\/plan\.md$/.test(file) || file.startsWith(`${SPECS_ARCHIVE_DIR}/`)) continue;
    livePlans.set(file, readFileSync(path.join(repoRoot, file), "utf8"));
  }
  const references = findCodeReferences(candidates.map((spec) => spec.name));
  for (const [name, files] of livePlanReferences(candidates, livePlans)) {
    references.set(name, [...(references.get(name) ?? []), ...files]);
  }
  const report = buildReport({
    trackedFiles,
    dates,
    specTexts,
    issueStates,
    codeReferences: references,
    now,
    defaultRepo,
  });

  if (options.archive) {
    const moves = archiveMoves(report);
    const rewritten = applyArchive(moves);
    for (const move of moves) console.log(`moved ${move.from} → ${move.to}`);
    console.log(`Archived ${moves.length} spec directories; rewrote links in ${rewritten} markdown files.`);
    return;
  }

  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : formatMarkdown(report, defaultRepo));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`report-doc-staleness: ${error instanceof Error ? (process.env.DEBUG ? error.stack : error.message) : String(error)}`);
    process.exit(1);
  }
}
