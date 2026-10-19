# Contributing

Thank you for your interest in WeGotWorkspace.

## What is open today

| Kind | Status |
|------|--------|
| **Discussions (ideas / exploration)** | Open — use [Discussions](https://github.com/WeGotWorkspace/wegotworkspace/discussions) |
| **Bug reports** | Open — use the [Bug report](https://github.com/WeGotWorkspace/wegotworkspace/issues/new?template=bug-report.yml) template |
| **Already-public security findings** | Open — use the [DAST finding](https://github.com/WeGotWorkspace/wegotworkspace/issues/new?template=dast-finding.yml) template. A report that is not yet public follows [SECURITY.md](SECURITY.md), not that template. |
| **Goals / Epics / Tasks / Chores** | **Maintainers only** — non-maintainer filings are closed automatically |
| **Blank issues** | Disabled |
| **Code contributions (PRs from outside maintainers)** | Open — see [Pull requests](#pull-requests) |

Start a **Discussion** or file a **bug**. Do not open Goal, Epic, Task, or Chore issues — maintainers promote promising threads.

## Pull requests

- Small fixes (typos, docs, a clear bug) can go straight to a PR.
- For a feature or a larger change, start a [Discussion](https://github.com/WeGotWorkspace/wegotworkspace/discussions) or link a bug first, so we can agree on the approach before you write the code.
- Fill in the [pull request template](.github/pull_request_template.md). Write the PR, commits, and docs in **English**.
- Add or update tests when behavior changes. CI must pass before a maintainer reviews.
- Follow the engineering rules in [AGENTS.md](AGENTS.md) and `.agents/skills/` (they apply to humans too).

### Licensing your contribution

There is no Contributor License Agreement. By opening a pull request, you license your contribution under the project license, AGPL-3.0-or-later (inbound = outbound). You keep the copyright on your work.

Only submit work you have the right to submit. Do not copy in code under a license that is not compatible with AGPL-3.0-or-later.

## Product vs engineering

- **Goals** (`type:goal`) describe user outcomes — maintainers only. Board Status is **Identified → Adopted → Fulfilled**. Identified is a draft backlog (no milestone until Adopted). Fulfilled Goals are closed; Status stays on the [Product roadmap](https://github.com/orgs/WeGotWorkspace/projects/1). Start at the [0.9 Roadmap](https://github.com/orgs/WeGotWorkspace/projects/1/views/4). See [docs/product/](docs/product/) and [GOVERNANCE.md](GOVERNANCE.md).
- **Epics / tasks / chores** (`type:epic` / `type:task` / `type:chore`) track delivery under Goals or pure eng work — maintainers only.
- GitHub issue type: a Goal is **Feature**; an epic, task, or chore is **Task**; a bug is **Bug**. The kind label stays `type:epic` or `type:chore`. Titles do not repeat the kind with a `[Goal]`, `[Task]`, `[Epic]`, or `[Chore]` prefix.
- Templates: `goal.yml`, `epic.yml`, `task.yml`, `chore.yml`, `bug-report.yml`, `dast-finding.yml` under [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).

## Maintainers

Internal work follows [AGENTS.md](AGENTS.md), [GOVERNANCE.md](GOVERNANCE.md), and agent skills under `.agents/skills/`. Specs, plans, docs, and GitHub issues (including Goals and comments) are **English**, even when the discussion that produced them was not.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Enforcement: [legal@wegotworkspace.org](mailto:legal@wegotworkspace.org).

## License

AGPL-3.0-or-later (`LICENSE`), copyright WeGotWorkspace B.V. and contributors. There is no separate paid license; see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
