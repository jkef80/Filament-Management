#!/usr/bin/env bash
set -euo pipefail

REPO="jkef80/Filament-Management"
BRANCH="main"
APP_DIR="/opt/filament-management"
SERVICE_NAME="filament-management"

ARCHIVE_NAME="filament-management-1.0.2.tar.gz"

if [ "${EUID}" -ne 0 ]; then
  echo "Bitte mit sudo ausführen."
  exit 1
fi

REAL_USER="${SUDO_USER:-root}"

if [ ! -d "${APP_DIR}" ]; then
  echo "ERROR: ${APP_DIR} nicht gefunden. Erst installieren."
  exit 1
fi

apt update
apt install -y curl tar rsync ca-certificates

TMP_DIR="$(mktemp -d)"
ARCHIVE_PATH="${TMP_DIR}/${ARCHIVE_NAME}"

URL="https://raw.githubusercontent.com/${REPO}/${BRANCH}/${ARCHIVE_NAME}"
echo "Downloading: ${URL}"
curl -fL "${URL}" -o "${ARCHIVE_PATH}"

echo "Extracting..."
tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"

SRC_DIR="$(find "${TMP_DIR}" -maxdepth 1 -type d -name 'filament-management-*' | head -n 1)"
if [ -z "${SRC_DIR}" ]; then
  echo "ERROR: could not find extracted folder"
  exit 1
fi

echo "Updating code in: ${APP_DIR}"
rsync -a --delete --exclude "data/" "${SRC_DIR}/" "${APP_DIR}/"

chown -R "${REAL_USER}:${REAL_USER}" "${APP_DIR}"
chmod -R u+rwX "${APP_DIR}/data" || true

# deps update
if [ -f "${APP_DIR}/venv/bin/activate" ]; then
  sudo -u "${REAL_USER}" bash -lc "
  cd '${APP_DIR}'
  source venv/bin/activate
  pip install -r requirements.txt
  "
fi

systemctl restart "${SERVICE_NAME}"
echo "Update done. Logs: sudo journalctl -u ${SERVICE_NAME} -f"
