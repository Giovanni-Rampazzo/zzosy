# ZZOSY — Sistema

SaaS multi-tenant de **automação de layout** para campanhas publicitárias.
Arquitetura: agência (tenant) → cliente → campanha → key vision (matriz) → peças.

---

## 🎯 CAPÍTULO ATUAL EM IMPLEMENTAÇÃO — Global Asset Management (GAM) + Cartridges

**Conceito:** biblioteca de assets por cliente (modelo Figma — main component + instances) **+ Cartridges**: pacotes exportáveis/importáveis (.zzosy ZIP) que re-skinnam campanhas inteiras automaticamente.

### Plano TRAVADO (sessão 2026-05-24 madrugada, user dormindo, autonomous build)

**Decisões alinhadas:**
1. **Modelo Figma**: library asset = main component. CampaignAsset criado dele guarda `libraryAssetId` FK + `slotKey` herdado. Editar library propaga pra TODAS instâncias preservando overrides per-peça (text local com \n, cor per-char, etc).
2. **Detach**: botão "Detach" em qualquer instância nulifica `libraryAssetId` → asset vira independente.
3. **Update notification**: badge "Update available" na instância quando library mudou após a criação.
4. **Smart Objects**: SIM, com FK SHARED ao `ClientSmartObjectFile`. Apagar library asset que tem instances = warning "X campanhas usam".
5. **Todos os tipos**: TEXT/IMAGE/SHAPE/SMART_OBJECT.
6. **Migration legacy**: botão bulk "Publicar todos da campanha no library" + botão por asset.
7. **UI**: subnav "Library" dentro de `/clients/[id]`. Modal "Importar do Library" em `/campaigns/[id]/assets`.
8. **Tags**: array free-text.
9. **Sem quota**, qualquer ADMIN pode editar.
10. **Naming**: pre-fill com `asset.label`, editável.
11. **Cartridge**:
    - **Match**: por `slotKey` explícito (Figma-style robust). Fallback: modal manual mapping quando slot não auto-bate.
    - **Escopo**: aplicável em QUALQUER campanha (slots não-match: skip + warning).
    - **UI**: botão "Aplicar cartucho" em `/campaigns/[id]` header + "Import cartridge" em `/clients/[id]/library`.
    - **Formato**: `.zzosy` (ZIP internamente: `manifest.json` + `/assets/` binários). Extensão proprietária + interop preservada.

### Modelo de dados

```prisma
model ClientLibraryAsset {
  id            String   @id @default(cuid())
  clientId      String
  name          String   // user-defined ("Logo Sicredi")
  slotKey       String?  // "logo-primary", "headline-text" — match em cartridges. Optional pra MVP.
  type          String   // TEXT, IMAGE, SHAPE, SMART_OBJECT
  content       String?  @db.LongText  // mesma estrutura de CampaignAsset.content
  lastOverride  Json?    // template visual (cor, fonte, etc)
  imageUrl      String?  @db.LongText
  thumbnailUrl  String?  @db.LongText
  smartObjectId String?
  tags          Json?    // ["logo", "marca-principal"]
  notes         String?  @db.Text
  meta          Json?    // dimensões, cores extras
  version       Int      @default(1)  // bump em cada edit; instances usam pra "update available" detection
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  createdBy     String?
  client        Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  smartObject   ClientSmartObjectFile? @relation(fields: [smartObjectId], references: [id], onDelete: SetNull)
  instances     CampaignAsset[]

  @@index([clientId, type])
  @@index([clientId, updatedAt])
  @@index([slotKey])
}

model ClientSmartObjectFile {
  // Mirror de SmartObjectFile mas com clientId (não campaignId).
  // Bytes embedded (PSB/AI/PDF/PNG/JPG) sobrevivem a apagar campanhas.
  id            String   @id @default(cuid())
  clientId      String
  guid          String   @db.VarChar(64)
  filePath      String   @db.LongText
  mime          String   @db.VarChar(100)
  originalName  String   @db.VarChar(500)
  sizeBytes     Int
  width         Int?
  height        Int?
  createdAt     DateTime @default(now())
  client        Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  libraryAssets ClientLibraryAsset[]

  @@index([clientId])
  @@index([guid])
}

// CampaignAsset ganha:
//   libraryAssetId      String?    @db.VarChar(30)
//   libraryAssetVersion Int?       // versao do library ao instanciar; <library.version = "update available"
//   libraryAssetDetached Boolean?  // user clicou Detach
//   slotKey             String?    // herdado da library OU manual
//
// Index: @@index([libraryAssetId])
```

### Cartucho (.zzosy) — formato

```
arquivo.zzosy  (ZIP)
├── manifest.json        // metadata + slots[]
├── assets/
│   ├── {slotKey1}.png   // imagem do asset
│   ├── {slotKey2}.psb   // smart object binário
│   ├── ...
└── meta.json            // versão do formato, autor, data
```

`manifest.json`:
```json
{
  "format": "zzosy-cartridge-v1",
  "name": "Sicredi 2026 Q1",
  "createdAt": "2026-05-25T03:00:00Z",
  "assets": [
    {
      "slotKey": "logo-primary",
      "name": "Logo Sicredi Branco",
      "type": "SMART_OBJECT",
      "binary": "assets/logo-primary.psb",
      "thumbnail": "assets/logo-primary.thumb.png",
      "content": {...},
      "lastOverride": {...},
      "tags": ["logo", "primary"],
      "meta": {...}
    }
  ]
}
```

### Fluxo UX

#### 1. Salvar no library (campanha → library)
- Botão "Salvar no Library" em cada asset card de `/campaigns/[id]/assets`
- Modal: nome (pre-fill asset.label) + slotKey opcional + tags
- API: `POST /api/clients/[id]/library/assets` (com body do asset clonado)
- Toast: "Salvo na library de {cliente}"

#### 2. Adicionar do library → campanha (instanciar)
- Botão "+ Do Library" no `/campaigns/[id]/assets` header
- Modal: lista assets do cliente, busca + filtro tipo/tag
- Click: cria `CampaignAsset` com `libraryAssetId = X` + `libraryAssetVersion = X.version` + `slotKey = X.slotKey`
- Asset card mostra badge "Library"

