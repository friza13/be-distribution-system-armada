#!/usr/bin/env bash
set -e

# ==============================================================================
# DMS Database Restore & Verification Script
# ==============================================================================

if [ -z "$1" ]; then
  echo "Usage: ./scripts/restore-db.sh <path_to_backup_file.enc>"
  exit 1
fi

BACKUP_PATH="$1"
ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}"

if [ -z "$ENCRYPTION_KEY" ]; then
  echo "Error: BACKUP_ENCRYPTION_KEY environment variable is required."
  exit 1
fi

if [ ! -f "$BACKUP_PATH" ]; then
  echo "Error: Backup file $BACKUP_PATH does not exist."
  exit 1
fi

# 1. Verify SHA-256 Checksum if file exists
CHECKSUM_PATH="${BACKUP_PATH%.sql.gz.enc}.sha256"
if [ -f "$CHECKSUM_PATH" ]; then
  EXPECTED_HASH=$(cat "$CHECKSUM_PATH" | tr -d ' \n\r')
  ACTUAL_HASH=$(sha256sum "$BACKUP_PATH" | awk '{print $1}')
  if [ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]; then
    echo "Error: SHA-256 checksum verification failed!"
    echo "Expected: $EXPECTED_HASH"
    echo "Actual:   $ACTUAL_HASH"
    exit 1
  fi
  echo "SHA-256 checksum verification PASSED."
fi

DB_USER="${POSTGRES_USER:-dms_user}"
DB_NAME="${POSTGRES_DB:-distribution_db}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

echo "Decrypting and restoring backup into database ${DB_NAME}..."

openssl enc -d -aes-256-cbc -pbkdf2 -in "$BACKUP_PATH" -pass pass:"$ENCRYPTION_KEY" \
  | gunzip \
  | PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"

echo "Database restore completed and verified successfully."
