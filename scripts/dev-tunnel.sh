#!/usr/bin/env bash
# =============================================================================
# Golden CRM — SSH Tunnel للمطورين المحليين
# =============================================================================
# يُنشئ نفقاً آمناً بين جهازك المحلي وقاعدة بيانات التطوير على السيرفر.
# بعد تشغيله، يصبح PostgreSQL متاحاً على localhost:5433 على جهازك.
#
# الاستخدام:
#   chmod +x scripts/dev-tunnel.sh
#   SERVER_IP=your.server.ip SSH_USER=ubuntu bash scripts/dev-tunnel.sh
# =============================================================================

set -euo pipefail

SERVER_IP="${SERVER_IP:-}"
SSH_USER="${SSH_USER:-root}"
LOCAL_PORT="${LOCAL_PORT:-5433}"       # البورت على جهازك المحلي
REMOTE_PORT="${REMOTE_PORT:-5432}"     # بورت PostgreSQL على السيرفر
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"

if [[ -z "$SERVER_IP" ]]; then
  read -rp "أدخل IP السيرفر: " SERVER_IP
fi

echo ""
echo "════════════════════════════════════════════════"
echo "  Golden CRM — SSH Tunnel"
echo "  $LOCAL_PORT (local) → $SERVER_IP:$REMOTE_PORT"
echo "════════════════════════════════════════════════"
echo ""
echo "  الاتصال بـ postgresql://crm_dev_user@localhost:$LOCAL_PORT/golden_crm_dev"
echo "  اضغط Ctrl+C لإيقاف النفق."
echo ""

ssh -N \
  -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  -i "${SSH_KEY}" \
  -o ServerAliveInterval=60 \
  -o ExitOnForwardFailure=yes \
  "${SSH_USER}@${SERVER_IP}"