#### 3. Editar library → propagar (Figma sync)
- User edita asset em `/clients/[id]/library` → `library.version++`
- Backend trigger: para TODAS `CampaignAsset` com `libraryAssetId = X`:
  - Atualiza `content` + `lastOverride` (preservando layer overrides per-peça)
  - NÃO atualiza `libraryAssetVersion` ainda (espera user clicar "Update")
- UI: instâncias com `libraryAssetVersion < library.version` mostram badge "Update available"
- User clica Update → consolida (libraryAssetVersion = library.version)

**Decisão técnica**: o "preservar layer overrides per-peça" significa: editing library = update CampaignAsset.content (asset-level). Per-piece overrides em `piece.data.layers[].overrides` continuam intactos (text local, cor per-char). Igual o pipeline atual de update de asset funciona.

#### 4. Detach
- Botão "Detach from library" em CampaignAsset com libraryAssetId
- API: nulifica libraryAssetId + libraryAssetVersion + libraryAssetDetached=true
- Asset vira independente, edits futuros não propagam.

#### 5. Aplicar cartucho (cartridge → campanha)
- Botão "Aplicar cartucho" no header `/campaigns/[id]`
- Modal: lista cartuchos disponíveis (na library do cliente OU upload .zzosy file)
- Backend: parseia manifest.json + binários
- Auto-match por slotKey: cartridge.assets[i].slotKey == campaign.assets[j].slotKey → update content + lastOverride
- Slots não-encontrados na campanha: cria novos assets (com libraryAssetId)
- Slots existentes na campanha sem match no cartridge: skip + warning
- Conflitos/ambiguidade: modal manual mapping (cartridge slots vs campanha assets, user pareia)
- Apply: toast com diff ("3 assets atualizados, 1 criado, 2 skipped")

#### 6. Import/Export cartucho
- **Export** em `/clients/[id]/library`: botão "Export as cartridge" + checkbox dos assets a incluir + nome do cartridge → download .zzosy file
- **Import** em `/clients/[id]/library` OU `/campaigns/[id]`: upload .zzosy → parseia manifest → cria ClientLibraryAssets (se library import) OU aplica em campanha (se direct apply)

### URLs

| Endpoint | Método | Função |
|---|---|---|
| `/clients/[id]/library` | page | Listagem + ações |
| `/clients/[id]/library/[assetId]` | page | Edit metadata |
| `/api/clients/[id]/library/assets` | GET | Listar com filtros |
| `/api/clients/[id]/library/assets` | POST | Criar (upload OR clone CampaignAsset) |
| `/api/clients/[id]/library/assets/[id]` | PATCH | Editar metadata |
| `/api/clients/[id]/library/assets/[id]` | PUT | Substituir content (bump version) |
| `/api/clients/[id]/library/assets/[id]` | DELETE | Apagar |
| `/api/clients/[id]/library/cartridge` | POST | Generate .zzosy (download) |
| `/api/clients/[id]/library/cartridge` | PUT | Import .zzosy upload |
| `/api/campaigns/[id]/assets/from-library` | POST | Clonar library → campaign |
| `/api/campaigns/[id]/assets/[assetId]/detach` | POST | Detach instance |
| `/api/campaigns/[id]/apply-cartridge` | POST | Apply .zzosy (com optional mapping override) |

### Storage

```
/uploads/clients/{clientId}/library/
├── images/          # imageUrl dos library assets
├── thumbs/          # thumbnails
└── smart/           # ClientSmartObjectFile binaries (PSB/AI/etc)
```

Separado de `/uploads/campaigns/{campaignId}/` pra não acoplar lifecycle.

### Sweep / ordem de implementação (autonomous build — concluído madrugada 2026-05-25)

1. ✅ Plan locked no MD (this section)
2. ✅ Schema Prisma — modelos `ClientLibraryAsset` + `ClientLibrarySmartObjectFile` + extensão de `CampaignAsset` com `libraryAssetId/libraryAssetVersion/libraryAssetDetached/slotKey`. **🚨 ACTION USER REQUERIDA**: rodar `cd apps/web && npx prisma db push` 1x (foi bloqueado pelo auto-mode classifier — proteção contra schema push autônomo). Prisma client já foi gerado local.
3. ✅ API endpoints CRUD library (`/api/clients/[id]/library/assets` GET/POST + `/[assetId]` GET/PATCH/PUT/DELETE)
4. ✅ Página `/clients/[id]/library` (grid + filtros tipo/busca + Apagar/Editar + Export/Import .zzosy)
5. ✅ Página edit metadata `/clients/[id]/library/[assetId]` (nome/slot/tags/notas)
6. ✅ Botão "↑ Library" per-asset em `/campaigns/[id]/assets` + "↑ Tudo p/ Library" bulk
7. ✅ Modal "+ Do Library" em `/campaigns/[id]/assets` (LibraryPickerModal)
8. ✅ Sync engine: PUT library asset → bump version + transaction propaga content/imageUrl/lastOverride pra todas instances NOT detached
9. ✅ GamBadgeBar per-row: badge "LIBRARY" + slot + botões Re-sync (↻) e Detach (⊘); "ex-library" se detached
10. ✅ Cartridge export `.zzosy` (JSZip) — `POST /api/clients/[id]/library/cartridge` retorna ZIP com manifest.json + binários
11. ✅ Cartridge import `.zzosy` — `PUT /api/clients/[id]/library/cartridge` parseia + persiste binaries em /uploads/clients/[id]/library/ + cria ClientLibraryAsset(s)
12. ✅ Apply cartridge `POST /api/campaigns/[id]/apply-cartridge` (multipart upload OU libraryAssetIds JSON). Match por slotKey, criar novos pros não-matched, suporte a mapping manual override.
13. ✅ Apply cartridge UI: `ApplyCartridgeButton` no header `/campaigns/[id]` — modal com upload .zzosy + atalho "aplicar todo library"
14. ✅ Link "Library" no header de `/clients/[id]` (botão secondary ao lado de "← Empresas")
15. ⚠️ Manual mapping modal (fallback ambiguidade) — backend já aceita `mapping` param, UI futura

