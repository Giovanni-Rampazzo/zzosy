# MANUAL ZZOSY

Manual de operação do projeto **ZZOSY** (also written `zzosy`). Foco em: o que é, como roda, o que mexe onde, e **quais credenciais você precisa manter pra ter acesso total**.

---

## 1. O que é

Plataforma para gerar peças visuais a partir de uma **Matriz** (key vision) editada num canvas Fabric.js. Importa PSD, gera múltiplas variações (formatos de mídia), exporta em PSD/PNG/JPG/PDF e monta apresentação PPTX. Multi-tenant com Stripe billing.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16.1.6 (App Router) + React 18 + TailwindCSS |
| Editor canvas | Fabric.js 6 |
| Backend | Next.js API routes (Node 18+) |
| ORM | Prisma 5.10 |
| Banco | MySQL (DATABASE_URL) |
| Auth | NextAuth 4.24 (Credentials + JWT) |
| Billing | Stripe 14.25 |
| PSD | `ag-psd` 18 |
| PPTX | `pptxgenjs` 4 |
| Monorepo | npm workspaces + Turbo 1.13 |
| Deploy | Vercel (frontend) — DB via Railway/externo |

---

## 3. Estrutura do repo

```
zzosy/
├── apps/
│   └── web/                 # App único Next.js
│       ├── app/             # Rotas (App Router)
│       │   ├── (auth)/      # /login, /register
│       │   ├── api/         # 49+ endpoints
│       │   ├── campaigns/   # /campaigns, /campaigns/[id]
│       │   ├── editor/      # KeyVisionEditor (matriz)
│       │   ├── pieces/      # Lista + detalhe de peças
│       │   ├── clients/     # Clientes
│       │   ├── deliveries/  # Entregas/ZIP
│       │   ├── medias/      # Cadastro de formatos
│       │   ├── admin/       # Painel admin
│       │   └── dashboard/   # Home pós-login
│       ├── components/      # 25+ components React
│       ├── lib/             # 24 utilitários (export, fonts, masks…)
│       ├── prisma/          # schema.prisma + migrations
│       ├── public/uploads/  # Storage local (pré-R2)
│       ├── middleware.ts    # Proteção de rotas
│       └── .env             # **SECRETS** (ver §10)
├── packages/database/       # Prisma compartilhado (legacy?)
├── turbo.json
└── package.json             # Workspace root
```

---

## 4. Setup do zero (clone novo)

```
git clone git@github.com:Giovanni-Rampazzo/zzysy.git
cd zzosy
npm install
cp apps/web/.env.example apps/web/.env   # preenche valores reais (§10)
cd apps/web
npx prisma generate
npx prisma db push                       # cria tabelas no DB
npm run dev                              # http://localhost:3000
```

Pra popular MediaFormats default: `POST /api/seed` (depois do server subir).

---

## 5. Comandos do dia a dia

| Comando | Onde | O que faz |
|---|---|---|
| `npm run dev` | `apps/web/` | Dev server Next.js (porta 3000, ou 3001 se ocupada) |
| `npm run build` | `apps/web/` | `prisma generate && next build` |
| `npm run start` | `apps/web/` | Production server (após build) |
| `npm run lint` | qualquer nível | ESLint |
| `npx prisma studio` | `apps/web/` | UI gráfica do DB (porta 5555) |
| `npx prisma db push` | `apps/web/` | Aplica schema sem migration formal (dev) |
| `npx prisma migrate dev` | `apps/web/` | Cria migration nova |
| `npx prisma migrate deploy` | `apps/web/` | Aplica migrations em prod |
| `npx tsc --noEmit` | `apps/web/` | Type-check sem build |
| `rm -rf .next` | `apps/web/` | Limpa cache (resolve travamentos do dev) |

**Conflito de porta**: se 3000 estiver em uso, Next sobe em 3001 automaticamente. Pra matar processo antigo: `lsof -ti:3000 | xargs kill`.

---

## 6. Modelo de dados (Prisma)

`apps/web/prisma/schema.prisma` — MySQL.

