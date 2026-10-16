#!/bin/sh
# WeGotWorkspace Docker install lifecycle — install, start, stop, upgrade, backup.
# Published as both `install` (curl|sh default) and `setup.sh` on GitHub Releases.
set -eu

WGW_GITHUB_REPO="${WGW_GITHUB_REPO:-WeGotWorkspace/wegotworkspace}"
WGW_RELEASE_BASE="https://github.com/${WGW_GITHUB_REPO}/releases"
WGW_MANIFEST_URL="${WGW_MANIFEST_URL:-https://github.com/WeGotWorkspace/wegotworkspace/releases/latest/download/manifest.json}"
WGW_INSTALL_DIR="${WGW_INSTALL_DIR:-./wegotworkspace}"
WGW_VERSION="${WGW_VERSION:-latest}"
WGW_HTTP_PORT="${WGW_HTTP_PORT:-}"
WGW_SQLITE=0
WGW_FORCE=0
WGW_UPGRADE=0
WGW_UPGRADE_VERSION=""
WGW_YES=0
WGW_DRY_RUN=0
WGW_LOCAL=0
WGW_PLATFORM_ENSURED=0

COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"
SETUP_SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)

usage() {
  cat <<'EOF'
WeGotWorkspace Docker install helper.

Usage:
  curl -fsSL .../install | sh                          Install and start (default)
  curl -fsSL .../install | sh -s -- [options] [cmd]
  bash setup.sh [options] [command]

Commands (default: install):
  install          Create wegotworkspace/, download assets, pull, up -d, wait for health
  start            docker compose up -d (after stop)
  stop             docker compose down
  restart          docker compose restart
  status           Show install dir, image tag, health, compose profile
  check            Compare installed tag to latest release (manifest.json)
  upgrade [ver]    Backup, update image tag, pull, up -d, health check
  backup           Archive volumes (+ MySQL dump when mysql profile)
  logs             docker compose logs -f
  help             Show this message

Options:
  --sqlite         SQLite-only stack (no MariaDB)
  --version VER    Pin release / image tag (default: latest)
  --upgrade [VER]  Upgrade existing install (same as: upgrade [VER]; omit VER for latest)
  --yes            Skip upgrade confirmation prompt
  --dry-run        Show upgrade target without pulling or recreating
  --local          Use docker/install assets from this repo (contributor pre-release testing)
  --force          Overwrite existing wegotworkspace/ on install
  -h, --help       Show this message

Environment:
  WGW_INSTALL_DIR  Install directory (default: ./wegotworkspace)
  WGW_HTTP_PORT    Host HTTP port (default: 8080)
  WGW_VERSION      Release tag when not passed via --version

Examples:
  curl -fsSL .../install | sh
  WGW_HTTP_PORT=9090 curl -fsSL .../install | sh
  curl -fsSL .../install | sh -s -- --sqlite
  bash tools/setup-docker-install.sh --local --version 0.0.0-dev
  curl -fsSL .../install | sh -s -- --version 1.2.0
  curl -fsSL .../install | sh -s -- --upgrade 1.2.0
  curl -fsSL .../install | sh -s -- --upgrade --yes
  cd wegotworkspace && bash setup.sh check
  cd wegotworkspace && bash setup.sh upgrade
  cd wegotworkspace && bash setup.sh upgrade 1.2.0
EOF
}

log() {
  printf '[wegotworkspace] %s\n' "$*"
}

die() {
  printf '[wegotworkspace] Error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

check_docker() {
  need_cmd docker
  if ! docker info >/dev/null 2>&1; then
    die "Docker is not running. Start Docker Engine and try again."
  fi
  if ! docker compose version >/dev/null 2>&1; then
    die "Docker Compose v2 is required (docker compose). Install Docker Desktop or the compose plugin."
  fi
}

docker_host_arch() {
  case "$(uname -m)" in
    arm64 | aarch64) printf '%s' arm64 ;;
    x86_64 | amd64) printf '%s' amd64 ;;
    *) printf '%s' "$(uname -m)" ;;
  esac
}

