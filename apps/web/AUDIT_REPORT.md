# Auditoria ZZOSY — Fluxo ponta a ponta

Auditoria do pipeline completo ZZOSY: criação da peça → atualização → reimportação → apresentação → entrega. 5 agents independentes mapearam cada etapa em paralelo. 40+ problemas identificados, 5 críticos já corrigidos.

---

## Padrões cross-cutting

Três famílias de problemas aparecem em quase todas as etapas:

1. **Normalização de nomes divergente** — client (`normalizeName` remove acentos + espaços) ≠ backend (`.trim().toLowerCase()`). Match falha silenciosamente em re-import. *Corrigido.*
2. **Race conditions de save** — `performSave`, `cascadeBrandUpdate`, `propagateBrandTypography`, PUTs de asset debounceados operam sobre o mesmo recurso sem lock. Último ganha, mudanças se perdem. *Mutex + flush corrigidos.*
3. **Silent failures** — assets faltando, thumbs faltando, transações parciais sem rollback nem aviso. Usuário não sabe que algo quebrou.

---

## Etapa 1 — Criação da peça (PSD import) 🟠

`PsdImporter.tsx` → POST `/api/campaigns/[id]/import-psd` → cria `CampaignAsset[]` + `KeyVision` + propaga `assetId` pra peças existentes.

### Bugs encontrados

| # | Severidade | Onde | Problema |
|---|---|---|---|
| 1.1 | 🔴 CRÍTICO | `import-psd/route.ts:49` | `JSON.parse(assetsJson)` sem try/catch — 500 opaco em payload mal formado |
| 1.2 | 🔴 CRÍTICO | `import-psd/route.ts:107-120` | `deleteMany(CampaignAsset)` **antes** do create sem transação — falha intermediária deixa campanha vazia |
| 1.3 | 🟠 ALTO | `import-psd/route.ts:283-299` | Fallback de remap por `order` quebrado — peças apontam pra assetId inválido sem aviso |
| 1.4 | 🟡 MÉDIO | `prisma/schema.prisma` (Asset) | `CampaignAsset.height` nunca persiste (só `width` existe) — re-import perde altura |
| 1.5 | 🟡 MÉDIO | `import-psd/route.ts:1855` | PSD > 50MB salva `psdUrl=null` (chunked "TODO") — re-import master impossível |
| 1.6 | 🟡 MÉDIO | `import-psd/route.ts:187-192` | Array index unchecked — `imageUrls[asset.imageIndex]` retorna `null` silenciosamente fora do range |
| 1.7 | 🟡 MÉDIO | `import-psd/route.ts:212` | `asset.content` JSON-stringificado em LongText — pode truncar com 10k chars × 50 runs |
| 1.8 | 🟡 MÉDIO | `import-psd/route.ts:271,278` | ✅ **CORRIGIDO**: match label usava `.trim().toLowerCase()`, agora `normalizeName` (paridade com client) |

---

## Etapa 2 — Atualização (edits + propagação) 🔴

`KeyVisionEditor.tsx` (~9000 linhas) edita matriz ou peça. Save manual via botão. Propagação automática quando muda `Client.brandColors` / `brandFont` / `brandTypography` / `customFontFiles`.

### Bugs encontrados

| # | Severidade | Onde | Problema |
|---|---|---|---|
| 2.1 | 🔴 CRÍTICO | `cascadeBrandUpdate.ts:198-244` + `api/clients/[id]/route.ts:51-66` | `cascadeBrandUpdate` (client) + `propagateBrandTypography` (server) podem rodar simultâneos → metade das peças com cor nova + tipografia velha, metade ao contrário |
| 2.2 | 🔴 CRÍTICO | `KeyVisionEditor.tsx:6793-6803` | `lastOverridePendingPayload` debounce 400ms **não bloqueia** `performSave` — user clica "Salvar e sair" e perde template antes do PUT. ✅ **CORRIGIDO** com `flushPendingAssetPuts` |
| 2.3 | 🔴 CRÍTICO | `KeyVisionEditor.tsx:5911+` | Múltiplos `performSave` paralelos sem mutex — último ganha. ✅ **CORRIGIDO** com `savingInFlightRef` no performSave |
| 2.4 | 🟠 ALTO | `KeyVisionEditor.tsx:7057-7060` | `__dsLinked=false` só em mudança de tipografia, **não em mudança de cor**. ✅ **CORRIGIDO** + bloqueio em `brandTypographyPropagate` quando `dsLinked === false` |
| 2.5 | 🟠 ALTO | `KeyVisionEditor.tsx:5093,6130` | `isDirtyRef=false` setado **antes** de `uploadPieceThumb` terminar — falha de upload deixa thumb stale, user pensa que salvou |
| 2.6 | 🟡 MÉDIO | `KeyVisionEditor.tsx:6045-6059` | Circuit breaker aborta save com `layers=[]` temporário durante font load — user perde tudo se sair antes do retry |
| 2.7 | 🟡 MÉDIO | `api/campaigns/[id]/assets/[assetId]/route.ts` | PUT asset não toca em `__dsLinked` — server propaga preset sem distinguir "stale cascade" de "override real do user" |
| 2.8 | 🟡 MÉDIO | `KeyVisionEditor.tsx:6817-6887` | `updateAssetContent` debounce 800ms sem coordenação com `cascadeBrandUpdate` — migração de styles pode perder ordem |

