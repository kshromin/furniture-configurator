#!/usr/bin/env bash
# Базовая настройка свежего сервера Ubuntu 24.04.
# Запускать от root на СВЕЖЕМ сервере, один раз:
#   bash server-init.sh
#
# Что делает: заводит рабочего пользователя, закрывает вход по паролю, включает фаервол,
# автообновления безопасности, swap и ставит Docker.
#
# ВАЖНО: не закрывайте текущую SSH-сессию, пока не проверите вход новым пользователем
# из другого окна. Скрипт отключает вход по паролю — если ключ не работает, войти будет нечем.

set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

log() { printf '\n=== %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "Запускать от root" >&2
  exit 1
fi

log "Проверяю, что SSH-ключ на месте"
if [ ! -s /root/.ssh/authorized_keys ]; then
  echo "В /root/.ssh/authorized_keys пусто — значит вход по ключу не настроен." >&2
  echo "Добавьте ключ в панели Selectel и пересоздайте сервер, иначе отключать пароль нельзя." >&2
  exit 1
fi

log "Обновляю пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

log "Создаю пользователя $DEPLOY_USER"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG sudo "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
cp /root/.ssh/authorized_keys "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"
# sudo без пароля: пароля у пользователя нет вообще, вход только по ключу
echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$DEPLOY_USER"
chmod 440 "/etc/sudoers.d/90-$DEPLOY_USER"

log "Закрываю вход по паролю и вход root по SSH"
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl restart ssh

log "Фаервол: наружу открыты только SSH, HTTP и HTTPS"
apt-get install -y -qq ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Автообновления безопасности"
apt-get install -y -qq unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Swap $SWAP_SIZE"
if [ ! -f /swapfile ]; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # база данных не любит агрессивный swap, но пусть будет как страховка
  sysctl -w vm.swappiness=10
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$DEPLOY_USER"
systemctl enable --now docker

log "fail2ban (защита SSH от перебора)"
apt-get install -y -qq fail2ban
systemctl enable --now fail2ban

log "Каталоги проекта"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /srv/khrom
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /srv/khrom/sites
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" /var/backups/pg

cat <<EOF

=== Готово ===
Теперь ИЗ ДРУГОГО ОКНА проверьте вход:

    ssh $DEPLOY_USER@$(hostname -I | awk '{print $1}')

Если пустило — эту сессию можно закрывать. Если нет — НЕ закрывайте, разбираемся здесь.
EOF