### Pendente (próxima sessão)
- **🚨 USER ACTION CRÍTICA pós-acordar**: rodar `cd apps/web && npx prisma db push` (1 comando, ~15s, additive only — sem destrutivo)
- Manual mapping UI modal (backend aceita override, falta UX)
- "Update available" detection client-side (atualmente o botão Re-sync existe mas badge "tem update novo" não aparece automático — precisa endpoint que retorne `libraryCurrentVersion` em cada asset)
- Migration de campanhas legacy via UI explícita (botão "Tudo p/ Library" já cobre o caso bulk)
- Subnav unified (ex: tabs Library/Campanhas/Edit dentro do cliente)
- Cartridge versioning / changelog
- Cross-tenant share via link público

### Bypass se `db push` falhar
Schema mudou apenas com tabelas NOVAS + colunas NOVAS opcionais em CampaignAsset (libraryAssetId, libraryAssetVersion, libraryAssetDetached, slotKey — todas nullable). Zero risco a data existente. Se `db push` der algum prompt sobre destructive: NÃO confirmar, mandar log que eu olho.

### 🔴 CRÍTICO — bloqueia uso

**1. DB push pendente** — schema em `schema.prisma` ainda não na DB. Toda rota GAM 500 até rodar `cd apps/web && npx prisma db push`. Auto-mode classifier bloqueou push autônomo (proteção contra schema change sem revisão). Schema é **additive only** — zero risco.

### 🟡 MÉDIO — funciona mas tem ressalva

**2. Storage local (`public/uploads/`)** — cartridge export/import + upload library leem/escrevem em filesystem. **Funciona em dev. Em prod com R2/S3 ou container efêmero (Vercel/Railway): quebra**. Não há abstração `storageAdapter` no codebase — usar local foi consistente com import-psd existente. Refactor pra S3 = sweep cross-cutting.

**3. SmartObjectFile shared `filePath`** — `/from-library` cria novo `SmartObjectFile` na campanha apontando pro MESMO arquivo físico do `ClientLibrarySmartObjectFile`. Economia de storage; risco no cleanup futuro de órfãos.

**4. Sem badge "Update available"** — Re-sync button existe mas detecção visual de versão stale não. Precisa endpoint retornar `library.currentVersion` junto com `asset.libraryAssetVersion`. Hoje user re-sync no escuro.

**5. Manual mapping modal ausente** — `apply-cartridge` backend aceita `mapping: {slotKey: campaignAssetId}`, UI sempre auto-matcha. Conflitos silenciosos (último ganha em Map).

### 🟢 BAIXO — refinamento

**6. Bulk save serial sem progress** — "↑ Tudo p/ Library" itera assets sequencialmente sem UI feedback. Lento com N>50.
**7. Sem quota / cleanup** — qualquer ADMIN acumula library infinitamente.
**8. Cartridge sem versionamento** — re-importar mesmo `.zzosy` cria duplicatas. Sem dedupe por slotKey/checksum.

### Bug crítico CORRIGIDO em commit f9a4eba
`sizeBytes: 0` hardcoded em apply-cartridge ao criar SmartObjectFile. Agora propaga `bytes.length` real.

### 📋 Análise crítica profunda (auditoria pós-build)

#### 🔴 Bugs de correção (quebram em uso real)

**B1. `from-library` cria CampaignAsset mas NÃO cria layer no KeyVision** — editor renderiza `keyVision.layers[]`; asset sozinho não aparece no canvas. Fix: dentro do POST, atualizar `KeyVision.layers` JSON. **MAJOR**

**B2. Library PUT não migra `overrides.text/styles` das peças** — endpoint `PUT /api/campaigns/[id]/assets/[assetId]` tem `migrateOverrideText + migrateStyles` que preservam `\n` + per-char styles. Library PUT pula essa lógica → peças com overrides ficam com índices broken. **MAJOR**

**B3. `apply-cartridge` cria CampaignAsset em posX/posY: 100,100 hardcoded** — slots novos aplicam em (100,100). Combinado com B1: asset invisível. Fix: cartridge manifest deve exportar/importar `posX/posY/width/height` + apply atualizar KV layers. **MAJOR**

**B4. Race condition `order` em `from-library`** — `findFirst(order:desc) + create` sem transação. Dois clicks simultâneos = mesmo `order`. **MINOR**

**B5. `saveAssetToLibrary` é 2-step (POST + PUT)** — POST library ✓ + PUT linking ✗ = library tem asset, campanha não vincula. Fix: endpoint atômico server-side. **MINOR**

#### 🟡 UX incompleto

- **U1.** Re-sync (↻) é no-op visual — propagação já aconteceu no PUT library; botão só consolida version. User não vê mudança.
- **U2.** Detach mantém libraryAssetId; DELETE library asset zera FK em ambos detached e ativos (cascade SetNull). Estado ambíguo.
- **U3.** `prompt()/alert()` nativos em saveAssetToLibrary, bulk save, library page. Inconsistente.
- **U4.** `exportCartridge` exporta filtered (não todos) — filtro ativo perde TEXT/SO ao exportar.
- **U5.** Modal "+ Do Library" sem busca por tag.
- **U6.** Sem realtime cross-tab (BroadcastChannel ausente).
- **U7.** Library page export sem audit trail server-side.

#### 🟠 Manutenibilidade

- **M1.** `SmartObjectFile` (campaign) vs `ClientLibrarySmartObjectFile` (lib) — naming inconsistente. Renomear original pra `CampaignSmartObjectFile`.
- **M2.** Triple-write de SmartObject — bytes em 3 FKs apontando pro mesmo arquivo. Cleanup futuro complexo.
- **M3.** `slotKey` não unique per client — auto-match silently picks last. Validation no app layer (Prisma MySQL não tem partial unique).
- **M4.** `name` library asset não unique — 5 "Logo Sicredi" possíveis.
- **M5.** Cartridge format hardcoded `zzosy-cartridge-v1` — v2 breaking change sem fallback parser.
- **M6.** File write síncrono + Prisma create em loop — falha parcial deixa orphan files. Falta rollback.
- **M7.** Props `__psd*` viajam em `lastOverride` JSON sem TypeScript type — typo silencioso.

#### 🔵 Scalability / produção