image_ref() {
  load_env
  if [ -n "${WGW_IMAGE:-}" ]; then
    printf '%s' "$WGW_IMAGE"
    return
  fi
  printf 'ghcr.io/wegotworkspace/wegotworkspace:%s' "$WGW_VERSION"
}

image_supports_host_arch() {
  image=$1
  arch=$(docker_host_arch)
  manifest=$(docker manifest inspect "$image" 2>/dev/null) || return 1
  printf '%s' "$manifest" | grep -q "\"architecture\": \"${arch}\""
}

ensure_docker_platform() {
  if [ "$WGW_PLATFORM_ENSURED" -eq 1 ]; then
    return 0
  fi
  WGW_PLATFORM_ENSURED=1

  arch=$(docker_host_arch)
  case "$arch" in
    arm64) ;;
    *) return 0 ;;
  esac

  image=$(image_ref)
  if image_supports_host_arch "$image"; then
    return 0
  fi

  export DOCKER_DEFAULT_PLATFORM=linux/amd64
  log "Apple Silicon: ${image} has no linux/arm64 build yet; using amd64 emulation (DOCKER_DEFAULT_PLATFORM=linux/amd64)."
  log "Enable Rosetta for x86_64/amd64 emulation in Docker Desktop if pulls fail."
}

pull_images() {
  ensure_docker_platform
  log "Pulling images..."
  if compose pull; then
    return 0
  fi
  die "Image pull failed. Run: cd ${WGW_INSTALL_DIR} && sh setup.sh logs"
}

resolve_install_dir() {
  parent=$(dirname "$WGW_INSTALL_DIR")
  base=$(basename "$WGW_INSTALL_DIR")
  if parent=$(cd "$parent" 2>/dev/null && pwd); then
    WGW_INSTALL_DIR="${parent}/${base}"
  fi
}

install_dir_from_cwd() {
  if [ -f "./${COMPOSE_FILE}" ] && [ -f "./${ENV_FILE}" ]; then
    WGW_INSTALL_DIR=$(pwd)
  fi
}

download_url() {
  asset=$1
  if [ "$WGW_VERSION" = "latest" ]; then
    printf '%s/latest/download/%s' "$WGW_RELEASE_BASE" "$asset"
  else
    printf '%s/download/v%s/%s' "$WGW_RELEASE_BASE" "$WGW_VERSION" "$asset"
  fi
}

fetch_asset() {
  asset=$1
  dest=$2
  if [ "$WGW_LOCAL" -eq 1 ]; then
    local_src="${SETUP_SCRIPT_DIR}/../docker/install/${asset}"
    if [ ! -f "$local_src" ]; then
      die "Local asset not found: ${local_src} (run from repo checkout with --local)"
    fi
    cp "$local_src" "$dest"
    log "Copied ${asset} from ${local_src}"
    return 0
  fi
  url=$(download_url "$asset")
  log "Downloading ${asset} from ${url}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$dest" "$url"
  else
    die "curl or wget is required to download release assets."
  fi
}

fetch_env_example() {
  dest=$1
  if [ "$WGW_LOCAL" -eq 1 ]; then
    local_src="${SETUP_SCRIPT_DIR}/../docker/install/.env.example"
    if [ ! -f "$local_src" ]; then
      die "Local env example not found: ${local_src}"
    fi
    cp "$local_src" "$dest"
    log "Copied .env.example from ${local_src}"
    return 0
  fi
  for asset in env.example default.env.example .env.example; do
    url=$(download_url "$asset")
    log "Trying ${asset} from ${url}"
    if command -v curl >/dev/null 2>&1; then
      if curl -fsSL "$url" -o "$dest"; then
        log "Downloaded ${asset}"
        return 0
      fi
    elif command -v wget >/dev/null 2>&1; then
      if wget -qO "$dest" "$url" 2>/dev/null; then
        log "Downloaded ${asset}"
        return 0
      fi
    else
      die "curl or wget is required to download release assets."
    fi
  done
  die "Could not download env example (tried env.example, default.env.example, .env.example)."
}

normalize_semver() {
  printf '%s' "$1" | sed 's/^v//'
}

