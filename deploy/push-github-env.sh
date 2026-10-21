#!/usr/bin/env bash
# Push per-key values from a local dotenv into GitHub Environment "production".
# Never prints values. Does not push REDIS_URL (compose injects Redis).
#
# Usage (from repo root):
#   ./deploy/push-github-env.sh
#   ./deploy/push-github-env.sh /path/to/.env
set -euo pipefail

ENV_FILE="${1:-.env}"
GH_ENV="${GITHUB_ENVIRONMENT_NAME:-production}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "push-github-env: file not found: ${ENV_FILE}" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "push-github-env: gh CLI is required" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "push-github-env: gh is not authenticated" >&2
  exit 1
fi

# Ensure the GitHub Environment exists (names only; no values).
gh api --method PUT "repos/{owner}/{repo}/environments/${GH_ENV}" >/dev/null

set_secret() {
  local name="$1"
  local val="$2"
  if [[ -z "${val}" ]]; then
    echo "skip secret ${name} (empty)"
    return 0
  fi
  printf '%s' "${val}" | gh secret set "${name}" --env "${GH_ENV}" >/dev/null
  echo "set secret ${name}"
}

set_var() {
  local name="$1"
  local val="$2"
  if [[ -z "${val}" ]]; then
    echo "skip variable ${name} (empty)"
    return 0
  fi
  printf '%s' "${val}" | gh variable set "${name}" --env "${GH_ENV}" >/dev/null
  echo "set variable ${name}"
}

# Parse dotenv without exporting into the parent shell logs.
while IFS= read -r line || [[ -n "${line}" ]]; do
  line="${line%$'\r'}"
  [[ -z "${line}" || "${line}" == \#* ]] && continue
  [[ "${line}" != *=* ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  key="${key%"${key##*[![:space:]]}"}"
  key="${key#"${key%%[![:space:]]*}"}"
  if [[ "${val}" == \"*\" && "${val}" == *\" ]]; then
    val="${val:1:${#val}-2}"
  elif [[ "${val}" == \'*\' && "${val}" == *\' ]]; then
    val="${val:1:${#val}-2}"
  fi
  case "${key}" in
    MONGO_URI|JWT_ACCESS_SECRET|JWT_REFRESH_SECRET|BREVO_MASTER_KEY|BUCKET_ACCESS_KEY_ID|BUCKET_SECRET_ACCESS_KEY)
      set_secret "${key}" "${val}"
      ;;
    REDIS_URL)
      echo "skip ${key} (compose sets redis://redis:6379)"
      ;;
    NODE_ENV|PORT|CORS_ORIGIN|COOKIE_SECURE|COOKIE_DOMAIN|PUBLIC_API_HOST|BREVO_USER|BREVO_FROM|BUCKET_ENDPOINT|BUCKET_NAME|BUCKET_REGION|BUCKET_PUBLIC_URL_BASE|MONGO_MAX_POOL_SIZE|MONGO_MIN_POOL_SIZE|MONGO_MAX_CONNECTING|MONGO_WAIT_QUEUE_TIMEOUT_MS|MONGO_SOCKET_TIMEOUT_MS|MONGO_SERVER_SELECTION_TIMEOUT_MS|MONGO_SLOW_QUERY_MS|ENABLE_MONGO_SLOW_QUERY_LOG|ENABLE_PERFORMANCE_METRICS|API_P95_WARN_MS|API_JSON_LIMIT|MONGO_FAMILY)
      set_var "${key}" "${val}"
      ;;
    *)
      echo "skip unknown ${key}"
      ;;
  esac
done <"${ENV_FILE}"

echo "push-github-env: done (${GH_ENV})"