- **P1.** `public/uploads/` filesystem — incompatível com containers ephemerals (Vercel/Railway). Refactor pra S3/R2.
- **P2.** Bulk save serial — 50 assets = 50 round-trips. Batch endpoint.
- **P3.** Cartridge ZIP all-in-memory — `JSZip.loadAsync(arrayBuffer)` + `generateAsync("nodebuffer")`. PSB 50MB = limit. Streaming.
- **P4.** Propagação `updateMany` OK em 1 query, mas peça-level migration (B2) seria N queries.
- **P5.** Sem rate-limit nos endpoints novos.
- **P6.** Sem `Cache-Control` em GETs públicos da library.
- **P7.** JSON fields (`tags`, `meta`, `lastOverride`) sem size cap server-side.

#### 🟣 Segurança (baixa prioridade — consistente com padrão do codebase)

- **S1.** Sem validação MIME no upload cartridge (só falha em parse).
- **S2.** Sem cap de tamanho upload cartridge → bomb attack OOM.
- **S3.** `imageUrl` aceita string arbitrária (XSS não direto via React, mas risco indireto).
- **S4.** `slotKey` raw em manifest.json exportado — abrir em editor sem escape.
- **S5.** Endpoints não checam role (consistente com codebase atual).

### Ordem sugerida de fix (próxima sessão GAM)

**✅ Imediato (CORRIGIDO nesta sessão):**
1. ✅ B1 + B3: KV layer ao instanciar — novo helper `lib/kvLayers.ts` (`addLayersToKv`) usado em `/from-library` + `apply-cartridge` createMissing path
2. ✅ B2: library PUT migra overrides — novo helper `lib/migrateAssetTextOverrides.ts` (`buildMigrationOps`) reusado em library PUT + asset PUT detach Re-sync
3. ✅ B5: library cloneFrom + link em interactive transaction atômica (rollback se falhar)
4. ✅ B4: from-library + apply-cartridge createMissing: order calc dentro de transaction
5. ✅ U1: Re-sync (↻) agora faz force-pull — sobrescreve content/imageUrl/lastOverride do library E roda migration pra peças
6. ✅ apply-cartridge createMissing usa posX/posY de manifest > lastOverride > offset cascata (não mais hardcoded 100,100)

**✅ Curto prazo (CORRIGIDO):**
7. ✅ U2: DELETE library asset agora pré-marca instances ativas como `libraryAssetDetached=true` ANTES do cascade SetNull. Badge "ex-library" preservado pós-delete.
8. ✅ U3: novos modais `SaveToLibraryModal` (em /campaigns/[id]/assets) + `ExportCartridgeModal` (em /clients/[id]/library). Substituem `prompt()` native com inputs proper + warning realtime de slotKey duplicado.
9. ✅ M3: `lib/libraryValidation.ts` com `assertSlotKeyUnique()` reusado em POST clone + POST direct + PATCH. Retorna 409 com mensagem clara + conflictAssetName. (MySQL não suporta partial unique pra NULL — validação no app layer.)
10. ✅ U4: ExportCartridgeModal oferece escolha "filtered" vs "all" quando há filtro ativo (antes exportava silently só filtered).

**Médio prazo:**
8. M1: rename SmartObjectFile → CampaignSmartObjectFile (sweep ~15 sites)
9. P1: storageAdapter abstraction
10. P3: cartridge streaming
11. P7: size guards JSON fields

**Backlog:**
12. M5: cartridge format versioning + migration parser
13. M6: file write rollback strategy
14. S2: size cap upload cartridge

---

## 🚀 ROADMAP PRODUÇÃO — Go-live ZZOSY

Estado atual: **dev/beta interno**, single-tenant test data, sem CI/CD, sem monitoring, sem billing real.

### Bloqueadores hard (não tem como ir pro ar sem)

**🔴 PROD-01. Storage abstrato (S3/R2)** — hoje `public/uploads/` quebra em qualquer container ephemeral (Vercel/Railway). Refactor em `lib/storage.ts` com adapter pattern. Touchpoints: `import-psd`, library, cartridge, asset image upload, brand logos, brand fonts. ~20 sites. **3-5 dias**

**🔴 PROD-02. Migrations strategy** — hoje usamos `prisma db push` (sem migration files). Pra prod precisa `prisma migrate dev/deploy` workflow. Migration baseline + commit `_prisma/migrations/`. **1 dia**

**🔴 PROD-03. Email transactional** — NextAuth precisa pra password reset, email verification, magic links. Hoje só credentials. Integrar Resend/Postmark/SES. **2 dias**

**🔴 PROD-04. Error tracking** — sem Sentry/Bugsnag = bugs em prod silenciosos. Setup Sentry com DSN per-tenant. **1 dia**

**🔴 PROD-05. Stripe billing real** — `Plan / Subscription` models existem mas não há cobrança real. Webhook Stripe + portal customer + downgrade graceful. **1 semana**

**🔴 PROD-06. Backup automático DB** — Railway tem snapshot, mas validar restore + ter cron extra. **1 dia**

**🔴 PROD-07. CDN para uploads** — servir PSDs/imagens via CloudFlare/Bunny direto, não passa pelo Next.js. Cache headers. **2 dias** (depois de PROD-01)

**🔴 PROD-08. Rate limiting** — `@upstash/ratelimit` em endpoints sensíveis (upload, login, criar campanha). **1 dia**

**🔴 PROD-09. Variáveis de ambiente per-stage** — `.env.production` vs `.env.staging` vs `.env.development`. Validation via `zod` no boot. **0.5 dia**

**🔴 PROD-10. Logs estruturados** — `console.log` espalhado vai pra `/dev/null`. Usar Pino + log aggregator (Axiom/Logtail). **1 dia**

### Bloqueadores soft (gente vai descobrir e reclamar)

**🟡 PROD-11. PT/EN i18n** — sistema misturado. Decisão: 100% PT (mercado BR) ou bilingual. next-intl. **1 semana se i18n completo, 1 dia se sweep PT**

**🟡 PROD-12. Mobile responsive audit** — editor canvas em mobile não funciona; dashboard/listings precisam responsive. Páginas de view-only (cliente aprova peça via link) PRECISAM ser mobile-first. **3-5 dias**

**🟡 PROD-13. Accessibility (a11y)** — aria-labels, contrast, keyboard nav. Auditoria com axe-core. **2 dias**

**🟡 PROD-14. Páginas legais** — Termos de Uso + Política de Privacidade (LGPD-compliant). Boilerplate ajustado. **1 dia**

