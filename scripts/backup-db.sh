#!/usr/bin/env bash
set -e

# ==============================================================================
# DMS Database Backup Script (AES-256 Encrypted + SHA-256 Checksum)
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
BACKUP_FILENAME="dms_db_backup_${TIMESTAMP}.sql.gz.enc"
CHECKSUM_FILENAME="dms_db_backup_${TIMESTAMP}.sha256"

BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"
CHECKSUM_PATH="${BACKUP_DIR}/${CHECKSUM_FILENAME}"

ENCRYPTION_KEY="${BACKUP_ENCRYPTION_KEY}"

if [ -z "$ENCRYPTION_KEY" ]; then
  echo "Error: BACKUP_ENCRYPTION_KEY environment variable is required."
  exit 1
fi

DB_USER="${POSTGRES_USER:-dms_user}"
DB_NAME="${POSTGRES_DB:-distribution_db}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"

echo "Starting PostgreSQL database backup for ${DB_NAME}..."

PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:"$ENCRYPTION_KEY" -out "$BACKUP_PATH"

# Generate SHA-256 checksum
sha256sum "$BACKUP_PATH" | awk '{print $1}' > "$CHECKSUM_PATH"

echo "Backup completed successfully:"
echo "Archive: $BACKUP_PATH"
echo "Checksum: $CHECKSUM_PATH"