---

## Etapa 3 — Reimportação 🔴

3 caminhos: PSD avulso (`PsdPieceImporter`), PSD step em peça existente, re-import sobre campanha.

### Bugs encontrados

| # | Severidade | Onde | Problema |
|---|---|---|---|
| 3.1 | 🔴 CRÍTICO | `lib/normalize.ts` ↔ `import-psd/route.ts:271` + `KeyVisionEditor.tsx:5710` | Client usa `normalizeName` (remove espaços), backend usava `.trim().toLowerCase()` (mantém) → "Logo Fox" no banco não bate "LogoFox" do PSD. ✅ **CORRIGIDO** |
| 3.2 | 🔴 CRÍTICO | `import-psd/route.ts:119-120` | SmartObjectFile recriado por GUID com `id` novo — `CampaignAsset.smartObjectId` antigo vira FK morta (sem remap pós-deleteMany) |
| 3.3 | 🟠 ALTO | `KeyVisionEditor.tsx:2692-2695` | Layers órfãos (sem match nem embedded fallback) silenciosamente removidos do canvas no load |
| 3.4 | 🟠 ALTO | `KeyVisionEditor.tsx:5739` vs `PsdPieceImporter.tsx:401` | Comportamentos divergentes pra mesma operação: `PsdPieceImporter` cria asset TEXT pra textos sem match, `replaceStepFromPsd` só loga e ignora |
| 3.5 | 🟡 MÉDIO | (lógica ausente) | Embedded layer (com `imageDataUrl` inline) nunca relinka quando asset homônimo é criado depois |
| 3.6 | 🟡 MÉDIO | `import-psd/route.ts:266-267` | Tie-break "Layer 1" homônimos por ordem PSD — reorder no Photoshop rebatiza errado |
| 3.7 | 🟡 MÉDIO | `KeyVisionEditor.tsx` (load) | Editor aberto não refetch assets durante reimportação de campanha — cache stale |

---

## Etapa 4 — Apresentação 🟡

`/campaigns/[id]/presentation/page.tsx` + `components/presentation/Slides.tsx` + `lib/generatePresentation.ts` (PPTX export).

### Bugs encontrados

| # | Severidade | Onde | Problema |
|---|---|---|---|
| 4.1 | 🟠 ALTO | `Slides.tsx:32-36` | `lightenColor()` retornava `hex` sem transformar — HTML saturado, PPTX 10% mais claro (`lightenHex(_, 1.10)`). ✅ **CORRIGIDO** |
| 4.2 | 🟡 MÉDIO | `Slides.tsx:142-155,442-452` | Auto-save com debounce 600ms sem hook `beforeunload` — fechar a aba em 300ms perde a edição |
| 4.3 | 🟡 MÉDIO | `presentation/page.tsx:101-122,220-249` | `ensureStepThumbsForPieces` em background + `refetch` antes do export — peça editada noutra aba pode ir stale pro PPTX |
| 4.4 | 🟡 MÉDIO | `Slides.tsx:408` + `generatePresentation.ts:322,414` | Thumb falha silenciosamente → slide com "(sem preview)" sem alertar o user |
| 4.5 | 🟢 BAIXO | `Slides.tsx` vs `generatePresentation.ts` | `fontSize: "3.2cqw"` (HTML responsivo) vs `fontSize: 32pt` Calibri (PPTX fixo) + fontes diferentes (system-ui vs Calibri) |
| 4.6 | 🟢 BAIXO | `generatePresentation.ts:515-516` | Logo custom em whitelabel: fetch silencioso (timeout retorna null), slide vai com placeholder vazio sem aviso |