**🟡 PROD-15. Onboarding flow polido** — `/welcome` existe mas é placeholder. Wizard: cria primeira empresa → primeira campanha → tour do editor. **3 dias**

**🟡 PROD-16. Páginas de erro custom** — 404, 500, offline. Hoje cai no fallback Next.js. **0.5 dia**

**🟡 PROD-17. Performance budget** — `KeyVisionEditor.tsx` tem 12k LOC; primeiro paint pesado. Code split + lazy load. **3-5 dias**

**🟡 PROD-18. Image optimization** — `<img>` cru em todo lugar. Migrar pra `next/image` onde aplicável. **2 dias**

**🟡 PROD-19. Audit trail** — quem editou o que, quando. `prisma model AuditLog`. Útil pra cliente perguntando "quem mudou o logo". **2 dias**

**🟡 PROD-20. Health check + uptime monitoring** — `/api/health` + UptimeRobot/BetterStack. **0.5 dia**

### Quality gates (deve passar antes do release)

**🟢 PROD-21. E2E test suite** — Playwright. Critical paths: signup → criar campanha → import PSD → gerar peças → exportar. **1 semana initial setup + testes**

**🟢 PROD-22. CI/CD pipeline** — GitHub Actions: lint + typecheck + build + E2E + deploy. **2 dias**

**🟢 PROD-23. Staging environment** — clone do prod, dados anonimizados. Deploy automático no push pra `staging` branch. **1 dia**

**🟢 PROD-24. Load test** — k6/artillery contra staging com cenário "100 designers simultâneos importando PSDs". **2 dias**

**🟢 PROD-25. Security audit externo** — checklist OWASP, pentest leve. **1 semana se externo, 2 dias interno com tools**

**🟢 PROD-26. Documentação user-facing** — help center / docs.zzosy.com / videos curtos por feature. **1-2 semanas**

**🟢 PROD-27. Support channel** — Intercom/Crisp/email. Pelo menos email com SLA escrito. **0.5 dia**

### Nice-to-have antes do launch público

- **N1.** Affiliate / referral program
- **N2.** Public template gallery (cartridges públicas de marca)
- **N3.** Slack/Discord da comunidade
- **N4.** Public roadmap voting
- **N5.** Status page (statusgator/instatus)
- **N6.** Changelog público (releaselog)

### Estimativa total go-live (sequencial otimista)

- **MVP fechado e testado**: GAM bugs (B1-B5) + finalização Fidelidade PSD = **1 semana**
- **Bloqueadores hard (PROD-01 a 10)**: **3 semanas**
- **Bloqueadores soft + quality gates**: **3-4 semanas**
- **Total estimado**: **2-2.5 meses** com 1 dev fulltime

Paralelizando (devs + designer + ops): **~6 semanas**.

### Decisões pendentes pra go-live

1. **Cloud provider**: Vercel (Next.js nativo, mais caro) vs Railway (cheap, ja temos DB la) vs Fly.io vs auto-hosted?
2. **Storage**: R2 (Cloudflare, S3-compatible, cheap egress) vs S3 vs Bunny Storage?
3. **DB tier**: Railway managed pode escalar até X. Migrar pra Planetscale ou Neon se previsão > 10k users?
4. **Pricing model**: SaaS por user? Por client? Por peça gerada? Flat agency tier?
5. **Region**: AWS sa-east-1 vs us-east-1? Latência cliente BR.
6. **Brand do produto**: "zzosy" final ou vamos renomear pré-launch?

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 16 (App Router) + React 19 |
| Editor de canvas | Fabric.js v7.2 |
| PSD round-trip | ag-psd v18 |
| ORM | Prisma 5.22 |
| Banco | MySQL (Railway) |
| Auth | NextAuth.js |
| Tipagem | TypeScript |
| Estilo | Tailwind + inline styles |
| Monorepo | Turborepo |

---

## Banco — Railway MySQL

| | |
|---|---|
| Host público | tramway.proxy.rlwy.net |
| Porta | 27292 |
| Database | railway |
| URL pública | `mysql://root:YwkxxacsibywDQoOlJJdXhnmniUQKgTO@tramway.proxy.rlwy.net:27292/railway` |
| URL interna | `mysql://root:YwkxxacsibywDQoOlJJdXhnmniUQKgTO@mysql.railway.internal:3306/railway` |

Pública pra dev, interna pra Railway-hosted.

---

## Variáveis (`apps/web/.env`)

```env
DATABASE_URL="mysql://root:YwkxxacsibywDQoOlJJdXhnmniUQKgTO@tramway.proxy.rlwy.net:27292/railway"
NEXTAUTH_SECRET="5w00QFuAKAmWIZVI5reDuXld3jBUqeSChj1+uGFpqa8="
NEXTAUTH_URL="http://localhost:3000"
```

---

## Estrutura de pastas

```
apps/web/
├── app/
│   ├── (auth)/login + register
│   ├── account, admin, approvals, deliveries, medias, plans, welcome
│   ├── dashboard/             # home pos-login
│   ├── campaigns/[id]/        # campanha + assets + presentation
│   ├── clients/[id]/          # cliente (brand colors, segments, taxonomy)
│   ├── pieces/[id]/           # peça individual
│   ├── editor/                # editor wrapper
│   ├── playground/            # testes
│   └── api/                   # REST endpoints (campaigns, pieces, clients, etc)
├── components/
│   ├── editor/                # KeyVisionEditor (MAIN ~11k LOC), PropertiesPanel*, LayerPanel, FontPicker, ColorSwatchPicker
│   ├── campaign/              # PsdImporter, PsdPieceImporter
│   ├── presentation/          # Slides
│   ├── clients/, pieces/, deliveries/, shared/, ui/
│   └── layout/                # TopNav
├── lib/
│   ├── fabricLineHeight.ts    # leading PSD-exato (override _fontSizeMult, mede ascender real)
│   ├── exportPiece.ts         # PSD export
│   ├── applyMaskToFabric.ts   # mascaras (raster/vector/clipping)
│   ├── shapePaths.ts          # rectangle/roundedRect/ellipse path builders
│   ├── psd/                   # shapeImport, helpers, toCampaign, pieceImporter
│   ├── cascadeBrandUpdate.ts  # propaga brand colors pra campanhas+peças
│   ├── regenerateThumbs.ts
│   └── google-fonts.ts
└── prisma/schema.prisma
```