| Model | Papel |
|---|---|
| **Tenant** | Isola dados por organização. Tudo (Users, Clients, MediaFormats) pertence a um Tenant. |
| **User** | Login (email/senha bcrypt). Tem role (ADMIN default) e flag `blocked`. |
| **Client** | Cliente do tenant. Tem logo, fontes, paleta. |
| **Campaign** | Campanha do client. Carrega PSD master + status. |
| **CampaignAsset** | Elemento da matriz (TEXT ou IMAGE). Tem `content` (spans/text), `imageUrl`, `lastOverride` (template visual). |
| **SmartObjectFile** | Bytes originais de smart objects do PSD (round-trip sem perda). |
| **KeyVision** | Matriz da campanha. JSON do Fabric.js + `layers` (posições/overrides per-asset). 1:1 com Campaign. |
| **Piece** | Peça gerada a partir da matriz, com formato/dimensão própria. Tem `data` (JSON) e thumb. |
| **MediaFormat** | Padrão de tamanho (Instagram Stories, Facebook Feed…). |
| **Delivery** | Pacote ZIP de peças exportadas para o cliente. |
| **Account/Session/VerificationToken** | NextAuth (mas a auth real é via JWT/Credentials). |

### Conceitos importantes

- **Asset.content** = caracteres "raw" (sem `\n`). É a fonte da verdade do texto.
- **lastOverride** = template visual do asset (cor, fonte, tamanho, styles per-char). Aplicado quando uma nova peça é gerada.
- **layer.overrides** = overrides per-instância (matriz tem o seu, cada peça tem o seu). Sobrescreve o asset/lastOverride.
- **layer.overrides.text** = guarda quebras de linha (`\n`) locais. Sem `\n`, nem é gravado (texto vem do asset).

---

## 7. Fluxos principais

### Criação de campanha
1. `/dashboard` → escolhe Client → "Nova Campanha".
2. `POST /api/campaigns` cria com status STANDBY.

### Importar PSD
1. `/campaigns/[id]/assets` → "Importar PSD".
2. `POST /api/campaigns/[id]/import-psd` (`ag-psd` parse).
3. Cria CampaignAssets + KeyVision com layers posicionados.
4. Salva master em `/public/uploads/campaigns/[id]/master-*.psd`.

### Editar matriz
1. `/editor?campaignId=[id]`.
2. Canvas Fabric.js 1920×1080. Edita texto/imagem inline.
3. `text:editing:exited` propaga chars pro asset (`updateAssetContent`).
4. Quebras (`\n`) ficam locais em `layer.overrides.text` da matriz.

### Gerar peças
1. No editor → "Gerar peças" → `GeneratePiecesModal`.
2. Seleciona MediaFormats → renderiza previews adaptados.
3. `POST /api/pieces` em loop. Peça herda `overrides.text` da matriz (incluindo `\n`).

### Exportar
- **PSD**: `lib/exportPiece.ts` → `ag-psd`.
- **PNG/JPG**: Fabric StaticCanvas → `toDataURL`.
- **PDF**: `pdfkit`.
- **PPTX**: `lib/generatePresentation.ts` → `pptxgenjs` (slides cover/segments/pieces/thanks).

### Entrega
1. Seleciona peças → `DeliveryDialog`.
2. Cliente monta ZIP via `buildZip` e sobe via `POST /api/deliveries`.

---

## 8. API routes (resumo)

**Auth**: `/api/auth/[...nextauth]`, `/api/register`
**Campanhas**: `/api/campaigns`, `/api/campaigns/[id]`, `/duplicate`, `/import-psd`, `/key-vision`, `/key-vision/thumbnail`
**Assets**: `/api/campaigns/[id]/assets`, `/api/campaigns/[id]/assets/[assetId]`, `/image`
**Peças**: `/api/pieces`, `/api/pieces/[id]`, `/thumbnail`, `/step-thumbnail`, `/duplicate`, `/import-psd`, `/segments`
**Mídias**: `/api/medias`, `/api/medias/[id]`
**Entregas**: `/api/deliveries`, `/api/deliveries/[id]`
**Clientes**: `/api/clients`, `/api/clients/[id]`
**Billing**: `/api/billing`, `/api/billing/cancel`, `/api/stripe/checkout`, `/api/webhooks/stripe`
**Admin**: `/api/admin/metrics`, `/api/admin/users`, `/api/admin/users/[id]`, `/api/admin/email`
**Utils**: `/api/upload`, `/api/seed` (popula MediaFormats), `/api/migrate` (header `X-Migrate-Secret`)

