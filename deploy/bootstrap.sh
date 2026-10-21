#!/usr/bin/env bash
# First-time VPS bootstrap for addacrm. Run as root.
# Usage: bootstrap.sh [deploy_ed25519.pub]
#
# Shared VPS: do not enable UFW (other apps use :8080), do not bind :80/:443
# (host Caddy already owns TLS). Redis is compose-only, not apt.
# Does not write application secrets.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "bootstrap: run as root" >&2
  exit 1
fi

APP_NAME="addacrm"
APP_DIR="/opt/${APP_NAME}"
DEPLOY_USER="deploy"
PUBKEY_FILE="${1:-}"

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  rsync \
  jq

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi

systemctl enable --now docker

if ! id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${DEPLOY_USER}"
fi
usermod -aG docker "${DEPLOY_USER}"

install -d -m 755 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "${APP_DIR}"
install -d -m 700 -o "${DEPLOY_USER}" -g "${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
AUTH_KEYS="/home/${DEPLOY_USER}/.ssh/authorized_keys"
touch "${AUTH_KEYS}"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"

if [[ -n "${PUBKEY_FILE}" ]]; then
  if [[ ! -f "${PUBKEY_FILE}" ]]; then
    echo "bootstrap: pubkey file not found: ${PUBKEY_FILE}" >&2
    exit 1
  fi
  pub="$(tr -d '\r' <"${PUBKEY_FILE}")"
  if [[ -z "${pub}" ]]; then
    echo "bootstrap: pubkey file is empty" >&2
    exit 1
  fi
  if ! grep -Fqx "${pub}" "${AUTH_KEYS}"; then
    printf '%s\n' "${pub}" >>"${AUTH_KEYS}"
  fi
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${AUTH_KEYS}"
  chmod 600 "${AUTH_KEYS}"
fi

# Limited sudo so deploy can reload host Caddy after a site snippet change.
SUDOERS="/etc/sudoers.d/addacrm-deploy"
cat >"${SUDOERS}" <<'EOF'
deploy ALL=(root) NOPASSWD: /usr/bin/caddy validate --config /etc/caddy/Caddyfile
deploy ALL=(root) NOPASSWD: /usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload caddy
EOF
chmod 440 "${SUDOERS}"
visudo -cf "${SUDOERS}"

echo "bootstrap: ${APP_NAME} ready at ${APP_DIR} (user ${DEPLOY_USER})"
echo "bootstrap: UFW left unchanged (shared VPS; host Caddy already serves :443)"
echo "bootstrap: Redis is not installed on the host; compose provides it on an internal network"
echo "bootstrap: Atlas Network Access must allow this VPS public IP (do not put MONGO_URI here)"