*`PropertiesPanel.tsx` existe mas NÃO está em uso — UI real do painel direito está inline em `KeyVisionEditor.tsx` linha ~10100+.

---

## Modelos (Prisma)

| Modelo | Função |
|---|---|
| Tenant | Agência. taxonomy (segments) é source-of-truth |
| User | role: SUPER_ADMIN, ADMIN, USER |
| Plan / Subscription | Planos (Starter/Pro/Agency) e assinatura |
| Client | Cliente da agência. brandColors, fontes, taxonomy local |
| Campaign | Campanha. keyVision (data JSON) + assets |
| CampaignAsset | Asset reutilizavel (TEXT/IMAGE/SHAPE/SMART_OBJECT). content + lastOverride |
| Piece | Peça gerada. data JSON contém layers[] com overrides |
| Delivery | Empacotamento de peças pra cliente |

Account / Session / VerificationToken = NextAuth.

---

## Conceitos-chave do editor

### Key Vision (Matriz) vs Peça
- **Matriz** = template visual da campanha. Mexer aqui propaga pra:
  - `asset.content` (caracteres = source of truth pra todas as peças)
  - `asset.lastOverride` (template visual aplicado em novas peças)
- **Peça** = instância gerada da matriz. Edições locais viram `layer.overrides` (text local com `\n`, fill, fontSize, leadingPt, styles per-char, etc).
- Caracteres na peça SEMPRE vêm do asset; só quebras de linha são locais.

### Assets
- TEXT: content = `TextSpan[]` (fragmentado por estilo per-char)
- IMAGE: blob URL ou data URL
- SHAPE: content = `{ path, pathBbox, kind, cornerRadius, fill, stroke, fillRule }`
- SMART_OBJECT: PSD embarcado preservado (placedLayer no re-export)

### Brand colors (live)
- Cada layer texto com `__fillBrandIdx` referencia idx do `client.brandColors`. Mudar a cor da brand propaga pra TODAS as campanhas+peças do cliente automaticamente (via `cascadeBrandUpdate`).
- Snap top do undo é re-snapshotted após brand sync — undo NÃO desfaz mudança de brand.

### Leading PSD-exato
- `lib/fabricLineHeight.ts`: override de instance `_fontSizeMult=1.0` + `getHeightOfLineImpl` retorna ascender real (`fontBoundingBoxAscent`). lineHeight = leadingPt/ascender → baseline-to-baseline = leadingPt EXATO.
- Reaplicado em todos load paths: init, scaling, undo restore.

### Shapes (sempre 3 props)
- Properties Panel SEMPRE mostra Fill + Stroke + Raio do canto pra qualquer shape selecionado.
- Mexer no raio em rectangle auto-promove pra roundedRect (Adobe-style). Disabled pra ellipse / arbitrary path.
- Import PSD detecta vogk (Rect/RoundedRect/Ellipse) ou path arbitrário via `tryExtractShapeFromLayer` em `lib/psd/shapeImport.ts` (helper central usado em PsdImporter + PsdPieceImporter).

### Undo / Redo
- Stack de 30 entradas. Snap = `fc.toObject(HISTORY_PROPS_TO_INCLUDE)` JSON-serializado.
- `HISTORY_PROPS_TO_INCLUDE` = constante central com TODAS props customizadas (__shapeKind, __cornerRadius, __pathBbox, leadingPt, etc). Adicionar prop nova = 1 linha.
- `applySnapshot` FORÇA-RESTORE de todas as props enumeradas (`TEXT_PROPS`/`SHAPE_PROPS`/`BASIC_PROPS`) direto na instance — não confia no construtor Fabric.
- Per-char `styles` convertido via `util.stylesFromArray` (Fabric v7 serializa em ARRAY format, runtime usa OBJECT format).
- Todos os listeners Fabric com side effect têm guard `if (isApplyingHistory.current) return` PRIMEIRO (text:changed inclui re-check dentro do debounce timer).

### Steps (multi-step)
- Peça pode ter N steps (carrossel, sequência). `piece.data.steps[i]` = snapshot do canvas + thumb.
- Thumbs offscreen via `renderStepOffscreen`. Auto-gera thumbs faltantes ao abrir.

### Bleed overlays
- 4 retângulos `#1e1e1e` ao redor da peça pra mascarar área extra do canvas DOM (handles ficam clicaveis fora da peça).
- Só criados quando worldLeft<0 / worldRight>cw / etc — em zoom>100% com peça > canvas, alguns lados pulam (antes width negativo gerava artefatos).

### Masks
- raster (alpha bake no _element), vector (clipPath), clipping (Adobe-style sync com layer abaixo).
- Helper central `lib/applyMaskToFabric.ts`.

### PSD round-trip
- Import: `components/campaign/PsdImporter.tsx` (matriz) e `PsdPieceImporter.tsx` (peça). Helper compartilhado `lib/psd/shapeImport.ts` pra shapes.
- Export: `lib/exportPiece.ts`. Smart Objects preservados como `placedLayer`. Text layers ganham `lnsr: 'srct'` (nameSource) pra PS auto-renomear ao editar texto.

---

## Padrões / convenções

- **Helper central ANTES da 4a cópia**: 3+ sites com código igual = centraliza AGORA. Drift por copy-paste é causa raiz de muitos bugs.
- **Sweep sistêmico**: fix em 1 spot → aplica imediato a todos similares. Anti-padrão deixar pontual.
- **PSD round-trip**: toda prop editável precisa ida+volta perfeita (import → edit → export → re-import). ~10 sites a tocar pra cada prop nova.
- **Sem prompt-de-salvar quando clean**: nunca pergunta "salvar?" ao sair se nada mudou. Padrão Adobe/Figma.
- **Modo manual save**: nada de auto-save. User clica botão Salvar; indicador dirty fica visível.

---

## URLs locais

