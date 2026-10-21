#!/usr/bin/env bash
# Replace (or append) the addacrm site in host /etc/caddy/Caddyfile, then reload.
# Run as root. Leaves every other site untouched.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install-caddy-site: run as root" >&2
  exit 1
fi

HOST_FILE="/etc/caddy/Caddyfile"
SNIPPET="${1:-/opt/addacrm/deploy/Caddyfile}"
MARKER="addacrm.178.92.120.191.sslip.io"

if [[ ! -f "${HOST_FILE}" ]]; then
  echo "install-caddy-site: missing ${HOST_FILE}" >&2
  exit 1
fi
if [[ ! -f "${SNIPPET}" ]]; then
  echo "install-caddy-site: missing snippet ${SNIPPET}" >&2
  exit 1
fi

python3 - "${HOST_FILE}" "${SNIPPET}" "${MARKER}" <<'PY'
from pathlib import Path
import sys

host = Path(sys.argv[1])
snippet = Path(sys.argv[2])
marker = sys.argv[3]
text = host.read_text()
start = text.find(marker)
if start != -1:
    line_start = text.rfind("\n", 0, start) + 1
    while line_start > 0:
        prev_nl = text.rfind("\n", 0, line_start - 1)
        prev_line = text[prev_nl + 1 : line_start]
        if prev_line.strip().startswith("#") and "addacrm" in prev_line.lower():
            line_start = prev_nl + 1
        else:
            break
    brace = text.find("{", start)
    if brace < 0:
        raise SystemExit("install-caddy-site: site block has no opening brace")
    depth = 0
    i = brace
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                i += 1
                break
        i += 1
    while i < len(text) and text[i] in "\r\n":
        i += 1
    text = text[:line_start] + text[i:]
    print("install-caddy-site: removed existing site block")
text = text.rstrip() + "\n\n# addacrm (managed by deploy/install-caddy-site.sh)\n"
text += snippet.read_text().strip() + "\n"
host.write_text(text)
print("install-caddy-site: wrote site block")
PY

caddy validate --config "${HOST_FILE}"
systemctl reload caddy
echo "install-caddy-site: caddy reloaded"
