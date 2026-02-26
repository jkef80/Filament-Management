#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/filament-management"
SERVICE_NAME="filament-management"

if [ "${EUID}" -ne 0 ]; then
  echo "Bitte mit sudo starten: sudo ./scripts/uninstall.sh"
  exit 1
fi

systemctl stop "$SERVICE_NAME" || true
systemctl disable "$SERVICE_NAME" || true
rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
rm -rf "$APP_DIR"

echo "Uninstalled."
