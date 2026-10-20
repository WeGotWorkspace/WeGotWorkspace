#!/usr/bin/env bash
# Build release artifacts and/or publish a signed tag (CI builds the GitHub Release).
#
#   pnpm release                          # build + package (loads repo-root .env)
#   pnpm release:publish patch            # bump apps/wegotworkspace/VERSION, tag, push → CI
#   pnpm release:publish 1.2.3 --yes      # explicit version, no prompt
#   pnpm release:publish 1.3.0-beta.1     # prerelease → beta channel only
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="$ROOT/apps/wegotworkspace/VERSION"
BUILD_SCRIPT="$ROOT/tools/build-wegotworkspace-release.mjs"

usage() {
  cat <<'EOF'
usage:
  tools/release-wegotworkspace.sh package [--skip-build]
  tools/release-wegotworkspace.sh publish <patch|minor|major|X.Y.Z|X.Y.Z-beta.N|X.Y.Z-rc.N> [--yes] [--no-push] [--verify] [--no-sync-main]

package   Run pnpm build (unless --skip-build), then write dist/releases/* using
          WGW_RELEASE_SIGNING_PRIVATE_KEY from the environment (repo-root .env via pnpm).

publish   Bump apps/wegotworkspace/VERSION (SSOT on main), commit on main, create a signed
          annotated tag vX.Y.Z on that commit, and push main + tag. GitHub Actions reads
          the version from the tag when building release assets.
          X.Y.Z-beta.N and X.Y.Z-rc.N tags are GitHub prereleases: they reach
          the beta update channel only, never stable. After a prerelease,
          "patch" releases its X.Y.Z.

options:
  --yes           Skip confirmation prompts (publish only).
  --no-push       Create the tag locally but do not push (publish only).
  --verify        Run package build before tagging (publish only).
  --no-sync-main  Skip the VERSION bump commit and main push (tag-only publish; not recommended).
  --skip-build    Skip pnpm build (package, or publish --verify).
EOF
  exit 1
}

require_clean_tree() {
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    echo "error: working tree is not clean. Commit or stash changes first." >&2
    exit 1
  fi
}

read_version_from_file() {
  [[ -f "$VERSION_FILE" ]] || { echo "error: missing $VERSION_FILE" >&2; exit 1; }
  tr -d '[:space:]' < "$VERSION_FILE" | sed 's/^v//'
}

read_latest_tag_version() {
  local tag
  # versionsort.suffix=- sorts v1.0.0-beta.1 below v1.0.0.
  tag="$(git -C "$ROOT" -c versionsort.suffix=- tag -l 'v*' --sort=-v:refname 2>/dev/null | head -1 || true)"
  [[ -n "$tag" ]] || return 0
  echo "${tag#v}"
}

read_version() {
  read_version_from_file
}

assert_version_matches_latest_tag() {
  local from_file from_tag
  from_file="$(read_version_from_file)"
  from_tag="$(read_latest_tag_version)"
  [[ -n "$from_tag" ]] || return 0
  if [[ "$from_file" != "$from_tag" ]]; then
    cat >&2 <<EOF
error: apps/wegotworkspace/VERSION (${from_file}) must match the latest release tag (v${from_tag}).

Update VERSION to ${from_tag} before publishing the next release, e.g.:
  printf '%s\\n' '${from_tag}' > apps/wegotworkspace/VERSION
  git add apps/wegotworkspace/VERSION
  git commit -m "chore(release): v${from_tag}"
EOF
    exit 1
  fi
}

require_main_branch() {
  local branch
  branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    echo "error: release:publish must run on main (current: ${branch})." >&2
    echo "       Checkout main, pull latest, then publish." >&2
    exit 1
  fi
}

sync_main_branch() {
  echo "→ git pull --ff-only origin main"
  git -C "$ROOT" pull --ff-only origin main
}

write_version() {
  printf '%s\n' "$1" >"$VERSION_FILE"
}

bump_version() {
  local bump="$1" current="$2"
  node -e '
const bump = process.argv[1];
const current = process.argv[2].replace(/^v/, "");
const explicit = /^\d+\.\d+\.\d+(-(beta|rc)\.\d+)?$/;
if (explicit.test(bump)) {
  console.log(bump);
  process.exit(0);
}
const [core, pre] = current.split("-");
const parts = core.split(".").map((n) => Number(n));
if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
  console.error("error: VERSION must be semver (X.Y.Z or X.Y.Z-beta.N)");
  process.exit(1);
}
let [major, minor, patch] = parts;
switch (bump) {
  case "patch":
    // After 1.3.0-beta.2, "patch" releases 1.3.0 itself.
    if (pre === undefined) patch += 1;
    break;
  case "minor":
    minor += 1;
    patch = 0;
    break;
  case "major":
    major += 1;
    minor = 0;
    patch = 0;
    break;
  default:
    console.error("error: bump must be patch, minor, major, X.Y.Z, X.Y.Z-beta.N, or X.Y.Z-rc.N");
    process.exit(1);
}
console.log(`${major}.${minor}.${patch}`);
' "$bump" "$current"
}

run_build() {
  echo "→ pnpm build"
  (cd "$ROOT" && pnpm run build)
}

run_package() {
  echo "→ node tools/build-wegotworkspace-release.mjs"
  (cd "$ROOT" && node "$BUILD_SCRIPT")
}

ensure_signing_key() {
  if [[ -z "${WGW_RELEASE_SIGNING_PRIVATE_KEY:-}" ]]; then
    echo "warning: WGW_RELEASE_SIGNING_PRIVATE_KEY is not set; manifest.sig will be omitted." >&2
    echo "         Add it to repo-root .env (see .env.example) for signed artifacts." >&2
  fi
}

# Git -c args for signed tags (set by resolve_git_tag_signing).
GIT_TAG_SIGN_ARGS=()

expand_home() {
  local path="$1"
  if [[ "$path" == "~/"* ]]; then
    printf '%s/%s' "$HOME" "${path:2}"
  elif [[ "$path" == "~" ]]; then
    printf '%s' "$HOME"
  else
    printf '%s' "$path"
  fi
}

resolve_git_tag_signing() {
  GIT_TAG_SIGN_ARGS=()

  local from_env="${WGW_GIT_SIGNING_PUBLIC_KEY:-}"
  if [[ -n "$from_env" ]]; then
    from_env="$(expand_home "$from_env")"
    if [[ ! -f "$from_env" ]]; then
      echo "error: WGW_GIT_SIGNING_PUBLIC_KEY is set but not a file: ${from_env}" >&2
      exit 1
    fi
    GIT_TAG_SIGN_ARGS=(-c gpg.format=ssh -c "user.signingkey=${from_env}")
    return 0
  fi

  local from_git
  from_git="$(git -C "$ROOT" config --get user.signingkey 2>/dev/null || true)"
  if [[ -n "$from_git" ]]; then
    local format="gpg"
    format="$(git -C "$ROOT" config --get gpg.format 2>/dev/null || echo gpg)"
    GIT_TAG_SIGN_ARGS=(-c "gpg.format=${format}" -c "user.signingkey=${from_git}")
    return 0
  fi

  cat >&2 <<'EOF'
error: Git tag signing is not configured (CI requires signed annotated tags).

Release ZIP signing and Git tag signing use different keys:
  • WGW_RELEASE_SIGNING_PRIVATE_KEY — RSA PEM for manifest.sig (release artifacts)
  • WGW_GIT_SIGNING_PUBLIC_KEY       — SSH public key for git tag -s

Option A — add to repo-root .env (loaded by pnpm release:publish):
  WGW_GIT_SIGNING_PUBLIC_KEY=$HOME/.ssh/id_ed25519.pub

Option B — configure git globally (SSH):
  git config --global gpg.format ssh
  git config --global user.signingkey ~/.ssh/id_ed25519.pub

Option B — GPG:
  git config --global user.signingkey <key-id>
EOF
  exit 1
}

git_tag_sign() {
  git -C "$ROOT" "${GIT_TAG_SIGN_ARGS[@]}" "$@"
}

cmd_package() {
  local skip_build=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-build) skip_build=1 ;;
      *) usage ;;
    esac
    shift
  done
  [[ $# -eq 0 ]] || usage

  ensure_signing_key
  if [[ "$skip_build" -eq 0 ]]; then
    run_build
  fi
  run_package
}

cmd_publish() {
  local bump="" yes=0 no_push=0 verify=0 skip_build=0 sync_main=1
  [[ $# -gt 0 ]] || usage
  bump="$1"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes) yes=1 ;;
      --no-push) no_push=1 ;;
      --verify) verify=1 ;;
      --no-sync-main) sync_main=0 ;;
      --skip-build) skip_build=1 ;;
      *) usage ;;
    esac
    shift
  done
  [[ $# -eq 0 ]] || usage

  require_clean_tree
  require_main_branch
  sync_main_branch
  assert_version_matches_latest_tag
  resolve_git_tag_signing

  local current new tag
  current="$(read_version)"
  new="$(bump_version "$bump" "$current")"
  tag="v${new}"

  if git -C "$ROOT" rev-parse "$tag" >/dev/null 2>&1; then
    echo "error: tag ${tag} already exists" >&2
    exit 1
  fi

  if [[ "$current" == "$new" && "$bump" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(beta|rc)\.[0-9]+)?$ ]]; then
    echo "error: latest version is already ${new}" >&2
    exit 1
  fi

  echo "Release: ${current} → ${new} (${tag}) on $(git -C "$ROOT" rev-parse --short HEAD)"
  if [[ "$yes" -eq 0 ]]; then
    read -r -p "Continue? [y/N] " reply
    case "$reply" in
      [yY]|[yY][eE][sS]) ;;
      *) echo "Aborted."; exit 0 ;;
    esac
  fi

  export WGW_RELEASE_VERSION="$new"

  if [[ "$verify" -eq 1 ]]; then
    ensure_signing_key
    if [[ "$skip_build" -eq 0 ]]; then
      run_build
    fi
    run_package
  fi

  if [[ "$sync_main" -eq 1 ]]; then
    write_version "$new"
    git -C "$ROOT" add "$VERSION_FILE"
    git -C "$ROOT" commit -m "chore(release): ${tag}"
  fi

  git_tag_sign tag -s "$tag" -m "Release ${tag}"

  echo "→ Created signed tag ${tag}"
  if [[ "$no_push" -eq 1 ]]; then
    echo "Skipped push (--no-push). When ready:"
    if [[ "$sync_main" -eq 1 ]]; then
      echo "  git push origin main && git push origin ${tag}"
    else
      echo "  git push origin ${tag}"
    fi
    exit 0
  fi

  if [[ "$sync_main" -eq 1 ]]; then
    echo "→ git push origin main"
    git -C "$ROOT" push origin main
  fi
  echo "→ git push origin ${tag}"
  git -C "$ROOT" push origin "$tag"
  echo "Done. GitHub Actions will build and publish release assets for ${tag}."
  if [[ "$sync_main" -eq 0 ]]; then
    echo "Warning: apps/wegotworkspace/VERSION on main is unchanged (--no-sync-main)."
    echo "         Prefer the default publish flow so VERSION stays aligned with release tags."
  fi
}

[[ $# -gt 0 ]] || usage
command="$1"
shift

case "$command" in
  package) cmd_package "$@" ;;
  publish) cmd_publish "$@" ;;
  -h | --help | help) usage ;;
  *) usage ;;
esac
