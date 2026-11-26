#!/usr/bin/env bash
# Prepara una VM Ubuntu 24.04 para servir Precios súper. Se puede volver a ejecutar sin problema.
#   sudo bash servidor/instalar.sh
# Qué hace:
#   - instala Node.js y git (de los repositorios de Ubuntu);
#   - clona (o actualiza) el repositorio en /home/precios/precios-super;
#   - servicio precios-servidor: el servidor en el puerto 8787, se reinicia solo;
#   - temporizador precios-actualizar: cada 30 minutos trae los precios nuevos de GitHub (git pull).
set -euo pipefail
USUARIO=precios
DIR=/home/$USUARIO/precios-super
REPO=https://github.com/TheRenadeus/precios-super.git

passwd -l root >/dev/null            # sin clave para root: se administra con sudo y llave SSH
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs git >/dev/null

if [ -d "$DIR/.git" ]; then sudo -u $USUARIO git -C "$DIR" pull --ff-only -q
else sudo -u $USUARIO git clone -q "$REPO" "$DIR"; fi

cat > /etc/systemd/system/precios-servidor.service <<EOF
[Unit]
Description=Precios super: servidor de la app
After=network-online.target
Wants=network-online.target

[Service]
User=$USUARIO
WorkingDirectory=$DIR
Environment=PUERTO=8787
Environment=ORIGENES=https://therenadeus.github.io,http://localhost:4180
ExecStart=/usr/bin/node servidor/servidor.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/precios-actualizar.service <<EOF
[Unit]
Description=Precios super: traer precios nuevos de GitHub

[Service]
Type=oneshot
User=$USUARIO
WorkingDirectory=$DIR
ExecStart=/usr/bin/git pull --ff-only -q
EOF

cat > /etc/systemd/system/precios-actualizar.timer <<EOF
[Unit]
Description=Precios super: traer precios cada 30 minutos

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now precios-servidor.service precios-actualizar.timer >/dev/null
systemctl restart precios-servidor.service
echo "Node $(node --version) · servidor: $(systemctl is-active precios-servidor) · actualizar: $(systemctl is-active precios-actualizar.timer)"