Lista completa: `find apps/web/app/api -name "route.ts" | sort`.

---

## 9. Components / Libs chave

| Component / Lib | Caminho | O que faz |
|---|---|---|
| `KeyVisionEditor.tsx` | `components/editor/` | Canvas Fabric.js da matriz/peça. Coração do editor. |
| `GeneratePiecesModal.tsx` | `components/editor/` | Geração de peças a partir da matriz. |
| `LayerPanel.tsx` / `MaskPanel.tsx` / `PropertiesPanel.tsx` | `components/editor/` | Painéis do editor. |
| `PsdImporter.tsx` | `components/campaign/` | Upload PSD + parse client-side. |
| `Slides.tsx` | `components/presentation/` | Apresentação web (mirror do PPTX). |
| `exportPiece.ts` | `lib/` | PSD/PNG/JPG/PDF export + montagem de ZIP. |
| `generatePresentation.ts` | `lib/` | Builder PPTX. |
| `applyMaskToFabric.ts` | `lib/` | Aplica masks raster/vector no canvas. |
| `auth.ts` | `lib/` | Config NextAuth. |
| `prisma.ts` | `lib/` | Cliente Prisma singleton. |
| `migrateStyles.ts` | `lib/` | Migra `overrides.styles` per-char quando asset text muda. |

---

## 10. 🔑 CREDENCIAIS E ACESSOS (CRÍTICO — guardar tudo)

### 10.1 Variáveis de ambiente (em `apps/web/.env`)

| Variável | Onde achar / gerar | Notas |
|---|---|---|
| `DATABASE_URL` | Painel Railway (ou onde o MySQL está hospedado) | Formato: `mysql://user:pass@host:port/db` |
| `NEXTAUTH_SECRET` | Gerar com `openssl rand -base64 32` | Qualquer string aleatória forte |
| `NEXTAUTH_URL` | Em prod: URL do site; dev: `http://localhost:3000` | |
| `STRIPE_SECRET_KEY` | Dashboard Stripe → Developers → API keys | `sk_test_…` ou `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Dashboard Stripe → Webhooks | `whsec_…` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe → API keys | `pk_test_…` ou `pk_live_…` (público) |
| `NEXT_PUBLIC_APP_URL` | URL pública | |
| `NEXT_PUBLIC_APP_NAME` | "ZZOSY" | |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_URL` | Cloudflare R2 dashboard | **Hoje placeholder** — uploads ainda são locais |
| `MIGRATE_SECRET` | Você define | Header `X-Migrate-Secret` em `/api/migrate` (default: `zzosy-migrate-2026`) |

**⚠️ Faz backup do `apps/web/.env` num cofre seguro (1Password / Bitwarden / iCloud Keychain).** Sem ele, deploy novo não roda.

### 10.2 Acessos externos a guardar

| Serviço | O que guardar | Pra que serve |
|---|---|---|
| **GitHub** | Conta `Giovanni-Rampazzo`, repo `zzosy`. Manter ao menos: senha + 2FA (TOTP backup codes) + 1 SSH key registrada | Source of truth do código |
| **SSH key local** | `~/.ssh/id_ed25519` + `~/.ssh/id_ed25519.pub` (criada nessa sessão, registrada no GitHub como "IMAC") | Push/pull via SSH sem digitar senha |
| **PAT GitHub (opcional)** | Caso queira HTTPS auth — gerar em github.com/settings/tokens com scope `repo`. Salvar imediatamente (só aparece 1 vez) | Workflows que não usam SSH |
| **Vercel** | Login (provavelmente via GitHub OAuth). Projeto `zzysy-web`. Env vars duplicadas lá. | Deploy do frontend |
| **Railway (ou DB host)** | Login + projeto que hospeda o MySQL. `DATABASE_URL` aparece lá. | Banco de dados em prod |
| **Stripe** | Conta da empresa. Keys (test e live) + webhook signing secret. Pages: Developers → API keys + Webhooks | Cobranças de assinatura |
| **Cloudflare** | Conta + bucket R2 `zzosy-assets` quando migrar uploads do local | Storage de mídia em prod |
| **Domínio** | Registrar onde o domínio está (registro.br / GoDaddy / Cloudflare). DNS aponta pra Vercel. | URL pública |
| **Gmail (giovanni.rampazzo@gmail.com)** | Recuperação de quase todas as contas acima. **2FA + códigos de backup essenciais.** | Bloqueio aqui = perda em cascata |

