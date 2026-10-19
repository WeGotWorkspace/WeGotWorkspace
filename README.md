<br />

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/wordmark-dark.svg">
    <img src=".github/assets/wordmark-light.svg" alt="WeGotWorkspace" width="320">
  </picture>
</p>

<p align="center"><b>Your own office suite: docs, files, calendar, meet, and more, on your own server.</b></p>

<p align="center">
  <a href="https://github.com/WeGotWorkspace/wegotworkspace/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/WeGotWorkspace/wegotworkspace?label=release&color=2ea043"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/WeGotWorkspace/wegotworkspace/discussions"><img alt="Discussions" src="https://img.shields.io/github/discussions/WeGotWorkspace/wegotworkspace?color=8250df"></a>
  <a href="https://github.com/WeGotWorkspace/wegotworkspace/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/WeGotWorkspace/wegotworkspace?style=social"></a>
</p>

<p align="center">
  <a href="#-install-in-one-minute"><b>Install</b></a> •
  <a href="#-features"><b>Features</b></a> •
  <a href="docs/getting-started.md"><b>Docs</b></a> •
  <a href="https://github.com/WeGotWorkspace/wegotworkspace/discussions"><b>Discussions</b></a>
</p>

<!-- TODO: hero screenshot of the apps home screen (light mode), e.g.
<p><img src=".github/assets/screenshot-home.webp" alt="WeGotWorkspace home screen" width="100%"></p>
-->

Meet **WeGotWorkspace**, an open-source, self-hosted office platform. Your docs, notes, files, calendars, contacts, tasks, and video calls live in one place, on infrastructure you control. It is built on open protocols (WebDAV, CalDAV, CardDAV), so the apps on your phone and desktop just work with it.

> **WeGotWorkspace is in beta** and changes quickly. Found a bug or have an idea? [Open an issue](https://github.com/WeGotWorkspace/wegotworkspace/issues/new?template=bug-report.yml) or start a [Discussion](https://github.com/WeGotWorkspace/wegotworkspace/discussions). We read all of them.

## 🚀 Install in one minute

**Docker** (VPS or homelab). One command, no Node or PHP needed on the host:

```bash
curl -fsSL https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/install | sh
```

**Shared hosting** (cPanel, Plesk, any Apache/PHP host). Download the ZIP from [Releases](https://github.com/WeGotWorkspace/wegotworkspace/releases/latest), upload it, and open `/install/` in your browser.

Both paths end in the same setup wizard at `/install/`. Need more detail?

| Method | Guide |
| --- | --- |
| Docker | [docs/install-docker.md](docs/install-docker.md) |
| ZIP / shared hosting | [INSTALL.md](INSTALL.md) |
| Not sure which to pick? | [docs/getting-started.md](docs/getting-started.md) |

### Upgrading

- **Docker:** run `bash setup.sh upgrade` in your install folder.
- **ZIP:** use **Admin → Updates** in the web app.

Your settings and data are kept. See the install guides for backups and details.

## 🌟 Features

- **Docs.** Write documents together in real time. Suggest edits with track changes, then accept or reject them.
- **Notes.** Capture ideas with full Markdown support and edit them together with your team, live.
- **Files.** Upload, organize, preview, and share files. Mount them on your computer over WebDAV.
- **Calendar.** Plan your week, share calendars with others, and send and answer meeting invites. Syncs with your phone over CalDAV.
- **Meet.** Video calls in the browser with chat built in, linked straight from calendar events.
- **Contacts.** Keep your contacts in one place, synced over CardDAV.
- **Tasks.** Keep track of to-dos alongside your calendar.
- **Works offline.** The web app keeps working when the connection drops and syncs when it returns.
- **Bring your AI assistant.** Connect Claude, ChatGPT, or Mistral over MCP so they can work with your files and calendar as you. Off by default; [read how it works](docs/mcp-connect.md).

## 📸 Screenshots

<!-- TODO: add one screenshot per app, e.g.
<p><img src=".github/assets/screenshot-files.webp" alt="Files" width="100%"></p>
<p><img src=".github/assets/screenshot-calendar.webp" alt="Calendar" width="100%"></p>
<p><img src=".github/assets/screenshot-docs.webp" alt="Docs" width="100%"></p>
<p><img src=".github/assets/screenshot-meet.webp" alt="Meet" width="100%"></p>
-->

_Screenshots are coming soon._

## ⚙️ Built with

[![Laravel](https://img.shields.io/badge/Laravel-FF2D20?style=for-the-badge&logo=laravel&logoColor=white)](https://laravel.com/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![SabreDAV](https://img.shields.io/badge/SabreDAV-1f6feb?style=for-the-badge)](https://sabre.io/)

## 🛠️ Local development

```bash
pnpm install
composer --working-dir packages/api install
cp packages/api/.env.example packages/api/.env   # set APP_ENV=local and APP_DEBUG=true
pnpm dev
```

Then open **http://127.0.0.1:5173**. The API runs on port 9080, and Storybook on port 6006 (`pnpm dev:storybook`). The first run creates the database, an admin user, and JWT keys.

Edit `packages/api` and `packages/apps`, not `apps/wegotworkspace`. More in [docs/dev-layout.md](docs/dev-layout.md) and [docs/env.md](docs/env.md).

## ❤️ Community

- 💬 Ask questions and share ideas in [Discussions](https://github.com/WeGotWorkspace/wegotworkspace/discussions).
- 🐛 Report bugs with the [bug report form](https://github.com/WeGotWorkspace/wegotworkspace/issues/new?template=bug-report.yml).
- ⭐ Star the repo to follow along and help others find it.

We follow a [Code of Conduct](CODE_OF_CONDUCT.md) in all community spaces.

## 🤝 Contributing

Bug reports and Discussions are very welcome. While we land the beta, we're not accepting external code pull requests yet. See [CONTRIBUTING.md](CONTRIBUTING.md) for how we work and what's planned in [ROADMAP.md](ROADMAP.md).

<details>
<summary><b>For maintainers</b></summary>

- **Release:** a signed tag push makes CI publish the ZIP and Docker image. Locally: `pnpm release:publish patch`. See [docs/install-docker-ops.md](docs/install-docker-ops.md).
- **Security CI:** CodeQL (JS/TS), Psalm taint (PHP), Semgrep, Gitleaks, and Trivy. See [SECURITY.md](SECURITY.md) for when they run.
- **Quality gate:** run `pnpm run ci:quality` before marking a PR ready. The apps pre-push gate runs when `packages/apps/**` changes.
- **Signed commits** are required on `main`.

</details>

## 🛡️ Security

Found a vulnerability? Please report it privately instead of opening a public issue. See [SECURITY.md](SECURITY.md).

## 📄 License

Every feature is free and open source under [AGPL-3.0-or-later](LICENSE). A hosted offering and support/SLA for hosting partners are planned; see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md). WeGotWorkspace builds on open-source projects including [SabreDAV](https://sabre.io/); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
