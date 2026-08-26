#!/usr/bin/env bash
# Connexion SSH Infomaniak Node.js (mot de passe, invite FR ou EN).
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <commande-distante>" >&2
  exit 2
fi

: "${SSH_HOST:?}"
: "${SSH_USER:?}"
: "${SSH_PASSWORD:?}"

REMOTE_CMD="$1"
export SSHPASS="$SSH_PASSWORD"

SSH_OPTS=(
  -o StrictHostKeyChecking=accept-new
  -o PreferredAuthentications=keyboard-interactive,password
  -o PubkeyAuthentication=no
  -o KbdInteractiveAuthentication=yes
  -o NumberOfPasswordPrompts=1
  -o ConnectTimeout=20
  -tt
)

run_ssh() {
  local prompt="$1"
  sshpass -e -P "$prompt" ssh "${SSH_OPTS[@]}" \
    "${SSH_USER}@${SSH_HOST}" \
    "$REMOTE_CMD"
}

# 1) invite anglaise (Password:)  2) invite française (Mot de passe :)
if run_ssh "assword"; then
  exit 0
fi
echo "Nouvelle tentative avec invite française…" >&2
run_ssh "passe"