### 10.3 Backup mínimo recomendado

Coloca num cofre (1Password vault dedicado):

1. Snapshot do `apps/web/.env` (cópia exata, atualizar quando girar keys).
2. Lista de URLs + logins/senhas dos serviços da §10.2.
3. **Backup codes de 2FA** de: Gmail, GitHub, Vercel, Stripe.
4. Cópia da chave SSH privada `id_ed25519` (não é estritamente necessária — pode-se gerar nova e cadastrar — mas evita ir manualmente em cada serviço caso troque de máquina).
5. Export do schema do banco: `mysqldump $DATABASE_URL > zzosy-schema-backup-YYYY-MM-DD.sql` (rotina recomendada: semanal).

---

## 11. Storage / uploads

Hoje **local**, em `apps/web/public/uploads/`:

```
uploads/
├── campaigns/[id]/
│   ├── master-*.psd          # PSD original
│   ├── layer-*.png           # Previews de layers
│   ├── *.jpeg                # Thumb do KV
│   └── smart/[guid].[ext]    # Smart objects preservados
├── step-thumbs/              # Thumbs de step por peça
├── deliveries/[id]/          # ZIPs entregues
└── *.jpeg                    # Thumbs de peça
```

Headers: `no-cache` em `/uploads/*` (`next.config.js`) — força revalidação. URLs adicionam `?v=<updatedAt>` pra invalidar.

**Migração para R2**: env vars já existem (§10.1), implementação no `/api/upload` ainda usa local. Quando migrar, trocar `lib` que escreve em FS por SDK R2 (`@aws-sdk/client-s3` compatível).

---

## 12. Deploy

**Vercel** (frontend):
- Push em `main` → deploy automático.
- Env vars copiadas no painel Vercel (não vão pelo `.env` do repo).
- Build: `prisma generate && next build` (já no `package.json`).

**Banco** (Railway/externo):
- Migrations via `npx prisma migrate deploy` (rodar uma vez por release com mudança de schema).
- Conexão pela `DATABASE_URL` do Vercel.

**Domínio**: configurado no painel Vercel apontando o CNAME do DNS registrar.

---

## 13. Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| `next dev` falha "Unable to acquire lock" | Outro dev rodando | `ps aux \| grep "next dev"` → `kill <PID>` |
| Card de peça mostra thumb antiga | Asset mudou mas thumb não regenerou | Abre a peça no editor (regenera) ou `POST /api/pieces/[id]/thumbnail` |
| Edição em `/assets` não propaga pra peças | Peças têm `overrides.text` próprio (com `\n`) | Esperado — peças são independentes; só char-edit propaga via `migrateOverrideText` |
| `prisma generate` reclama | Schema mudou + cliente desatualizado | `rm -rf node_modules/.prisma && npx prisma generate` |
| Login não funciona após restart | `NEXTAUTH_SECRET` mudou | Restaurar valor original do `.env` |
| Build OK em dev, quebra em prod | Faltou env var no Vercel | Conferir painel Vercel → Settings → Environment Variables |

---

## 14. Convenções

- **Branch principal**: `main` (deploy automático).
- **Branches de feature**: prefixo `claude/...` (sessões de pair com Claude Code).
- **Commits**: convencionais (`fix:`, `feat:`, `chore:`). Sempre criar commit novo em vez de amend.
- **Code style**: sem comentários explicando o "o quê" — código fala. Comentários só pro "porquê" não-óbvio. ESLint ativo.

---

## 15. Próximos passos sugeridos

- [ ] Migrar `/api/upload` pra Cloudflare R2 (env vars já existem).
- [ ] Cron de cleanup em `/public/uploads/` para arquivos órfãos (campaigns/pieces deletados deixam lixo).
- [ ] Backup automatizado do DB (Railway suporta snapshots).
- [ ] CI rodando type-check + lint no PR (GitHub Actions).
- [ ] Documentar políticas de quotas dos planos Stripe (`lib/plans-config.ts`).

---

*Última revisão: 2026-05-15. Atualizar este manual quando schema do banco ou fluxos críticos mudarem.*
