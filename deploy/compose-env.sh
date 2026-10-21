#!/usr/bin/env bash
# Compose a dotenv file from the current process environment.
# Never prints values. Refuses to write if required keys are missing/too short.
#
# Usage: compose-env.sh <outfile>
set -euo pipefail

OUT="${1:-}"
if [[ -z "$OUT" || "$OUT" == "-" ]]; then
  echo "usage: compose-env.sh <outfile>" >&2
  echo "refusing stdout so values cannot leak into CI logs" >&2
  exit 2
fi

fail() {
  echo "compose-env: $*" >&2
  exit 1
}

len() {
  printf '%s' "$1" | wc -c | tr -d ' '
}

require() {
  local name="$1"
  local min="$2"
  local val="${!name-}"
  if [[ -z "${val}" ]]; then
    fail "missing required ${name} — not writing env"
  fi
  local n
  n="$(len "${val}")"
  if (( n < min )); then
    fail "${name} is too short (min ${min} chars) — not writing env"
  fi
  case "${val}" in
    change_me_access_secret|change_me_refresh_secret|change_me)
      fail "${name} still has the example placeholder — not writing env"
      ;;
  esac
}

emit() {
  local name="$1"
  local val="${!name-}"
  if [[ -z "${val}" ]]; then
    return 0
  fi
  # Escape backslashes and newlines so the file stays one assignment per key.
  local escaped
  escaped="${val//\\/\\\\}"
  escaped="${escaped//$'\n'/\\n}"
  printf '%s=%s\n' "${name}" "${escaped}"
}

require MONGO_URI 20
require JWT_ACCESS_SECRET 16
require JWT_REFRESH_SECRET 16
require CORS_ORIGIN 8

NODE_ENV="${NODE_ENV:-production}"
PORT="${PORT:-8080}"
COOKIE_SECURE="${COOKIE_SECURE:-false}"

umask 077
tmp="$(mktemp "${TMPDIR:-/tmp}/addacrm.env.XXXXXX")"
cleanup() { rm -f "${tmp}"; }
trap cleanup EXIT

{
  emit NODE_ENV
  emit PORT
  emit MONGO_URI
  emit JWT_ACCESS_SECRET
  emit JWT_REFRESH_SECRET
  emit CORS_ORIGIN
  emit COOKIE_SECURE
  emit COOKIE_DOMAIN
  emit PUBLIC_API_HOST
  emit BREVO_USER
  emit BREVO_MASTER_KEY
  emit BREVO_FROM
  emit BUCKET_ENDPOINT
  emit BUCKET_NAME
  emit BUCKET_ACCESS_KEY_ID
  emit BUCKET_SECRET_ACCESS_KEY
  emit BUCKET_REGION
  emit BUCKET_PUBLIC_URL_BASE
  emit MONGO_MAX_POOL_SIZE
  emit MONGO_MIN_POOL_SIZE
  emit MONGO_MAX_CONNECTING
  emit MONGO_WAIT_QUEUE_TIMEOUT_MS
  emit MONGO_SOCKET_TIMEOUT_MS
  emit MONGO_SERVER_SELECTION_TIMEOUT_MS
  emit MONGO_SLOW_QUERY_MS
  emit ENABLE_MONGO_SLOW_QUERY_LOG
  emit ENABLE_PERFORMANCE_METRICS
  emit API_P95_WARN_MS
  emit API_JSON_LIMIT
  emit MONGO_FAMILY
  # Redis is always the compose service. Do not take REDIS_URL from GitHub.
  printf '%s\n' "REDIS_URL=redis://redis:6379"
} >"${tmp}"

mkdir -p "$(dirname "${OUT}")"
mv "${tmp}" "${OUT}"
chmod 600 "${OUT}"
trap - EXIT
echo "compose-env: wrote ${OUT}" >&2
