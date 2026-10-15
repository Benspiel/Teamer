#!/bin/sh
# Crew – Start von PocketBase im Container.
#
# 1. Migrationen anwenden (Collections, Rules, Kanäle, Rate-Limits).
# 2. Superuser aus .env anlegen bzw. aktualisieren:
#      pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD"
#    (wird übersprungen, wenn die Variablen leer sind).
# 3. PocketBase starten.
set -eu

PB=/usr/local/bin/pocketbase

set -- "$@" \
  --dir=/pb/pb_data \
  --migrationsDir=/pb/pb_migrations \
  --hooksDir=/pb/pb_hooks \
  --publicDir=/pb/pb_public \
  --dev=false

# Einstellungen (SMTP-/S3-Zugänge) in der DB verschlüsseln, wenn ein Schlüssel gesetzt ist.
if [ -n "${PB_ENCRYPTION_KEY:-}" ]; then
  set -- "$@" --encryptionEnv=PB_ENCRYPTION_KEY
fi

if [ "${1:-}" = "serve" ]; then
  # Erst die gemeinsamen Flags ohne "serve" und "--http…" für die Vorbereitungsbefehle.
  common=""
  for arg in "$@"; do
    case "$arg" in
      serve|--http=*|--https=*|--origins=*|--hooksWatch=*|--automigrate=*) ;;
      *) common="$common $arg" ;;
    esac
  done

  # shellcheck disable=SC2086
  "$PB" migrate up $common

  if [ -n "${PB_SUPERUSER_EMAIL:-}" ] && [ -n "${PB_SUPERUSER_PASSWORD:-}" ]; then
    # shellcheck disable=SC2086
    "$PB" superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" $common >/dev/null
    echo "Superuser ${PB_SUPERUSER_EMAIL} angelegt/aktualisiert."
  fi

  set -- "$@" --hooksWatch=false --automigrate=false
  if [ -n "${APP_URL:-}" ]; then
    set -- "$@" --origins="$APP_URL"
  fi
fi

exec "$PB" "$@"
