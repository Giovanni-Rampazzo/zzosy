# MANIFESTO ZZOSY

Documento de referência: decisões, padrões e métodos do ZZOSY.

---

## 1. CONTEXTO E STACK

**ZZOSY** — SaaS B2B multi-tenant pra automação de layout de campanhas. Diretor: Giovanni (SUPER_ADMIN). Status: produção interna, sem clientes pagantes.

**Stack:** Next.js 16 (Turbopack) + React 19 + Fabric.js v7.2 + ag-psd v30.1.1 + Prisma 5.22 + MySQL local + NextAuth + Stripe. macOS only. Código English, comunicação PT-BR.

**Repo:** `Giovanni-Rampazzo/zzysy` · `main` · `~/Desktop/BACKEND/zzysy`.

**Comando "Run":**
```bash
cd ~/Desktop/BACKEND/zzysy && git fetch origin && git reset --hard origin/main && cd apps/web && rm -rf .next && npm run dev
```
Ctrl+C antes se servidor rodando. Depois `✓ Ready` → F12 → Empty Cache + Hard Reload.

---

## 2. PRINCÍPIOS DE TRABALHO

- PT-BR sempre. Código em inglês.
- Respostas curtas, verificadas.
- Sem comentários sobre cansaço/horário.
- Claude propõe, Giovanni aprova.
- Pensar Adobe/Apple. Photoshop é referência ESTRITA quando citado.
- Investigar antes de chutar. Ler todo o código relevante.
- Sem workarounds. Resolve causa raiz.
- Consistência total.

---

## 3. SISTEMA DE BOTÕES (`<Button>`)

**Componente único:** `components/ui/Button.tsx`. **Todo botão do app DEVE usar esse componente**, sem exceção. Inclui file inputs (botões de upload) — via `onFileSelect` + `accept`.

**Variants:**
| Variant | Quando usar |
|---|---|
| `primary` (amarelo cheio) | Próxima ação provável do fluxo. Máximo 1-2 por área. |
| `secondary` (branco + borda cinza) | Default neutro |
| `danger` (outline vermelho) | Apagar, destrutivo |
| `success` (outline verde) | Confirmar, aprovar |
| `warning` (outline laranja) | Avisos |
| `info` (outline azul) | Duplicar, copiar |
| `ghost` (outline cinza claro) | Secundário/menos importante |
| `dark` (preto cheio) | Navegação ativa/disabled |
| `link` (texto amarelo) | Navegação inline em prosa |

**Regra:** todo botão com fill branco PRECISA de borda visível (exceto `primary` e `link`).

**Tamanhos:** `sm` (px-3 py-1.5 text-xs) · `md` default (px-4 py-2 text-sm) · `lg` (px-6 py-2.5 text-base).

**File input:**
```jsx
<Button variant="primary" accept=".psd" onFileSelect={f => handleFile(f)}>Importar PSD</Button>
```

---

## 4. NAVEGAÇÃO EM 3 CAMADAS

1. **Topnav global:** Clientes / Campanhas / Peças / Mídias / Aprovação / Entregas / Admin / Account.
2. **CampaignSubnav contextual:** linha 1 (← Cliente + Peças amarelo), linha 2 (actions específicas da página).
3. **Conteúdo:** filtros, sorts, tabelas. Botões `sm` ou `md`.

**Lógica do amarelo:** botão amarelo = o que o user provavelmente vai clicar a seguir.

---

## 5. EDITOR (KeyVisionEditor)

- Padding lateral em textos: 12% de cada lado (direção arte ZZOSY).
- 300 DPI default.
- Atalhos: Cmd+Shift+L/C/R/J (alinhamento), Cmd+Shift+>/< (font size ±4pt), Option+↑/↓ (leading ±1pt), Cmd+Opt+G (clipping mask).
- Tipografia Adobe-style: `leadingPt` absoluto é fonte da verdade. Mudar fontSize NÃO afeta leading.
- Textbox NUNCA usa scaleX/scaleY — consolida em fontSize + width + styles + leadingPt.
- Scale buttons 20/40/60/80% são ABSOLUTOS (não cumulativos). Ancoram no centro atual.
- Styles per-char: sempre `obj.dirty = true` antes de `requestRenderAll()`.
- Aceita: PNG, JPG, WEBP, GIF, SVG. Exclui: EPS, AI (CVE risk multi-tenant).
- **Canvas Photoshop-style:** canvas DOM ocupa toda área visível, peça centralizada via viewportTransform. Bleed overlays cobrem fora da peça dinamicamente. Handles funcionam em qualquer lugar do canvas.

