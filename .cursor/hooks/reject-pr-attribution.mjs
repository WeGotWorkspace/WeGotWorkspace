#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { containsCursorPrAttribution } from "../../tools/git/cursor-attribution.mjs";

const input = JSON.parse(readFileSync(0, "utf8"));
const command = input.command ?? "";

/** Word boundaries do not precede `--`; match `--body`, `--body=`, or `--body `. */
const BODY_FLAG_PATTERN = /--body(?:=|\s|$)/;

/** Ignore gh pr substrings inside heredocs or quoted commit/PR bodies. */
function ghPrCommandPrefix(command) {
  const heredocStart = command.search(/<<-?\s*['"]?\w*['"]?/);
  const quoteStart = command.search(/['"]/);
  const cutAt = Math.min(
    heredocStart === -1 ? command.length : heredocStart,
    quoteStart === -1 ? command.length : quoteStart,
  );
  return command.slice(0, cutAt);
}

function extractHeredocBody(command) {
  const eofHeredoc = command.match(/<<-?\s*['"]?EOF['"]?\s*\r?\n([\s\S]*?)\r?\nEOF\b/);
  if (eofHeredoc) {
    return eofHeredoc[1];
  }

  const markedHeredoc = command.match(/<<-?\s*['"]?(\w+)['"]?\s*\r?\n([\s\S]*?)\r?\n\1\b/);
  if (markedHeredoc) {
    return markedHeredoc[2];
  }

  return "";
}

function extractQuotedBody(fromBody) {
  const trimmed = fromBody.trimStart();
  const quote = trimmed[0];
  if (quote !== '"' && quote !== "'") {
    return "";
  }

  let body = "";
  let escaped = false;
  for (let i = 1; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (escaped) {
      body += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return body;
    }
    body += char;
  }
  return body;
}

function extractGhPrBody(command) {
  const bodyFlag = command.match(BODY_FLAG_PATTERN);
  if (!bodyFlag) {
    return "";
  }

  const heredocBody = extractHeredocBody(command);
  if (heredocBody) {
    return heredocBody;
  }

  const flagText = bodyFlag[0];
  const fromBody = command.slice(bodyFlag.index + flagText.length);

  if (flagText.endsWith("=")) {
    const trimmed = fromBody.trimStart();
    const quoted = extractQuotedBody(trimmed);
    if (quoted) {
      return quoted;
    }
    return trimmed.split(/\s+--/)[0] ?? trimmed;
  }

  const trimmed = fromBody.trimStart();

  if (trimmed.startsWith("<<")) {
    const inlineHeredoc = trimmed.match(/^<<-?\s*['"]?(\w*)['"]?\s*\r?\n?([\s\S]*)$/);
    if (!inlineHeredoc) {
      return trimmed;
    }
    const marker = inlineHeredoc[1];
    if (marker) {
      const end = trimmed.indexOf(`\n${marker}`);
      return end === -1 ? trimmed : trimmed.slice(inlineHeredoc[0].length, end);
    }
    return inlineHeredoc[2];
  }

  const quoted = extractQuotedBody(trimmed);
  if (quoted) {
    return quoted;
  }

  return trimmed.split(/\s+--/)[0] ?? trimmed;
}

function stripQuotedAndHeredocs(source) {
  const withoutHeredocs = source.replace(
    /<<-?\s*['"]?\w+['"]?\r?\n[\s\S]*?\r?\n\w+\b/g,
    " ",
  );
  return withoutHeredocs
    .replace(/"(?:\\.|[^"\\])*"/g, " ")
    .replace(/'(?:\\.|[^'\\])*'/g, " ");
}

const ghPrPrefix = ghPrCommandPrefix(command);
if (!/\bgh\s+pr\s+(create|edit)\b/.test(ghPrPrefix)) {
  console.log(JSON.stringify({ permission: "allow" }));
  process.exit(0);
}

if (/\bgh\s+pr\s+create\b/.test(ghPrPrefix) && !/(?:^|\s)--draft(?:\s|=|$)/.test(stripQuotedAndHeredocs(command))) {
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message: "Pull requests must be opened as drafts. Re-run gh pr create with --draft.",
      agent_message:
        "Always open pull requests as drafts. Re-run with `gh pr create --draft`. Do not mark the PR ready unless the user asks to enqueue it.",
    }),
  );
  process.exit(0);
}

const prBody = extractGhPrBody(command);
if (containsCursorPrAttribution(prBody) || containsCursorPrAttribution(command)) {
  console.log(
    JSON.stringify({
      permission: "deny",
      user_message:
        'PR description cannot include Cursor attribution (e.g. "Made with Cursor"). Remove it before creating or editing the PR.',
      agent_message:
        'Do not add "Made with Cursor", "Made-with: Cursor", or Co-authored-by Cursor lines to PR descriptions. Strip attribution from --body before running gh pr create or gh pr edit.',
    }),
  );
  process.exit(0);
}

console.log(JSON.stringify({ permission: "allow" }));
