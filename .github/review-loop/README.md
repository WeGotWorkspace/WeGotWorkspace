# Review loop

Two workflows review a pull request and fix what the review finds, until the
reviewer approves. A human then reviews. Nothing is merged automatically.

- `review-loop-review.yml` runs on "ready for review", reopen, and pushes by
  the loop bot. It runs the fast JS suite, asks the agent for a verdict, and
  posts it as an approve or request-changes review. Approval adds the
  `ready-for-human` label.
- `review-loop-fix.yml` runs on change requests from the loop bot. It asks the
  agent to edit files, then commits them as one signed commit. That push
  starts the next review.

Each of the two is a thin trigger that calls its logic,
`review-loop-review-job.yml` or `review-loop-fix-job.yml`, at `@main`. GitHub
reads a PR's workflow files from the PR's test merge, which can lag behind
`main`; the logic must not, because it has to match the adapter and prompts
it reads from `main`.

The loop stops with the `needs-human` label after `REVIEW_LOOP_MAX_ROUNDS`
change requests (default 3), when a fix round changes nothing, or when it
fails. A human push drops `ready-for-human` without starting a review. To
start a new cycle, mark the PR draft and then ready again. That is the only
reset, also for a PR that was never a draft: until then, every change request
from the bot counts.

## Vendor-neutral by design

The agent is a function: it gets the checked-out code and a prompt, and
returns JSON matching a schema. It never calls GitHub. Every GitHub action
(reviews, labels, comments, commits) is plain workflow code running as the
loop's own GitHub App, so the bot identity does not change with the vendor.

| File | Vendor-specific? |
|------|------------------|
| `agent/action.yml` | Yes. The only one. |
| `review-prompt.md`, `fix-prompt.md` | No |
| `review.schema.json`, `fix.schema.json` | No |
| `prepare/action.yml`, all four workflows | No |

To switch vendor, rewrite the steps in `agent/action.yml`. Keep its inputs
(`mode`, `prompt-file`, `schema-file`, `working-directory`, `token`,
`max-turns`, `model`, `effort`) and its output (`result-file`, a JSON file that matches the
schema). Then replace the `REVIEW_LOOP_AGENT_TOKEN` secret. The adapter must
keep the modes honest: `review` reads only, `fix` may edit files and run the
fast tests, and neither may commit, push, or reach GitHub.

## Setup

1. Create a GitHub App owned by the organization, with no webhook and these
   repository permissions: Contents read and write, Pull requests read and
   write, Issues read and write. Install it on this repository only.
2. Store its client ID as the repository variable `REVIEW_LOOP_APP_CLIENT_ID`
   and a private key as the secret `REVIEW_LOOP_APP_PRIVATE_KEY`.
3. Store the agent credential as the secret `REVIEW_LOOP_AGENT_TOKEN`. For
   the current adapter (Claude Code) that is the output of
   `claude setup-token`.
4. Optional repository variables:
   - `REVIEW_LOOP_MAX_ROUNDS`: change requests per cycle (default 3).
   - `REVIEW_LOOP_REVIEW_MODEL` and `REVIEW_LOOP_FIX_MODEL`: the model for
     each role, in the vendor's own terms (for Claude Code, `opus` or
     `sonnet`). Empty uses the account's default.
   - `REVIEW_LOOP_REVIEW_EFFORT` and `REVIEW_LOOP_FIX_EFFORT`: reasoning
     effort for each role, in the vendor's own terms (for Claude Code `low`,
     `medium`, `high`, `xhigh`, or `max`). Empty uses the default.

   These are variables, not code, so a change applies to the next run, and
   a vendor switch changes them without a PR.

The workflow logic, prompts, schemas, both local actions, and the reviewer's
standards (the security checklist and the clean-code smells list) are read
from `main`, so a PR cannot change the reviewer that judges it. Changes to
them take effect once merged. A PR could still edit its own trigger file to
call something else, but that shows in the diff the reviewer and humans read. The trade-off: the reviewer does not get the domain skill for the
package a PR touches, so it knows less about local conventions. The blocking
categories do not depend on those conventions.
The fixer may not commit to `.github/`, `.agents/`, `.claude/`, `AGENTS.md`,
or `CLAUDE.md`.