| Página | URL |
|---|---|
| Login / Register | `/login`, `/register` |
| Dashboard | `/dashboard` |
| Cliente | `/clients/[id]` (edit em `/clients/[id]/edit`) |
| Campanhas | `/campaigns/[id]` (assets em `.../assets`, apresentação em `.../presentation`) |
| Peças | `/pieces/[id]` |
| Editor | `/editor?campaignId=...&pieceId=...` |
| Médias | `/medias` |
| Entregas | `/deliveries` |
| Aprovações | `/approvals` |
| Plans / Account | `/plans`, `/account` |
| Admin | `/admin` |
| Welcome | `/welcome` (pos-cadastro) |

---

## Conta de teste

| | |
|---|---|
| Nome | Giovanni |
| Agência | GIOBA (slug: `gioba`) |
| E-mail | teste@teste.com |
| Senha | 12345678 |
| Role | ADMIN |

---

## Comandos

```bash
cd apps/web

npm run dev                 # dev server
npx prisma db push          # sync schema
npx prisma studio           # explorar banco
npx tsc --noEmit            # type check
```

---

## Identidade visual

- **Brand color zzosy**: amarelo `#F5C400`
- **Cores base**: preto `#111111`, branco `#FFFFFF`, dark editor `#1e1e1e`
- **Fontes**: DM Sans (UI), fontes do cliente nas peças
- **Estilo**: minimalista, dark editor com accent amarelo

---

## Bugs/lessons aprendidos importantes

1. **Fabric styles ARRAY vs OBJECT** (Fabric v7+): toObject serializa `styles` como `[{start,end,style}]` mas runtime usa `{line:{col:style}}`. Sempre converter via `util.stylesFromArray` ao restaurar — senão per-char styles somem. Bug recorrente reportado como "undo perde peso/cor da fonte".

2. **Undo isApplyingHistory guard**: todo listener Fabric que chama pushHistory PRECISA do guard `isApplyingHistory.current` ANTES dos outros. Sem isso, initDimensions durante restore dispara object:modified → empilha snapshot do estado já restaurado.

3. **applyLeadingPtToFabric** instala overrides de instance (`_fontSizeMult`, `getHeightOfLineImpl`) que somem após loadFromJSON — REAPLICAR explicitamente em todos paths de load (init, scaling, undo).

4. **Bleed overlays width negativo**: em zoom > 100% com peça > canvas DOM, fórmulas viravam width negativo → artefatos visuais. Skipar overlays daquele lado.

5. **PSD text `lnsr: 'srct'`**: sem nameSource Photoshop não auto-renomeia layer ao editar texto.

---

## Sessão 2026-05-24/25 — Fidelidade PSD + UX sweep

### Fidelidade total do import PSD (/goal "deixar import = editor")
1. **Color Overlay/Gradient Overlay agora renderiza em Smart Objects** — `applyFabricEffects` ganhou flag `overlaysOnly`. Pra SO (`pixelsIncludeEffects=true`), shadow/glow/stroke continuam pulados (já baked pelo PS), mas overlays passam via `BlendColor.tint` no Fabric image filter. Logo branco via Color Overlay agora aparece no editor.
2. **Smart Object preserva bytes embedded** (sem rasterizar) — `toCampaign.ts` agora alimenta `linkedBlobs[] + linkedMeta[]` na build, `importer.ts` envia como `linked[]` no FormData, endpoint `/import-psd` já criava `SmartObjectFile` records, agora alimentados corretamente pelo pipeline novo. Round-trip: editor → exportPiece → writer recria `placedLayer + linkedFiles[]` no PSD. Vetor (PSB/AI) sobrevive intacto.
3. **Tracking clamp em fonte fallback** — `lib/fabricCharSpacingPatch.ts` ganhou `markFontFallback(family)` / `clearFontFallback(family)`. Quando família detectada como missing (font detection no init), patch CLAMPA `charSpacing < 0` pra `0` apenas nessa família. Sem isso, PSD com tracking -25/-50 ficava com letras COLADAS em fallback Arial. Substituir fonte via UI dispara `initDimensions` global → tracking real volta.
4. **Mapping `Exo2.0-Bold` → `Exo 2`** (Google Font) — `normalizePsdFontToGoogle` agora strippa sufixo de versão (`.0`). Sem isso virava `Exo 2.0` que não bate com Google → Arial fallback.
5. **Point Text vs Box Text do PSD** ⭐ *causa raiz da maioria dos wraps errados* — PSD tem 2 shape types: `point` (sem wrap, só `\n` quebra) e `box` (wrappa em `boxBounds`). Editor antes tratava tudo como box com `width=bbox.width` → divergência de medição = wrap onde não devia. Agora `reader.ts` extrai `shapeType + boxBounds`, `toCampaign.ts` persiste em `lastOverride.__psdShapeType / __psdBoxBounds`, editor cria Textbox com `width=99999` pra point text (sem wrap, depois encolhe via shrink-to-content existente). `HISTORY_PROPS_TO_INCLUDE` inclui os flags pra round-trip.
6. **Paragraph `spaceAfter`** — `fabricCharSpacingPatch.ts` ganhou override de `getHeightOfLine(lineIndex)` que adiciona `__paragraphSpaceAfter` apenas em linhas que terminam paragraph no texto raw. Cache invalidado quando texto muda. Sem isso, paragrafos PSD colam no editor.
7. **Leading mixed-font-size fix** — `toCampaign.ts` agora usa `Math.max(...styleRuns.fontSize)` como basis pra `lineHeight / leadingPt` quando `defaultStyle.fontSize` está undefined (caso Sicredi text 1: defaultStyle vazio + 2 runs com fontSize 62 e 40). Sem isso, fallback 48px gerava leading errado.
8. **Baseline shift per-char (round-trip completo)** — novo eixo de typesetting:
   - `types.ts`: `baselineShift?: number` em PsdCharStyle + TextSpan.style
   - `reader.ts`: extrai de styleRuns com textScale
   - `toCampaign.ts`: propaga via `spanStyleFromCharStyle` + `buildLineIndexedStyles` (sinal invertido pra Fabric `deltaY`)
   - `writer.ts charStyleToAgPsd`: emite no PSD
   - `exportPiece.ts buildStyleRuns`: lê Fabric `deltaY` → `baselineShift` (sign flip)
   - `KeyVisionEditor.tsx`: novo input "Baseline" no painel direito (grid 3 colunas: Line height / Letter spacing / Baseline), função `setBaselineShiftProp` per-char only (Adobe parity)

