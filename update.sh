#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/filament-management"
SERVICE_NAME="filament-management"
REPO_URL="https://github.com/davidkinnes/CFSync.git"

if [[ ${EUID} -ne 0 ]]; then
  echo "Please run with sudo"
  exit 1
fi

REAL_USER="${SUDO_USER:-}"
if [[ -z "$REAL_USER" || "$REAL_USER" == "root" ]]; then
  echo "Run via sudo from normal user"
  exit 1
fi

echo "Updating CFSync..."

rm -rf /tmp/filament-update
git clone --depth 1 "$REPO_URL" /tmp/filament-update

rsync -a \
  --exclude ".git/" \
  --exclude "data/" \
  --exclude "venv/" \
  --exclude "__pycache__/" \
  /tmp/filament-update/ "$APP_DIR/"

rm -rf /tmp/filament-update

sudo -u "$REAL_USER" bash -lc "
cd '$APP_DIR'
if [[ ! -f venv/bin/activate ]]; then
  echo 'Recreating virtual environment...'
  python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt
"

systemctl restart "$SERVICE_NAME"

echo "✅ Updated successfully"
echo "Logs: sudo journalctl -u ${SERVICE_NAME} -f"