fetch_manifest() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$WGW_MANIFEST_URL"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$WGW_MANIFEST_URL"
  else
    die "curl or wget is required to fetch release manifest."
  fi
}

parse_manifest_version() {
  manifest=$1
  version=$(printf '%s' "$manifest" | grep '"version"' | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
  if [ -z "$version" ]; then
    die "Could not parse version from manifest.json"
  fi
  normalize_semver "$version"
}

resolve_latest_version() {
  manifest=$(fetch_manifest)
  parse_manifest_version "$manifest"
}

image_tag_from_env() {
  load_env
  if [ -n "${WGW_IMAGE:-}" ]; then
    printf '%s' "$WGW_IMAGE" | sed 's/.*://'
    return
  fi
  printf '%s' "${WGW_VERSION:-latest}"
}

# Compare two semver strings. Return 0 if equal, 1 if $1 > $2, 2 if $1 < $2.
semver_cmp() {
  a=$(normalize_semver "$1")
  b=$(normalize_semver "$2")

  a_major=$(printf '%s' "$a" | cut -d. -f1)
  a_minor=$(printf '%s' "$a" | cut -d. -f2)
  a_patch=$(printf '%s' "$a" | cut -d. -f3)
  b_major=$(printf '%s' "$b" | cut -d. -f1)
  b_minor=$(printf '%s' "$b" | cut -d. -f2)
  b_patch=$(printf '%s' "$b" | cut -d. -f3)

  if [ "$a_major" -gt "$b_major" ]; then return 1; fi
  if [ "$a_major" -lt "$b_major" ]; then return 2; fi
  if [ "$a_minor" -gt "$b_minor" ]; then return 1; fi
  if [ "$a_minor" -lt "$b_minor" ]; then return 2; fi
  if [ "$a_patch" -gt "$b_patch" ]; then return 1; fi
  if [ "$a_patch" -lt "$b_patch" ]; then return 2; fi
  return 0
}

confirm_upgrade() {
  target=$1
  if [ "$WGW_YES" -eq 1 ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    die "Refusing upgrade without confirmation on non-interactive stdin. Pass --yes to confirm upgrade to ${target}."
  fi
  printf '[wegotworkspace] Upgrade to %s? [y/N] ' "$target"
  read -r answer
  case "$answer" in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

sed_inplace() {
  expr=$1
  file=$2
  tmp="${file}.wgw-setup.tmp"
  sed "$expr" "$file" >"$tmp" && mv "$tmp" "$file"
}

write_env_from_example() {
  path=$1
  example=$2
  cp "$example" "$path"
  if grep -q '^# WGW_IMAGE=' "$path"; then
    sed_inplace "s|^# WGW_IMAGE=.*|WGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:${WGW_VERSION}|" "$path"
  elif ! grep -q '^WGW_IMAGE=' "$path"; then
    printf '\nWGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:%s\n' "$WGW_VERSION" >>"$path"
  fi
}

apply_sqlite_profile() {
  env_path=$1
  if [ "$WGW_SQLITE" -eq 1 ]; then
    sed_inplace 's/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=sqlite/' "$env_path"
    sed_inplace 's/^WGW_WAIT_FOR_DB=.*/WGW_WAIT_FOR_DB=0/' "$env_path"
    sed_inplace 's/^WGW_DB_HOST=.*/WGW_DB_HOST=/' "$env_path"
    # .env.example always sets WGW_DB_DATABASE, so the compose fallback never
    # runs. Containers mount the content volume at /var/wgw/content. MySQL
    # keeps the database name wgw.
    sed_inplace 's|^WGW_DB_DATABASE=.*|WGW_DB_DATABASE=/var/wgw/content/db.sqlite|' "$env_path"
  fi
}

apply_http_port() {
  env_path=$1
  if [ -n "$WGW_HTTP_PORT" ]; then
    if grep -q '^WGW_HTTP_PORT=' "$env_path"; then
      sed_inplace "s/^WGW_HTTP_PORT=.*/WGW_HTTP_PORT=${WGW_HTTP_PORT}/" "$env_path"
    else
      printf '\nWGW_HTTP_PORT=%s\n' "$WGW_HTTP_PORT" >>"$env_path"
    fi
  fi
}

prompt_http_port() {
  if [ -n "$WGW_HTTP_PORT" ]; then
    return 0
  fi
  if [ ! -t 0 ]; then
    return 0
  fi
  default_port="8080"
  printf 'HTTP port [%s]: ' "$default_port"
  read -r answer
  if [ -n "$answer" ]; then
    WGW_HTTP_PORT="$answer"
  fi
}

compose() {
  ensure_docker_platform
  docker compose -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" --env-file "${WGW_INSTALL_DIR}/${ENV_FILE}" "$@"
}

load_env() {
  if [ -f "${WGW_INSTALL_DIR}/${ENV_FILE}" ]; then
    # shellcheck disable=SC1090
    . "${WGW_INSTALL_DIR}/${ENV_FILE}"
  fi
}

read_http_port() {
  load_env
  printf '%s' "${WGW_HTTP_PORT:-8080}"
}

wait_for_health() {
  port=$1
  url="http://127.0.0.1:${port}/api/v1/health"
  log "Waiting for health at ${url} ..."
  i=0
  while [ "$i" -lt 60 ]; do
    if curl -fsS "$url" 2>/dev/null | grep -q '"status":"ok"'; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  die "Health check timed out after 120s. Run: cd ${WGW_INSTALL_DIR} && sh setup.sh logs"
}

print_success() {
  port=$(read_http_port)
  load_env
  profiles="${COMPOSE_PROFILES:-mysql}"
  printf '\nWeGotWorkspace is running.\n'
  printf 'Open http://localhost:%s/install/ to finish setup.\n' "$port"
  if [ "$profiles" = "mysql" ]; then
    printf 'MySQL wizard defaults: host db, database/user/password wgw (see %s/%s)\n' "$WGW_INSTALL_DIR" "$ENV_FILE"
  else
    printf 'SQLite mode: choose SQLite in the installer wizard.\n'
  fi
}

cmd_install() {
  check_docker
  if [ "$WGW_LOCAL" -eq 1 ]; then
    WGW_INSTALL_DIR="${SETUP_SCRIPT_DIR}/../docker/install"
    resolve_install_dir
    log "Local install mode: ${WGW_INSTALL_DIR}"
    if [ ! -f "${WGW_INSTALL_DIR}/${ENV_FILE}" ]; then
      cp "${WGW_INSTALL_DIR}/.env.example" "${WGW_INSTALL_DIR}/${ENV_FILE}"
    fi
    apply_sqlite_profile "${WGW_INSTALL_DIR}/${ENV_FILE}"
    prompt_http_port
    apply_http_port "${WGW_INSTALL_DIR}/${ENV_FILE}"
    log "Building and starting stack..."
    compose up -d --build
    wait_for_health "$(read_http_port)"
    print_success
    return 0
  fi

  resolve_install_dir

  if [ -d "$WGW_INSTALL_DIR" ] && [ -n "$(ls -A "$WGW_INSTALL_DIR" 2>/dev/null || true)" ]; then
    if [ "$WGW_FORCE" -ne 1 ]; then
      die "Install directory already exists: ${WGW_INSTALL_DIR}. Use --force to overwrite or run upgrade."
    fi
    log "Removing existing ${WGW_INSTALL_DIR} (--force)"
    rm -rf "$WGW_INSTALL_DIR"
  fi

  mkdir -p "$WGW_INSTALL_DIR"

  fetch_asset "docker-compose.yml" "${WGW_INSTALL_DIR}/${COMPOSE_FILE}"
  fetch_env_example "${WGW_INSTALL_DIR}/${ENV_FILE}.example"

  write_env_from_example "${WGW_INSTALL_DIR}/${ENV_FILE}" "${WGW_INSTALL_DIR}/${ENV_FILE}.example"
  apply_sqlite_profile "${WGW_INSTALL_DIR}/${ENV_FILE}"
  prompt_http_port
  apply_http_port "${WGW_INSTALL_DIR}/${ENV_FILE}"

  pull_images

  log "Starting stack..."
  compose up -d

  wait_for_health "$(read_http_port)"
  print_success
}

cmd_start() {
  check_docker
  install_dir_from_cwd
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed. Run install first."
  compose up -d
  wait_for_health "$(read_http_port)"
  print_success
}

cmd_stop() {
  check_docker
  install_dir_from_cwd
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed."
  compose down
  log "Stopped."
}

cmd_restart() {
  check_docker
  install_dir_from_cwd
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed."
  compose restart
  wait_for_health "$(read_http_port)"
  print_success
}

cmd_backup() {
  check_docker
  install_dir_from_cwd
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed."

  stamp=$(date +%Y%m%d-%H%M%S)
  backup_dir="${WGW_INSTALL_DIR}/backups/${stamp}"
  mkdir -p "$backup_dir"

  log "Backing up volumes to ${backup_dir}..."
  cp "${WGW_INSTALL_DIR}/${ENV_FILE}" "${backup_dir}/env.backup" 2>/dev/null || true
  cp "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" "${backup_dir}/docker-compose.yml" 2>/dev/null || true

  project=$(basename "$(cd "$WGW_INSTALL_DIR" && pwd)")
  load_env
  project="${COMPOSE_PROJECT_NAME:-${project}}"

  for vol in wgw-content wgw-api-storage wgw-install-config wgw-db; do
    full="${project}_${vol}"
    if docker volume inspect "$full" >/dev/null 2>&1; then
      docker run --rm \
        -v "${full}:/data:ro" \
        -v "${backup_dir}:/backup" \
        alpine:3.20 \
        tar czf "/backup/${vol}.tar.gz" -C /data .
      log "  ${vol} -> ${backup_dir}/${vol}.tar.gz"
    fi
  done

  load_env
  if [ "${COMPOSE_PROFILES:-mysql}" = "mysql" ]; then
    log "Dumping MySQL database..."
    compose exec -T db mariadb-dump \
      -u root \
      -p"${MARIADB_ROOT_PASSWORD:-wgw-root}" \
      "${MARIADB_DATABASE:-wgw}" >"${backup_dir}/wgw-database.sql" || \
      log "Warning: MySQL dump failed (is db running?)"
  fi

  log "Backup complete: ${backup_dir}"
}

cmd_status() {
  check_docker
  install_dir_from_cwd
  resolve_install_dir
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed. Run install first."

  load_env
  image="${WGW_IMAGE:-ghcr.io/wegotworkspace/wegotworkspace:${WGW_VERSION:-latest}}"
  tag=$(printf '%s' "$image" | sed 's/.*://')
  profiles="${COMPOSE_PROFILES:-mysql}"
  port=$(read_http_port)

  log "Install directory: ${WGW_INSTALL_DIR}"
  log "WGW_IMAGE: ${image}"
  log "Image tag: ${tag}"
  log "Compose profile: ${profiles}"

  url="http://127.0.0.1:${port}/api/v1/health"
  if curl -fsS "$url" 2>/dev/null | grep -q '"status":"ok"'; then
    log "Health: ok (${url})"
  else
    log "Health: unavailable (${url})"
  fi
}

cmd_check() {
  install_dir_from_cwd
  resolve_install_dir
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed. Run install first."

  installed=$(image_tag_from_env)
  latest=$(resolve_latest_version)

  if [ "$installed" = "latest" ]; then
    log "Installed tag is :latest (unpinned). Latest release: ${latest}"
    log "Run: bash setup.sh upgrade"
    return 0
  fi

  semver_cmp "$installed" "$latest"
  cmp=$?
  if [ "$cmp" -eq 0 ]; then
    log "Up to date (${installed})"
  elif [ "$cmp" -eq 1 ]; then
    log "Installed ${installed} is newer than published ${latest}"
  else
    log "${latest} available (installed: ${installed})"
    log "Run: bash setup.sh upgrade"
  fi
}

cmd_upgrade() {
  check_docker
  install_dir_from_cwd
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed. Run install first."

  target="${WGW_UPGRADE_VERSION:-}"
  if [ -z "$target" ] || [ "$target" = "latest" ]; then
    target=$(resolve_latest_version)
  fi
  target=$(normalize_semver "$target")

  installed=$(image_tag_from_env)
  if [ "$WGW_DRY_RUN" -eq 1 ]; then
    log "Dry run: would upgrade ${installed} -> ${target}"
    log "  WGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:${target}"
    log "  Steps: backup, pull, compose up -d, health check"
    return 0
  fi

  if ! confirm_upgrade "$target"; then
    log "Upgrade cancelled."
    exit 0
  fi

  log "Upgrading to ${target}..."
  cmd_backup

  env_path="${WGW_INSTALL_DIR}/${ENV_FILE}"
  if grep -q '^WGW_IMAGE=' "$env_path"; then
    sed_inplace "s|^WGW_IMAGE=.*|WGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:${target}|" "$env_path"
  else
    printf '\nWGW_IMAGE=ghcr.io/wegotworkspace/wegotworkspace:%s\n' "$target" >>"$env_path"
  fi

  WGW_VERSION="$target"
  fetch_asset "docker-compose.yml" "${WGW_INSTALL_DIR}/${COMPOSE_FILE}"

  pull_images

  log "Recreating stack (migrator runs before web)..."
  compose up -d

  wait_for_health "$(read_http_port)"
  log "Upgrade to ${target} complete."
  print_success
}

cmd_logs() {
  check_docker
  install_dir_from_cwd
  [ -f "${WGW_INSTALL_DIR}/${COMPOSE_FILE}" ] || die "Not installed."
  compose logs -f
}

is_command() {
  case "$1" in
    install | start | stop | restart | status | check | upgrade | backup | logs | help) return 0 ;;
    *) return 1 ;;
  esac
}

is_version_arg() {
  case "$1" in
    "" | --*) return 1 ;;
    install | start | stop | restart | status | check | upgrade | backup | logs | help) return 1 ;;
    *) return 0 ;;
  esac
}

