#!/usr/bin/env bash
# Sync server + public to box (as user niels) and restart the user service.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${DEPLOY_HOST:-box}"
rsync -az --delete --chown=niels:niels \
  --include='server/***' --include='public/***' --include='ops/***' --include='package.json' --exclude='*' \
  ./ "$HOST":/home/niels/bibliotek-pwa/
ssh "$HOST" 'set -e; U=$(id -u niels)
  install -d -o niels -g niels -m 700 /home/niels/bibliotek-pwa-data
  install -o niels -g niels -m 644 /home/niels/bibliotek-pwa/ops/bibliotek.service /home/niels/.config/systemd/user/bibliotek.service
  sudo -u niels XDG_RUNTIME_DIR=/run/user/$U systemctl --user daemon-reload
  sudo -u niels XDG_RUNTIME_DIR=/run/user/$U systemctl --user enable --now bibliotek.service
  sudo -u niels XDG_RUNTIME_DIR=/run/user/$U systemctl --user restart bibliotek.service
  sleep 1; sudo -u niels XDG_RUNTIME_DIR=/run/user/$U systemctl --user --no-pager status bibliotek.service | head -5'
