#!/bin/sh
# send-anomaly-alert.sh — envia alerta de anomalia via WhatsApp (API local).
# 100% POSIX sh (dash/ash/BusyBox): sem arrays, [[ ]], ${var,,}, local, echo -e.
# O worker do flow-exporter executa: sh <script> <args>
#
# Args (ordem dos placeholders no action blueprint):
#   1  ADDRESS          (ex: 177.10.90.0)
#   2  MASK             (ex: 24)
#   3  TRIGGER_NAME     (ex: nome#724d3b21)
#   4  BYTES_SECOND     (bytes/s no disparo)
#   5  PACKETS_SECONDS  (pacotes/s no disparo)
#   6  TRIGGER_BYTES    (threshold em Mbps)
#   7  TRIGGER_PACKETS  (threshold em kpps)
#   8  TRIGGER_MODE     (absolute | delta | cross)
#   9  CLASSIFIER       (nome do classificador)
#  10  DST_PORTS        (ex: 80,443 ou 0-65535)
#  11  PROTOCOLS        (ex: tcp,udp ou any)
#  12  WHATSAPP_ID      (numero ou group_id ex: 5511999999999 ou grupo@g.us)
#  13  API_URL          (URL base da API, ex: http://localhost:3000)

ADDRESS="$1"
MASK="$2"
TRIGGER_NAME="$3"
BYTES_SECOND="$4"
PACKETS_SECONDS="$5"
TRIGGER_BYTES="$6"
TRIGGER_PACKETS="$7"
TRIGGER_MODE="$8"
CLASSIFIER="$9"
DST_PORTS="${10}"
PROTOCOLS="${11}"
WHATSAPP_ID="${12}"
API_URL="${13:-http://localhost:3000}"

if [ -z "$WHATSAPP_ID" ]; then
    echo "usage: sh send-anomaly-alert.sh ADDRESS MASK TRIGGER_NAME BYTES_SECOND PACKETS_SECONDS TRIGGER_BYTES TRIGGER_PACKETS TRIGGER_MODE CLASSIFIER DST_PORTS PROTOCOLS WHATSAPP_ID [API_URL]" >&2
    exit 1
fi

# bytes/s -> Mbps e pps -> kpps, com awk (POSIX; evita bashismo aritmético com float)
MBPS=$(awk "BEGIN { printf \"%.2f\", $BYTES_SECOND * 8 / 1000000 }" 2>/dev/null || echo "$BYTES_SECOND")
KPPS=$(awk "BEGIN { printf \"%.2f\", $PACKETS_SECONDS / 1000 }" 2>/dev/null || echo "$PACKETS_SECONDS")

TEXT="🚨 Anomalia detectada

Alvo: ${ADDRESS}/${MASK}
Trigger: ${TRIGGER_NAME} (${TRIGGER_MODE})
Classificador: ${CLASSIFIER}
Tráfego: ${MBPS} Mbps / ${KPPS} kpps
Threshold: ${TRIGGER_BYTES} Mbps / ${TRIGGER_PACKETS} kpps
Portas: ${DST_PORTS}
Protocolos: ${PROTOCOLS}"

# Envia via API WhatsApp (endpoint público /enviar-mensagem)
RESPONSE=$(curl -sS -X POST "${API_URL}/enviar-mensagem" \
    -H "Content-Type: application/json" \
    --max-time 15 \
    -d "{\"id\":\"${WHATSAPP_ID}\",\"mensagem\":$(printf '%s' "$TEXT" | jq -Rs .)")

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "Erro: falha ao contatar a API WhatsApp (curl exit=$EXIT_CODE)" >&2
    exit $EXIT_CODE
fi

echo "$RESPONSE"
exit 0