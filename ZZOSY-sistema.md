# ZZOSY — Sistema

SaaS multi-tenant de **automação de layout** para campanhas publicitárias.
Arquitetura: agência (tenant) → cliente → campanha → key vision (matriz) → peças.

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

## Status

Editor + PSD round-trip em produção interno. Próximos: refinos finos de leading/tracking, gradient stops, defaultStyle round-trip completo.
