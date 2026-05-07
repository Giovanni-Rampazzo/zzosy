#!/bin/bash
# ZZOSY backup automatico do MySQL
# Roda 1x/dia (via launchd em ~/Library/LaunchAgents/com.zzosy.backup.plist)
# Politica: 7 daily + 4 weekly + 6 monthly = ~17 dumps
# Output: ~/Desktop/zzosy-backups/

set -e

# === CONFIG ===
DB_USER="root"
DB_PASS="zzosy2026"
DB_HOST="localhost"
DB_PORT="3306"
DB_NAME="zzosy"

MYSQL_BIN="/usr/local/mysql/bin"
BACKUP_DIR="$HOME/Desktop/zzosy-backups"
LOG_FILE="$BACKUP_DIR/backup.log"

# === SETUP ===
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/monthly"
exec >> "$LOG_FILE" 2>&1

echo "----- $(date '+%Y-%m-%d %H:%M:%S') -----"

# === DUMP ===
TIMESTAMP=$(date '+%Y-%m-%d_%H%M%S')
DAY_OF_WEEK=$(date '+%u')   # 1=segunda, 7=domingo
DAY_OF_MONTH=$(date '+%d')

DAILY_FILE="$BACKUP_DIR/daily/zzosy_${TIMESTAMP}.sql.gz"

echo "Fazendo dump pra $DAILY_FILE..."

"$MYSQL_BIN/mysqldump" \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --user="$DB_USER" \
  --password="$DB_PASS" \
  --single-transaction \
  --routines \
  --triggers \
  --add-drop-database \
  --databases "$DB_NAME" \
  2>/dev/null \
  | gzip > "$DAILY_FILE"

if [ ! -s "$DAILY_FILE" ]; then
  echo "ERRO: dump vazio. Abortando."
  rm -f "$DAILY_FILE"
  exit 1
fi

DUMP_SIZE=$(du -h "$DAILY_FILE" | cut -f1)
echo "Dump diario OK: $DAILY_FILE ($DUMP_SIZE)"

# === WEEKLY: copia se for domingo ===
if [ "$DAY_OF_WEEK" = "7" ]; then
  WEEKLY_FILE="$BACKUP_DIR/weekly/zzosy_week_${TIMESTAMP}.sql.gz"
  cp "$DAILY_FILE" "$WEEKLY_FILE"
  echo "Backup semanal criado: $WEEKLY_FILE"
fi

# === MONTHLY: copia se for dia 1 ===
if [ "$DAY_OF_MONTH" = "01" ]; then
  MONTHLY_FILE="$BACKUP_DIR/monthly/zzosy_month_${TIMESTAMP}.sql.gz"
  cp "$DAILY_FILE" "$MONTHLY_FILE"
  echo "Backup mensal criado: $MONTHLY_FILE"
fi

# === LIMPEZA ===
# Mantem 7 daily, 4 weekly, 6 monthly. find -mtime conta dias.
find "$BACKUP_DIR/daily"   -name "zzosy_*.sql.gz" -type f -mtime +7   -delete
find "$BACKUP_DIR/weekly"  -name "zzosy_*.sql.gz" -type f -mtime +30  -delete
find "$BACKUP_DIR/monthly" -name "zzosy_*.sql.gz" -type f -mtime +200 -delete

DAILY_COUNT=$(find "$BACKUP_DIR/daily" -name "*.sql.gz" -type f | wc -l | tr -d ' ')
WEEKLY_COUNT=$(find "$BACKUP_DIR/weekly" -name "*.sql.gz" -type f | wc -l | tr -d ' ')
MONTHLY_COUNT=$(find "$BACKUP_DIR/monthly" -name "*.sql.gz" -type f | wc -l | tr -d ' ')
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

echo "Estado: $DAILY_COUNT diarios + $WEEKLY_COUNT semanais + $MONTHLY_COUNT mensais ($TOTAL_SIZE total)"
echo "OK"
