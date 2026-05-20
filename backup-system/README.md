# ZZOSY Backup System

Sistema de backup automático do MySQL local, integrado ao macOS via `launchd`.

## O que faz

- Roda **1× por dia às 3h da manhã**
- Se Mac estiver desligado, roda assim que ligar
- Faz dump comprimido (`.sql.gz`) do banco `zzosy`
- Mantém 7 backups diários + 4 semanais + 6 mensais
- Apaga automaticamente os antigos
- Salva em `~/Desktop/zzosy-backups/`

## Estrutura dos backups

```
~/Desktop/zzosy-backups/
├── daily/                 # últimos 7 dias
│   ├── zzosy_2026-05-06_030000.sql.gz
│   └── ...
├── weekly/                # últimos 30 dias (1 por semana, domingo)
│   └── zzosy_week_*.sql.gz
├── monthly/               # últimos ~6 meses (1 por mês, dia 1)
│   └── zzosy_month_*.sql.gz
├── backup.log             # log de execuções
└── launchd.log            # output bruto do launchd
```

## Instalação (UMA VEZ SÓ)

Execute estes comandos no terminal:

```bash
cd ~/Desktop/BACKEND/zzosy/backup-system

# 1. Da permissão de execução ao script
chmod +x backup.sh

# 2. Cria o plist com os caminhos absolutos certos
PLIST_DEST="$HOME/Library/LaunchAgents/com.zzosy.backup.plist"
mkdir -p "$HOME/Library/LaunchAgents"

sed -e "s|BACKUP_SCRIPT_PATH|$HOME/Desktop/BACKEND/zzosy/backup-system/backup.sh|g" \
    -e "s|BACKUP_DIR_PATH|$HOME/Desktop/zzosy-backups|g" \
    com.zzosy.backup.plist > "$PLIST_DEST"

# 3. Cria a pasta de backup
mkdir -p ~/Desktop/zzosy-backups

# 4. Carrega o agente no launchd
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

# 5. Testa rodando o backup AGORA (não espera as 3h)
./backup.sh

# Se tudo deu certo, vai aparecer um arquivo em ~/Desktop/zzosy-backups/daily/
ls -lh ~/Desktop/zzosy-backups/daily/
```

## Verificar se está agendado

```bash
launchctl list | grep zzosy
```

Deve aparecer algo como `0	0	com.zzosy.backup`. Se aparecer, tá rodando.

## Desinstalar

```bash
launchctl unload ~/Library/LaunchAgents/com.zzosy.backup.plist
rm ~/Library/LaunchAgents/com.zzosy.backup.plist
```

## Restaurar um backup

```bash
# Descomprime + restaura no banco zzosy (CUIDADO: sobrescreve dados atuais)
gunzip -c ~/Desktop/zzosy-backups/daily/zzosy_2026-05-06_030000.sql.gz | \
  /usr/local/mysql/bin/mysql -u root -pzzosy2026 zzosy
```

## Logs

```bash
tail -f ~/Desktop/zzosy-backups/backup.log
```

## Tamanho esperado

Banco zzosy hoje (~1MB de dados): cada dump comprimido vai ter ~50-200KB.
17 backups totais ≈ 1-3MB. Espaço irrelevante.

Quando virar produção (vários tenants, milhares de peças), os dumps vão crescer. 
Aí é hora de configurar offsite (S3 / Backblaze) — me lembre.
