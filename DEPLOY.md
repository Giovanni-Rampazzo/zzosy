# Deploy ZZOSY — Railway

Guia de deploy do ZZOSY na Railway. Cobre staging + prod.

## 1. Setup inicial (uma vez por ambiente)

### 1.1. Criar projeto Railway
1. https://railway.com/new → "Deploy from GitHub repo" → `Giovanni-Rampazzo/zzosy`
2. Branch: `main` (prod) ou `staging` (staging)
3. Railway detecta `nixpacks.toml` + `railway.json` automaticamente.

### 1.2. Adicionar MySQL plugin
1. Project → "+ New" → Database → MySQL
2. Anotar `MYSQL_URL` no painel Variables do MySQL service.

### 1.3. Configurar Volume pra uploads
**Crítico**: containers Railway são efêmeros — sem volume, uploads somem a cada deploy.

1. App service → Settings → Volumes
2. Mount path: `/app/apps/web/public/uploads`
3. Size: 10GB inicial (escalável).

Quando migrar pra S3/R2 (PROD-07): trocar `STORAGE_DRIVER=s3` + remover volume.

### 1.4. Setar Environment Variables
No app service → Variables, adicionar:

```
DATABASE_URL=<copia do MySQL plugin: ${{MySQL.MYSQL_URL}}>
NEXTAUTH_URL=https://<seu-dominio-railway>.up.railway.app
NEXTAUTH_SECRET=<openssl rand -base64 32>
NODE_ENV=production
STORAGE_DRIVER=local

# Quando tiver:
# RESEND_API_KEY=...
# SENTRY_DSN=...
# STRIPE_SECRET_KEY=...
# STRIPE_WEBHOOK_SECRET=...
# UPSTASH_REDIS_REST_URL=...
# UPSTASH_REDIS_REST_TOKEN=...
```

`lib/env.ts` valida no boot — se faltar algo crítico, o container crasha cedo (ao invés de 500 em runtime).

### 1.5. Custom domain (opcional)
1. App service → Settings → Networking → "Custom Domain"
2. Adicionar `app.zzosy.com` (ou similar)
3. Configurar CNAME `app.zzosy.com → <railway-domain>.up.railway.app` no DNS.
4. **Lembrar**: atualizar `NEXTAUTH_URL` pra o domínio custom.

## 2. Deploy

Push pra branch configurada (main ou staging) → Railway auto-build + deploy.

```bash
git push origin main  # deploy prod
git push origin staging  # deploy staging
```

`npm start` roda `prisma migrate deploy` antes do `next start` — migrations aplicam toda inicialização (idempotente).

## 3. Verificar saúde

```bash
curl https://<dominio>/api/health
```

Espera-se:
```json
{
  "status": "ok",
  "ts": "...",
  "nodeEnv": "production",
  "checks": {
    "db": { "ok": true, "ms": ... },
    "storage": { "ok": true, "driver": "local" }
  }
}
```

Status 503 = algum check falhou (DB, storage).

## 4. Logs

`railway logs --service web` — ou painel Railway. Quando PROD-10 (Pino + log aggregator) estiver pronto, logs vão pro Axiom/Logtail também.

## 5. Rollback

Railway mantém histórico de deploys:
1. Deployments tab → escolher deploy anterior → "Redeploy"
2. OU `git revert <hash> && git push origin main`

⚠️ **Migrations não revertem automaticamente**. Se um deploy mudou schema (DROP COLUMN, etc.), rollback de código + downgrade manual da migration via:
```bash
npm run db:migrate:status  # ver estado
# escrever DOWN migration manual
```

Por enquanto, todas migrations são **additive** (zero risco rollback). Migrations destrutivas: avaliar 1-a-1.

## 6. Backup

Railway snapshot diário automático pro MySQL plugin (configurar em Settings → Backups).

Recomendação: dump manual semanal:
```bash
railway run mysqldump --all-databases > backup-$(date +%F).sql
```

(PROD-06: setup cron de backup off-site — pendente.)

## 7. Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| 503 no /api/health | DB unreachable ou volume sem permissão | Checar logs |
| Build falha "prisma generate" | Schema sem permissão de leitura | `chmod 644 apps/web/prisma/schema.prisma` |
| Migrations stuck | Race entre deploys | `railway run npm run db:migrate:status` |
| Uploads somem após deploy | Volume não montado | Settings → Volumes |
| OAuth callbacks falham | `NEXTAUTH_URL` errado | Atualizar pra domínio real |

## 8. Próximos passos PROD

Status detalhado no `ZZOSY-sistema.md` seção "ROADMAP PRODUÇÃO". Bloqueadores hard ainda pendentes:

- PROD-03: Email transacional (Resend)
- PROD-05: Stripe billing real
- PROD-07: CDN
- PROD-08: Rate limiting
- PROD-10: Logs estruturados
