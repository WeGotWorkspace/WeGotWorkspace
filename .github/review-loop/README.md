# Review loop

Two workflows review a pull request and fix what the review finds, until the
reviewers approve. A human then reviews. Nothing is merged automatically.

- `review-loop-review.yml` runs on "ready for review", reopen, and pushes by
  the loop bot. It runs the fast JS suite, asks the agent (and an optional
  second reviewer) for a verdict, and posts one approve or request-changes
  review. Approval adds the `ready-for-human` label.
- `review-loop-fix.yml` runs on change requests from the loop bot. It asks the
  agent to edit files, then commits them as one signed commit. That push
  starts the next review.

Reviewers are sometimes wrong, for example about a library API that does not
exist. So the fixer treats each blocking item as a claim: it checks it
against the code and the installed dependencies (`node_modules/`, and
`packages/api/vendor/`, which its job installs for reading) before acting. A
wrong item is rejected with what was checked, in the commit message or, when
nothing changed, the hand-over comment. The next review sees both, on a
runner with the same dependencies installed, and must answer that evidence
rather than repeat the item.

Each of the two is a thin trigger that calls its logic,
`review-loop-review-job.yml` or `review-loop-fix-job.yml`, at `@main`. GitHub
reads a PR's workflow files from the PR's test merge, which can lag behind
`main`; the logic must not, because it has to match the adapters and prompts
it reads from `main`.

The loop stops with the `needs-human` label after `REVIEW_LOOP_MAX_ROUNDS`
change requests (default 3), when a fix round changes nothing, or when it
fails. A human push drops `ready-for-human` without starting a review. To
start a new cycle, mark the PR draft and then ready again. That is the only
reset, also for a PR that was never a draft: until then, every change request
from the bot counts.

## Polish round

Non-blocking notes on an approved PR tend to stay unread. So when a reviewer
approves, it may also list polish: small mechanical changes that need no
judgement and cannot change behaviour (move a declaration, fix a typo, drop
an unused import). Taste and anything a test could notice stay notes.

- An approval with polish goes out without `ready-for-human`, with the items
  listed and a marker. The fixer applies exactly those items, and its push
  starts one more review, which checks them.
- Once per cycle, outside the round cap. Polish from a later approval in the
  same cycle is listed as notes, and the PR goes to a human.
- If the polish round changes nothing or fails, the approval stands: the PR
  gets `ready-for-human` and a comment saying so. If the branch moved in the
  meantime, the approval no longer applies and the PR gets no label.
- Only the loop sets the polish marker; it is stripped from every string
  the reviewers write, so quoting an earlier review cannot start another
  round.
- With two reviewers, polish only counts when both approve. If one requests
  changes, the other's polish is not posted; the next approval lists it
  again.
- A PR whose own fix trigger predates the polish round (its test merge lags
  `main`) gets its polish as notes, with a hint to update the branch.

The fix trigger fires on any bot review and leaves the decision (fix round,
polish round, or nothing) to the job on `main`.

## Second reviewer

With `REVIEW_LOOP_SECOND_AGENT_TOKEN` set, a second reviewer from another
vendor reviews in parallel with the first. Different model families miss
different things. It only reviews; the fixer stays the first agent.

- Both reviewers get the same prompt and context. The loop posts one review:
  a change request from either one is a change request, and each finding
  says which reviewer raised it. The fixer and the round count see one
  review per round, as before.
- The second reviewer runs on its own runner with no GitHub credentials. The
  posting job trusts only its JSON, checked against the review schema.
- If it fails or answers out of format, the loop posts the first reviewer's
  verdict alone and says so. It never fails a review on its own.
- Two reviewers find more, so expect `needs-human` a little more often.

## Vendor-neutral by design

An agent is a function: it gets the checked-out code and a prompt, and
returns JSON matching a schema. It never calls GitHub. Every GitHub action
(reviews, labels, comments, commits) is plain workflow code running as the
loop's own GitHub App, so the bot identity does not change with the vendor.

| File | Vendor-specific? |
|------|------------------|
| `agent/action.yml` | Yes: the first agent (now Claude Code) |
| `second-agent/action.yml` | Yes: the second reviewer (now Cursor CLI) |
| `review-prompt.md`, `fix-prompt.md` | No |
| `review.schema.json`, `fix.schema.json` | No |
| `prepare/action.yml`, all four workflows | No |

To switch vendor, rewrite the steps of one adapter and replace its secret.
`agent/action.yml` keeps its inputs (`mode`, `prompt-file`, `schema-file`,
`working-directory`, `token`, `max-turns`, `model`, `effort`);
`second-agent/action.yml` keeps the same minus `mode` and `max-turns`. Both
output `result-file`, a JSON file that matches the schema. The first adapter
must keep the modes honest: `review` reads only, `fix` may edit files and run
the fast tests, and neither may commit, push, or reach GitHub.

## Setup

1. Create a GitHub App owned by the organization, with no webhook and these
   repository permissions: Contents read and write, Pull requests read and
   write, Issues read and write. Install it on this repository only.
2. Store its client ID as the repository variable `REVIEW_LOOP_APP_CLIENT_ID`
   and a private key as the secret `REVIEW_LOOP_APP_PRIVATE_KEY`.
3. Store the agent credential as the secret `REVIEW_LOOP_AGENT_TOKEN`. For
   the current adapter (Claude Code) that is the output of
   `claude setup-token`.
4. Optional: store a second reviewer's credential as the secret
   `REVIEW_LOOP_SECOND_AGENT_TOKEN`. For the current adapter (Cursor CLI)
   that is a user API key from the Cursor dashboard.
5. Optional repository variables:
   - `REVIEW_LOOP_MAX_ROUNDS`: change requests per cycle (default 3).
   - `REVIEW_LOOP_REVIEW_MODEL`, `REVIEW_LOOP_FIX_MODEL`, and
     `REVIEW_LOOP_SECOND_REVIEW_MODEL`: the model for each role, in the
     vendor's own terms (Claude Code: `opus` or `sonnet`; Cursor: a name
     from the list its run log prints, such as `grok-4.7-high`). Empty uses
     the account's default.
   - `REVIEW_LOOP_REVIEW_EFFORT`, `REVIEW_LOOP_FIX_EFFORT`, and
     `REVIEW_LOOP_SECOND_REVIEW_EFFORT`: reasoning effort for each role, in
     the vendor's own terms (Claude Code: `low`, `medium`, `high`, `xhigh`,
     or `max`). Empty uses the default. Cursor mostly puts effort in the
     model name (`grok-4.7-high`), so leave its effort empty; a set value is
     passed as `model[effort=...]`, which only parameterized models accept.

   These are variables, not code, so a change applies to the next run, and
   a vendor switch changes them without a PR.

The workflow logic, prompts, schemas, local actions, and the reviewers'
standards (the security checklist and the clean-code smells list) are read
from `main`, so a PR cannot change the reviewer that judges it. Changes to
them take effect once merged. A PR could still edit its own trigger file to
call something else, but that shows in the diff the reviewers and humans
read. The trade-off: the reviewers do not get the domain skill for the
package a PR touches, so they know less about local conventions. The
blocking categories do not depend on those conventions.

The fixer may not commit to `.github/`, `.agents/`, `.claude/`, `AGENTS.md`,
or `CLAUDE.md`.
