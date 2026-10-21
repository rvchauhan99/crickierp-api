#!/usr/bin/env bash
# First-time laptop → VPS apply. Reads a local dotenv without printing values.
# Usage: first-apply.sh [path/to/.env]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

ENV_FILE="${1:-${ROOT}/.env}"
VPS_HOST="${VPS_HOST:-178.92.120.191}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:-${HOME}/.ssh/addacrm_deploy}"
SSH_OPTS="-i ${SSH_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
REMOTE_DIR="/opt/addacrm"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "first-apply: missing ${ENV_FILE}" >&2
  exit 1
fi
if [[ ! -f "${SSH_KEY}" ]]; then
  echo "first-apply: missing SSH key ${SSH_KEY}" >&2
  exit 1
fi

# Load names into this process only. `set +x` so values cannot leak.
set +x
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

umask 077
TMP_ENV="$(mktemp "${TMPDIR:-/tmp}/addacrm.env.XXXXXX")"
cleanup() { rm -f "${TMP_ENV}"; }
trap cleanup EXIT

"${ROOT}/deploy/compose-env.sh" "${TMP_ENV}"

rsync -az --delete \
  --exclude '.git/' \
  --exclude '.github/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'coverage/' \
  --exclude '.DS_Store' \
  -e "ssh ${SSH_OPTS}" \
  "${ROOT}/" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/"

# shellcheck disable=SC2086
scp ${SSH_OPTS} "${TMP_ENV}" "${VPS_USER}@${VPS_HOST}:${REMOTE_DIR}/.env.next"
# shellcheck disable=SC2086
ssh ${SSH_OPTS} "${VPS_USER}@${VPS_HOST}" "set -euo pipefail
  cd ${REMOTE_DIR}
  mv .env.next .env
  chmod 600 .env
  docker compose up -d --build
  docker compose ps
"

echo "first-apply: compose is up; health is the next step (no env values printed)"
