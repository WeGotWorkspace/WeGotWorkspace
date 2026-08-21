# WeGotWorkspace

WeGotWorkspace is a self-hosted office platform — files, mail, calendars, contacts, tasks, meet, and more — built on open protocols (WebDAV, CalDAV, CardDAV). It is evolving toward a full autonomous office suite you can run on your own infrastructure. The product builds on open-source projects including SabreDAV.

## Install

Both paths run the same runtime and `/install/` wizard. ZIP upload suits shared hosting; Docker needs no Node or pnpm on the host.

| | **ZIP** (shared Apache/PHP hosting) | **Docker** (VPS / homelab) |
|---|---|---|
| **Guide** | [INSTALL.md](INSTALL.md) | [docs/install-docker.md](docs/install-docker.md) |
| **Start** | Download release ZIP from [GitHub Releases](https://github.com/WeGotWorkspace/wegotworkspace/releases) | `curl -fsSL https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/install \| sh` |

## Upgrade

| | **ZIP** | **Docker** |
|---|---|---|
| **How** | **Admin → Updates** (or SFTP file replace) | `bash setup.sh upgrade` in install dir |
| **Guide** | [INSTALL.md](INSTALL.md) | [docs/install-docker.md](docs/install-docker.md) |

On Docker installs, **Admin → Updates** is read-only — use `setup.sh upgrade` (or `curl ... | sh -s -- --upgrade`). Legacy install config auto-migrates into `packages/api/.env` on upgrade (backup kept).

## Develop

**Once:**

```bash
pnpm install
composer --working-dir packages/api install
cp packages/api/.env.example packages/api/.env
pnpm dev
```

- **http://127.0.0.1:5173** — app (Vite HMR)
- **http://127.0.0.1:6006** — Storybook
- **http://127.0.0.1:9080** — API

Edit **`packages/api`** and **`packages/apps`** — not `apps/wegotworkspace` during normal dev. First run bootstraps **`packages/api/.env`**, SQLite, admin user, and JWT keys.

Details: [docs/dev-layout.md](docs/dev-layout.md), [docs/env.md](docs/env.md). Docker/WebDAV dev: [docker/README.md](docker/README.md).

## Also

- [Getting started](docs/getting-started.md) — path picker
- [Plugins](docs/plugins.md) — separate from core deploy
- [License](LICENSE) / [Commercial](COMMERCIAL-LICENSE.md)

### Contributing

**Bug reports** and **[Discussions](https://github.com/WeGotWorkspace/wegotworkspace/discussions)** are welcome. External code PRs are closed while we land the beta. Goals stay maintainer-filed. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Maintainers

- **Release:** Signed tag push → CI publishes ZIP + Docker image; local `pnpm release:publish patch` — see [docs/install-docker-ops.md](docs/install-docker-ops.md).
- **Security CI:** CodeQL, Semgrep, Gitleaks, and Trivy on PRs — [`.github/workflows/security.yml`](.github/workflows/security.yml).
- **Quality gate:** `pnpm run ci:quality` before merge-ready PRs; apps pre-push gate when `packages/apps/**` changes.
- **Signed commits** required on `main`.