---

## 6. THUMBNAILS

- **Peças:** PNG 2400px lossless. Gerado pelo `uploadPieceThumb` (StaticCanvas offscreen, clone sequencial com `for...of` pra preservar z-index, reaplica styles per-char + masks).
- **Matriz (KV):** mesmo formato. Crop lê viewportTransform[4,5] pra cortar exatamente a área da peça (ignora bleed).
- **Auto-regen:** ao abrir peça com thumb desatualizado (JPG antigo), uploadPieceThumb regenera silenciosamente.
- **Cache-bust:** todas `<img>` de preview usam `?v=${loadTs}`.

---

## 7. ASSETS

- Asset novo (Texto ou Imagem) entra com `order = (min - 1)` → aparece em PRIMEIRO na lista.
- Lista ordenada `order ASC` (sortedAssets em assets/page.tsx).

---

## 8. APRESENTAÇÃO

Hierarquia: Segment → Vehicle → Pieces.

Slide divisor: fundo amarelo cheio (Segment) ou amarelo claro (Vehicle).

Slide de peça: nome 55% menor, dimensão sem box (texto bold), imagem centralizada sem border.

Export PPTX: pptxgenjs 13.333×7.5" (16:9 widescreen), PNG 2400px.

---

## 9. MODELO DE DADOS

- Multi-tenancy via `tenantId`.
- Modelos: Tenant, User, Client, Campaign, CampaignAsset, KeyVision, Piece, MediaFormat, Delivery, DeliveryFile, DeliveryPiece.
- **Faltam (referenciados em Stripe routes mas não existem):** `Plan`, `Subscription`. Vai quebrar em produção.
- MediaFormat: `widthValue`/`heightValue`/`widthUnit`/`heightUnit`/`dpi` em unidades físicas (cm/mm/in/pt/pc/px), via `lib/unitConversion.ts`.

---

## 10. INFRA

- Local dev only. Sem Vercel/Railway no ZZOSY.
- Backup MySQL local apenas — **risco crítico.**
- LGPD pendente: política, consent, right-to-erasure, audit log, encryption at rest, Stripe DPA.
- Prisma: NUNCA `migrate dev` em produção. Sempre `migrate deploy`.

---

## 11. CHECKLIST PRÉ-MUDANÇA GRANDE

1. Ler todo o código relevante (componente + helpers + tipos)
2. Simular fluxo do usuário mentalmente
3. Identificar trade-offs e pendências
4. Propor plano com escopo + tempo + riscos
5. Esperar aprovação
6. Implementar
7. `tsc` check (erros pré-existentes ok, novos não)
8. Commit descritivo (problema + fix + trade-offs)
9. Push + reportar SHA

---

## 12. PROMPT PADRÃO PRA SESSÕES NOVAS

> Sou Giovanni Rampazzo, diretor de arte e SUPER_ADMIN da ZZOSY — SaaS multi-tenant de automação de layout de campanhas. Stack: Next.js 16 + React 19 + Fabric.js v7.2 + ag-psd + Prisma 5.22 + MySQL local. Mac only. Código English, comunicação PT-BR.
>
> Repositório: `Giovanni-Rampazzo/zzysy` · branch `main` · `~/Desktop/BACKEND/zzysy`.
>
> Princípios: pensar como Adobe/Apple, Photoshop como referência ESTRITA, investigar antes de chutar, sem workarounds, qualidade comercial. Eu aprovo planos, você executa.
>
> **Sistema de design:** TODO botão usa o componente `<Button>` em `components/ui/Button.tsx`. File inputs também (props `onFileSelect` + `accept`). Sem botões custom em CSS/inline.
>
> Padding 12% lateral em textos, 300 DPI default, leading absoluto em pt. Canvas do editor é Photoshop-style (ocupa toda área visível, peça centralizada).
>
> Comando "Run":
> ```
> cd ~/Desktop/BACKEND/zzysy && git fetch origin && git reset --hard origin/main && cd apps/web && rm -rf .next && npm run dev
> ```

---

## 13. ATUALIZAÇÕES

Atualizar este arquivo sempre que:
- Padrão novo for estabilizado
- Decisão de produto for tomada
- Convenção de código for adotada
- Infra mudar