is_flag_arg() {
  case "$1" in
    --yes | --dry-run | --local) return 0 ;;
    *) return 1 ;;
  esac
}

parse_args() {
  cmd="install"
  while [ $# -gt 0 ]; do
    case "$1" in
      --sqlite)
        WGW_SQLITE=1
        shift
        ;;
      --version)
        [ $# -ge 2 ] || die "--version requires a value"
        WGW_VERSION=$2
        shift 2
        ;;
      --upgrade)
        WGW_UPGRADE=1
        if is_version_arg "${2:-}"; then
          WGW_UPGRADE_VERSION=$2
          shift
        fi
        shift
        ;;
      --yes)
        WGW_YES=1
        shift
        ;;
      --dry-run)
        WGW_DRY_RUN=1
        shift
        ;;
      --local)
        WGW_LOCAL=1
        shift
        ;;
      --force)
        WGW_FORCE=1
        shift
        ;;
      -h | --help | help)
        usage
        exit 0
        ;;
      *)
        if is_command "$1"; then
          cmd=$1
          shift
          if [ "$cmd" = "upgrade" ]; then
            while [ $# -gt 0 ]; do
              if is_flag_arg "$1"; then
                case "$1" in
                  --yes) WGW_YES=1 ;;
                  --dry-run) WGW_DRY_RUN=1 ;;
                esac
                shift
              elif is_version_arg "$1"; then
                WGW_UPGRADE_VERSION=$1
                shift
              else
                break
              fi
            done
          fi
        else
          die "Unknown argument: $1 (try --help)"
        fi
        ;;
    esac
  done

  if [ "$WGW_UPGRADE" -eq 1 ]; then
    cmd="upgrade"
  fi

  case "$cmd" in
    install) cmd_install ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    restart) cmd_restart ;;
    status) cmd_status ;;
    check) cmd_check ;;
    upgrade) cmd_upgrade ;;
    backup) cmd_backup ;;
    logs) cmd_logs ;;
    *) usage; exit 1 ;;
  esac
}

# Release smoke and tests source this file (WGW_SETUP_LIB=1) and call
# apply_sqlite_profile. A normal install parses CLI args.
if [ "${WGW_SETUP_LIB:-0}" != 1 ]; then
  parse_args "$@"
fi