### Bug grave corrigido — duplicação de texto no /assets
- Anti-padrão: `setCampaign(prev => { newSpans = rebuildSpans(...) })` com SIDE-EFFECT dentro do updater quebrava em React 18 StrictMode (DEV). Updater rodava 2x; a 2ª execução podia receber prev já com content nova → rebuildSpans recompõe ENCIMA do texto novo → "Nem sempre Nem sempre é difícil...".
- **Fix**: ler estado atual via `campaignRef` (mirror via `useEffect(() => { ref.current = state }, [state])`) FORA do updater, computar `newSpans` UMA vez, setState com objeto puro.
- **Memória salva**: `feedback_no_side_effects_in_setstate_updater.md`.

### UX sweep
- **Padrão Row 4 botões outline** (Apagar / Duplicar / Editar / Entrar) aplicado em `/dashboard`, `/campaigns`, `/clients/[id]`, `/campaigns/[id]` (grid+lista), `/pieces` (grid+lista). Primary fill amarelo restrito a CTAs standalone (`/pieces/[id]` "Entrar no Editor") + botão ← Voltar. `CLAUDE.md` PARTE 1.1.B documenta a regra.
- **Settings pages**: arrow up/down agora funcionam nos campos de size (`design-tokens`, `typography`). Pattern: regex `^(\d+)(\w+)$` parseia número+unit, renderiza `<input type="number">` (setas nativas) + `<span>unit</span>` com gap. Sem match: cai pro text input.
- **Subnav button style** padronizado: white bg + 2px #555 border + texto preto bold + radius 6. Helper `subnavButtonStyle()` em `CampaignSubnav.tsx`.
- **Toggle Grid/Lista** movido pra dentro do box "Peças geradas" (top-right do card), com divisor vertical separando das bulk actions.
- **"Selecionar tudo"** funciona mesmo com seleção parcial (vira "Desmarcar tudo" quando tudo marcado).
- **Generate Pieces modal**: novo botão "Select all" global no header (além dos per-segmento existentes).
- **Export Dialog** robusto contra adblock: PLAN A (window.location.href) + PLAN B (sync `window.open` antes do await, redirect quando blob pronto).
- **PT/EN cleanup**: começou foco em English (Import PSD, Export, Generate Pieces). Sweep completo pendente (próximo passo).
- **Header limpo**: removido "Ver todas", "Atualizada", labels "Ações", subtítulos repetitivos, "Formatos disponíveis para geração de peças", título duplicado no top nav.
- **Replace Status column → Segmento** em /campaigns/[id]/lista.

### Design Tokens
- `lib/designTokens.ts` + `components/shared/DesignTokensInjector.tsx` aplicam CSS vars do localStorage no `<html>`.
- Token vars (`--zz-brand-primary`, `--zz-text-*`, `--zz-border-*`, `--zz-radius-*`, `--zz-stroke-*`, `--zz-text-*`, `--zz-font-family`) substituem hard-coded.
- `Button.tsx` consome via `var(--zz-brand-primary)`.
- Editor de tokens em `/admin/settings/design-tokens` (live preview).
- Editor de tipografia em `/admin/settings/typography`.
- Playground overrides em `/admin/settings/overrides`.

### Reorganização admin
- TopNav: "Admin" movido pra direita (próximo de Account).
- Antigo `/admin/playground` virou `/admin/settings` (overrides + design-tokens + typography).

---

## Roadmap próximos passos (ordem sugerida)

### 🔥 Prioridade alta
1. **Global Asset Management** (capítulo no topo deste MD) — biblioteca de assets por cliente, sobrevive a apagar campanhas. Schema + UI + clone bidirecional. ~3-4 dias.
2. **Validar `/goal fidelidade PSD` em PSDs reais** — testar Sicredi + 2-3 outros PSDs profissionais. Iterar conforme aparecer divergência.
3. **PT/EN sweep completo** — sistema decisão: tudo English? Tudo PT? Mix coerente? Documentar regra no CLAUDE.md.

### Importante mas não urgente
4. **Selection toolbar floating no canvas** (sessão anterior playground): trazer pra editor real KeyVision — color picker per-char inline em vez de só painel direito.
5. **Inner shadow + inner glow rendering** — único piece dos PSD effects que ainda fica só preservado no JSON sem render. Patch via SVG `<filter>` injetado no DOM.
6. **Bevel + satin + patternOverlay** — completar 100% dos PSD effects. Cada um exige offscreen canvas composition.
7. **Custom font upload UI auditing** — `/clients/[id]/edit` brand fonts: validar fluxo completo de upload + register + persist + carregamento no editor.

### Refinos
8. **PSD round-trip systematic test** — automatizar import → export → re-import → diff JSON. Pegar regressões cedo.
9. **Gradient stops PSD ↔ Fabric** — Fabric v7 aceita literal gradient object; auditar reverse.
10. **defaultStyle round-trip completo** — quando defaultStyle.font/size estão undefined no PSD (caso Sicredi), reader cai em fallback Arial/48. Considerar gravar `defaultStyle: undefined` explicit pro writer omitir.
11. **Pre-existing TS errors** — `updatedAt` em Piece foi corrigido (interface local). Verificar outros locais similares.

### Backlog
12. **/ultrareview** — review multi-agent já existe via comando; usar quando bater milestone GAM.
13. **Brand color "live"**: já cobre cascade; auditar edge case de undo após brand change.
14. **Approvals flow**: implementação inicial existe (`/approvals`). Auditar UX completa quando GAM estiver pronto.

---

## Status

Editor + PSD round-trip em produção interno. Sessão 2026-05-24/25:
- ✅ Fidelidade PSD significativamente melhorada (point/box text, spaceAfter, baseline shift, font fallback tracking clamp, Exo2 normalization, SO color overlay)
- ✅ **Global Asset Management (GAM)** implementado fim-a-fim (schema, API, UI library + edit + cartridge export/import + apply)
- ✅ UX sweep (4-button outline pattern, design tokens, settings number arrows)
- 🚨 **PENDENTE USER**: `cd apps/web && npx prisma db push` (1 comando, additive only) pra ativar tabelas do GAM

Commit único da sessão: `7a57e91`. Branch: `claude/piece-card-zero-padding`.
