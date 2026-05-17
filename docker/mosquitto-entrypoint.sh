#!/bin/sh
set -eu

CONF_DIR=/mosquitto/config
mkdir -p "$CONF_DIR"

USERNAME="${MQTT_USERNAME:-smartpark}"
PASSWORD="${MQTT_PASSWORD:-}"

if [ -z "$PASSWORD" ]; then
  echo "MQTT_PASSWORD is required when anonymous access is disabled" >&2
  exit 1
fi

mosquitto_passwd -b -c "$CONF_DIR/passwd" "$USERNAME" "$PASSWORD"

cat > "$CONF_DIR/mosquitto.conf" <<EOF
listener 1883
allow_anonymous false
password_file $CONF_DIR/passwd
persistence false

listener 9001
protocol websockets
allow_anonymous false
password_file $CONF_DIR/passwd
EOF

exec mosquitto -c "$CONF_DIR/mosquitto.conf"