---

## Etapa 5 — Entrega 🔴

`DeliveryDialog.tsx` + `/api/deliveries` + `lib/exportPiece.ts` + ZIP client-side.

### Bugs encontrados

| # | Severidade | Onde | Problema |
|---|---|---|---|
| 5.1 | 🔴 CRÍTICO | `api/deliveries/route.ts:45-75` | `pieceIds` no POST não validado contra `campaignId` — pode entregar peça de outra campanha. ✅ **CORRIGIDO** |
| 5.2 | 🔴 CRÍTICO | `api/pieces/[id]/route.ts:20-23` | PATCH aceitava qualquer status sem whitelist — peça ENTREGUE podia ser revertida pra CRIACAO. ✅ **CORRIGIDO** com whitelist + bloqueio de ENTREGUE manual |
| 5.3 | 🔴 CRÍTICO | `DeliveryDialog.tsx:78-79` | Peça ENTREGUE re-selecionável (`hideDelivered` filtra UI mas não bloqueia) — viola `@@unique([deliveryId, pieceId])` |
| 5.4 | 🟠 ALTO | `lib/exportPiece.ts:69-84,1667-1669` | `buildFileName` gera colisões — 2 peças sem `campaignName` viram `Square_1080x1080.png` no mesmo ZIP, uma sobrescreve outra |
| 5.5 | 🟠 ALTO | `lib/exportPiece.ts:242-243` | Asset deletado durante export → `if (!asset) continue` silencioso, ZIP sai com layer faltando |
| 5.6 | 🟠 ALTO | `lib/exportPiece.ts:223-224` | `piece.data` corrompido cai em fallback 1080×1080 sem aviso — formato real perdido |
| 5.7 | 🟡 MÉDIO | `DeliveryDialog.tsx:113` | ZIP 100% client-side, sem checksum nem re-renderização server-side — browser engasgado entrega ZIP parcial |
| 5.8 | 🟡 MÉDIO | `api/deliveries/route.ts:69` | Status workflow pula direto pra "SENT" (PENDING→SENT) — sem guardrail de transição |
| 5.9 | 🟡 MÉDIO | `lib/exportPiece.ts:1670-1681` | PSD renderiza server-side sem webfonts → visual diverge de PNG/JPG (browser com fonts) |

---

## Fixes aplicados nesta auditoria

| # | Fix | Arquivos |
|---|---|---|
| ✅ 1 | Unificar `normalizeName` em todos os caminhos de match PSD | `import-psd/route.ts:271-281`, `KeyVisionEditor.tsx:5710,5735` |
| ✅ 2 | Mutex + `flushPendingAssetPuts()` antes de `performSave` / `saveNow` | `KeyVisionEditor.tsx` (novo helper + locks nos exit paths) |
| ✅ 3 | `__dsLinked=false` em mudança de cor custom + bloqueio no propagate quando `dsLinked === false` | `KeyVisionEditor.tsx:7057`, `brandTypographyPropagate.ts:312` |
| ✅ 4 | Whitelist de status + validação `pieceIds ⊆ campaign` | `api/pieces/[id]/route.ts`, `api/deliveries/route.ts` |
| ✅ 5 | `lightenColor()` real (×1.10) — paridade HTML / PPTX | `components/presentation/Slides.tsx:32` |

---

## Próximos passos sugeridos

Ordem proposta pra próxima leva (alto impacto, escopo contido):

1. **Transação em `import-psd`** — envolver `deleteMany + createMany + KV update` em `prisma.$transaction` pra evitar campanha vazia em falha intermediária (bug 1.2).
2. **`beforeunload` no editor com `isDirty`** — alerta nativo do browser pra evitar perda de dados (bug 2.5 + 2.6 + 4.2).
3. **Persist `CampaignAsset.height`** — schema migration + propagação no import + edits (bug 1.4).
4. **Dedup naming de exports** — `buildFileName` precisa diferenciar peças com mesmo formato (bug 5.4).
5. **Validar asset existence no export** — alertar UI quando ZIP vai sair com layer faltando (bug 5.5).
6. **Coordenar `cascadeBrandUpdate` + `propagateBrandTypography`** — endpoint unificado server-side ou lock no client (bug 2.1).
7. **Embedded layer relinking** — quando asset homônimo é criado depois, religar (bug 3.5).
8. **Smart object remap** em re-import — preservar FK quando GUID bate (bug 3.2).
