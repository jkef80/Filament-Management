#!/usr/bin/env bash
set -e

APP_DIR="/opt/filament-management"
SERVICE_NAME="filament-management"

echo "=== Filament Management Installer ==="
echo ""

read -p "UI Port (default 8005): " UI_PORT
UI_PORT=${UI_PORT:-8005}

read -p "Moonraker IP (z.B. 192.168.178.148): " PRINTER_IP
read -p "Moonraker Port (default 7125): " PRINTER_PORT
PRINTER_PORT=${PRINTER_PORT:-7125}

read -p "CFS Autosync? (y/N): " AUTOSYNC
AUTOSYNC=${AUTOSYNC:-N}

AUTOSYNC_BOOL="false"
if [[ "$AUTOSYNC" =~ ^[Yy]$ ]]; then
    AUTOSYNC_BOOL="true"
fi

echo ""
echo "Installing to $APP_DIR"
echo ""

# Install dependencies if missing
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip

# Clone or update
if [ ! -d "$APP_DIR" ]; then
    sudo git clone https://github.com/jkef80/Filament-Management.git $APP_DIR
else
    cd $APP_DIR
    sudo git pull
fi

sudo chown -R $USER:$USER $APP_DIR
cd $APP_DIR

# Create venv
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Create config
mkdir -p data

cat > data/config.json <<EOF
{
  "moonraker_url": "http://${PRINTER_IP}:${PRINTER_PORT}",
  "poll_interval_sec": 5,
  "filament_diameter_mm": 1.75,
  "cfs_autosync": ${AUTOSYNC_BOOL}
}
EOF

# Create systemd service
sudo bash -c "cat > /etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Filament Management
After=network.target

[Service]
User=${USER}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/venv/bin/uvicorn main:app --host 0.0.0.0 --port ${UI_PORT}
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
sudo systemctl restart ${SERVICE_NAME}

IP=$(hostname -I | awk '{print $1}')

echo ""
echo "========================================"
echo "Installation complete!"
echo "Open in browser: http://${IP}:${UI_PORT}"
echo "========================================"
