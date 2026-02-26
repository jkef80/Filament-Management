#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/filament-management"
SERVICE_NAME="filament-management"

if [ "${EUID}" -ne 0 ]; then
  echo "Bitte mit sudo starten: sudo ./scripts/update.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-root}"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$APP_DIR" ]; then
  echo "ERROR: $APP_DIR nicht gefunden. Erst installieren."
  exit 1
fi

rsync -a --delete \
  --exclude "data/" \
  --exclude ".git/" \
  "$SRC_DIR/" "$APP_DIR/"

chown -R "$REAL_USER:$REAL_USER" "$APP_DIR"
chmod -R u+rwX "$APP_DIR/data" || true

sudo -u "$REAL_USER" bash -lc "
cd '$APP_DIR'
source venv/bin/activate
pip install -r requirements.txt
"

systemctl restart "$SERVICE_NAME"
echo "Update done. Logs: sudo journalctl -u ${SERVICE_NAME} -f"
