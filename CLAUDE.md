# ZZOSY — Regras Universais

**LEIA ANTES DE CADA AÇÃO.** Este arquivo é a fonte única de verdade pro padrão do sistema. Toda decisão deve passar por aqui primeiro. Se algo no código contradiz, o código está errado — não esta regra.

Dividido em 3 partes:
- **PARTE 1 — LAYOUT** (visual, estilo, posicionamento)
- **PARTE 2 — LÓGICA / NAVEGAÇÃO** (fluxo, comportamento, UX)
- **PARTE 3 — OUTROS** (técnico específico, anti-padrões, referências)

---

# PARTE 1 — LAYOUT

## 1.1 Botões

### Secondary (padrão default — 90% dos casos)
- `Button variant="secondary"`
- Fundo branco + border 2px #555 + texto preto bold

### Primary (CTA destacado) — USO RESTRITO
- `Button variant="primary"` — fundo amarelo #F5C400 + texto preto bold
- USE APENAS pra:
  - Botão "← Voltar" no header (ex: "← Campanhas")
  - CTA STANDALONE/isolado (ex: full-width "Entrar no Editor" no detalhe de peça)
- NUNCA usar primary em ROW DE AÇÕES — usar padrão de 4 botões outline (ver 1.1.B)

### 1.1.B Padrão de Row de Ações (4 botões outline)
Em TODA linha/card que representa uma entidade (Empresa, Campanha, Peça), a row de ações segue ordem fixa, todos OUTLINE:

| Ordem | Variant | Label | Função |
|---|---|---|---|
| 1 | `danger` (outline vermelho) | **Apagar** | DELETE |
| 2 | `info` (outline azul) | **Duplicar** | clone (via /duplicate endpoint) |
| 3 | `secondary` (outline cinza) | **Editar** | rename inline (prompt) OU page de metadata |
| 4 | `view` (outline amarelo) | **Entrar** | abre a entidade (clients→`/clients/[id]`, campaign→`/campaigns/[id]`, piece→`/editor`) |

Razao: peso visual uniforme entre 4 acoes da mesma entidade. Primary (fill amarelo) cria hierarquia agressiva que nao funciona quando ha multiplas acoes equipotentes. Reservar fill amarelo pra CTAs ISOLADOS.

### Subnavegação (botões agrupados)
- TODOS mesmo estilo (secondary, border 2px #555, fundo branco)
- TODOS mesmo tamanho/altura
- Gap UNIFORME entre eles

### Labels de botões
- **Curtos**: 2-3 palavras máximo
- **Não-didáticos**: "Salvar" não "Salvar alterações"; "← Campanhas" não "← Voltar para Campanhas de XYZ"
- Contexto adicional via `title` (tooltip), não no label visível
- **Verbos PT padrão**: Apagar / Duplicar / Editar / Entrar / Salvar / Cancelar (não "Excluir/Clonar/Renomear/Abrir/Confirmar")

## 1.2 Headers de páginas

- **Título à esquerda** + botão "← Voltar" (primary amarelo) à direita, MESMA LINHA
- `display:flex justify-content:space-between align-items:center`
- Sem breadcrumb "ZZOSY / cliente / campanha"
- Sem labels redundantes (PSD name + counters, etc)

## 1.3 Espaçamento

- Padding container: 16-32px máximo
- MarginBottom entre seções: 12-16px (não 24-32)
- Box padding interno: 12-16px vertical
- Gap entre botões num grupo: 8px
- **Sempre questionar**: "tem espaço vazio sem função aqui?" Se sim, encolher.

## 1.4 Cards

- `background: white, borderRadius: 10, border: 1px solid #E0E0E0`
- Padding 12-16px

## 1.5 Subseções (Labels MATRIZ / CONTEÚDO / etc)

- **NÃO** usar labels uppercase pra separar grupos pequenos (≤5 itens) — gap visual já chega
- USE labels só quando lista é grande/longa E precisa de orientação

## 1.6 Inputs / Forms (visual)

- Number inputs: sem stepper nativo (escondido via `globals.css`)
- Titulo + helper text ANTES do input (não depois)
- Ordem: `label → helper → input`

## 1.7 Alinhamento em rows (campos + botões)

- **SEMPRE** `alignItems: "center"` em row horizontal (input + botões juntos)
- NUNCA `flex-start` mesmo quando textarea pode crescer multi-line
- Botões `size="sm"` (28px alto) precisam alinhar verticalmente com input single-line — center resolve
- Trade-off: em multi-line, botões flutuam no meio vertical. Aceito.
- Regra global em todo ZZOSY (lists, modais, toolbars)

---

# PARTE 2 — LÓGICA / NAVEGAÇÃO

## 2.1 Save prompt

- NUNCA perguntar "salvar?" se user não alterou nada
- Checar `isDirty` antes de qualquer setConfirmExit
- Após init/load, resetar `isDirty = false`

## 2.2 Preview / Realtime (PRERROGATIVA ZZOSY)

- **Thumbs/cards/mini-renders SEMPRE refletem estado atual**
- Stale = bug, sem exceção
- Edit asset → regen pieces que usam o asset
- Save piece → regen thumb
- Cross-tab broadcast (BroadcastChannel)
- Mesmo com 50 janelas abertas: tudo sincroniza

## 2.3 Dot (".") aceita placeholder

- Field vazio + user digita "." = adopta sugestão do placeholder
- Implementar em TODO field com placeholder útil

## 2.4 Navegação sem duplicação

- Se um botão de navegação aparece em 2 lugares (ex: subnav + sidebar), escolher UM lugar só
- NUNCA repetir o mesmo destino visualmente

## 2.5 `+ Adicionar X` dentro da lista

- Header da tabela / toolbar interna da lista
- NUNCA em header separado acima da lista
- Padrão em TODO ZZOSY

## 2.6 Pensar como sistema

- Fix em 1 spot = sweep imediato pra todos os spots similares
- Anti-padrão: deixar pontual
- Se mudou estilo de botão em 1 lugar, replicar em todos similares

## 2.7 Selecionar asset no dropdown = adiciona direto

- Sem botão "Add to canvas" intermediário
- Click no asset = adiciona + fecha popover
- Atalho UX (menos cliques)

## 2.8 Matriz ↔ Peças (propagação)

Matriz = template. Peça = snapshot independente gerado da matriz.

| Ação | Propaga p/ peças geradas? |
|---|---|
| Edit override matriz (text/fill/fontSize/charFills) | ❌ Não — só base pra futuras |
| Add layer matriz | ✅ Sim (overrides vazios) |
| Remove layer matriz | ✅ Sim (apaga mesmo se peça tinha overrides) |
| Edit asset.content | ✅ Sim — TODAS peças via `migrateOverrideText` + remapeamento per-char |
| Edit override em peça gerada | só essa peça |

Implementação: `/api/campaigns/[id]/key-vision/route.ts` (add/remove layer) + `/api/campaigns/[id]/assets/[assetId]/route.ts` (asset → pieces transação atômica). Playground espelha em `/playground/overrides` — usar pra estudar comportamento.

### Precedência de cor per char
1. `overrides.charFills[i]` (per-char específico)
2. `overrides.fill` (cor da layer inteira)
3. `asset.content[span].style.color` (cor original do asset)

Color picker em toolbar de seleção SEMPRE reflete a cor real do primeiro char selecionado (via `resolveCharColor()`).

### Espaços + quebras de linha: ASSET É FONTE ÚNICA (sem override)

**Regra global ZZOSY (2026-05-26):** NENHUMA peça (nem matriz, nem peças geradas) pode dar override no asset pra **espaço** ou **quebra de linha** (`\n`, whitespace, espaços extras). Asset.content é a fonte única de verdade pra essas duas dimensões — sempre.

Por quê: espaço e \n são "estrutura" do texto, não estilo. Se peça pudesse overrider, qualquer edit no asset.content (que migra via Myers LCS diff) ficaria inconsistente — peça com \n extra perderia alinhamento; peça com espaço diferente desincronizaria do per-char mapping. Designer trabalha estrutura no asset.

Implicações:
- Editor da matriz: pode mudar fontSize/fill/charFills/etc, MAS espaço/\n são propagados do asset
- Peças geradas: idem — herdam structure do asset, podem customizar style
- Editar asset.content: TODAS peças updatam o texto literal (espaços + \n inclusos), preservando style overrides via diff Myers
- Validar em `migrateOverrideText`: se peça tentar manter texto com whitespace divergente do asset, ignora e usa o asset

## 2.9 Como me corrigir

- "Você violou regra X" → vou voltar e arrumar
- "atualiza CLAUDE.md com: ..." → vou editar + commitar
- Se discordo, explico antes de mudar

---

# PARTE 3 — OUTROS

## 3.1 PSD Round-trip (Photoshop ⟷ ZZOSY)

### Cadeia completa (toda prop editável precisa)
1. **Reader** (`lib/psd/reader.ts`) — extrai do PSD
2. **toCampaign** (`lib/psd/toCampaign.ts`) — emite asset+layer
3. **Persist** (`/api/campaigns/[id]/import-psd`) — grava DB
4. **Editor load** (`KeyVisionEditor.tsx addAssetToCanvas`) — renderiza Fabric
5. **Export** (`lib/exportPiece.ts`) — Fabric → ag-psd
6. **Writer** (`lib/psd/writer.ts`) — grava PSD

Esquecer 1 step = drift/perda. **TODO fix de import requer revisar export equivalente.**

### Shape ≠ Image
- PSD shape vetorial → asset.type=SHAPE
- Editor renderiza como Fabric.Path com fill/stroke editáveis
- Export volta como shape vetorial (vectorMask preservado)
- **Nunca rasterizar shape silenciosamente**

### Texto editável
- TEXT layer mantém edição (não rasterizar)
- Per-char styles via `obj.styles[line][col]`
- Fabric v6.9.1 NÃO suporta `charSpacing` per-char — usar `lib/fabricCharSpacingPatch.ts`

### Edit de texto: herança de style per-char (Adobe/Figma behavior)
Quando user edita texto que tem per-char styles, `rebuildSpans` reconstrói os spans preservando estilo. Regra de herança pros NOVOS chars:
- **Substituição** (selecionou + digitou por cima) → herda do PRIMEIRO char SUBSTITUÍDO
- **Inserção** (cursor entre chars) → herda do VIZINHO DA ESQUERDA
- **Append** (cursor no fim) → herda do ÚLTIMO char

Detecção: `hadReplacement = prevText.length > prefixLen + suffixLen`. Se true, usa `prevStyles[prefixLen]`. Senão usa `newStyles[i-1]`.

NUNCA usar `defaultStyle` (= primeiro char do asset) pra novos chars — quebra o fluxo Adobe/Figma. Sites afetados: `app/campaigns/[id]/assets/page.tsx` + `app/playground/overrides/page.tsx`.

**Propagação asset → peças (mesmo padrão):** Quando asset.content muda, as peças com `overrides.styles` (per-char) precisam ter os styles MIGRADOS com a mesma regra de herança. Real ZZOSY faz isso server-side via `lib/migrateStyles.ts` (Myers LCS diff: equal/replace mantém, insert herda do vizinho esquerdo, delete some). Chamado no endpoint `/api/campaigns/[id]/assets/[assetId]:PUT` numa transação atômica (asset + KV + todas peças). Playground espelha em `migrateCharFillsForEdit` (versão simplificada com prefix/suffix diff).

## 3.2 Editor / Fabric

### Undo
- Todo listener Fabric que chama `pushHistory` PRECISA do guard `isApplyingHistory` ANTES de qualquer outra lógica
- `applySnapshot` enumera TODAS props customizadas e atribui direto — NÃO confiar em `loadFromJSON`
- Lista de props undo centralizada em UMA constante (`HISTORY_PROPS_TO_INCLUDE`)

### Per-char styles (Fabric Textbox)
- Fabric v7 serializa em ARRAY `{start, end, style}`
- Runtime usa OBJECT `{line: {col: style}}`
- SEMPRE converter via `util.stylesFromArray` ao assignar do snap

### Bleed overlays
- 4 overlays cobrem fora da peça
- `__isBleedOverlay = true` + `excludeFromExport: true`
- FILTRAR antes de save (sem warning — são esperados)

### Helper central ANTES da 4ª cópia
- 3+ sites com código igual = centralizar AGORA
- Drift por copy-paste é causa raiz de bugs

## 3.3 NÃO FAZER (anti-padrões)

- ❌ NÃO inventar UI que o user não pediu (ex: "+ adicionar código" como compensação por remover placeholder)
- ❌ NÃO criar arquivo .md docs/README sem ser pedido
- ❌ NÃO usar emoji em código
- ❌ NÃO adicionar comments óbvios ("// busca o user", "// retorna o array")
- ❌ NÃO usar `console.log` direto — use `editorLog` (silencia em prod)
- ❌ NÃO confirmar destrutivo "tem certeza?" se for reversível (undo cobre)
- ❌ NÃO perguntar "salvar?" quando user não alterou nada
- ❌ NÃO repetir informação em 2 lugares
- ❌ NÃO usar variant primary em mais de UM botão por área
- ❌ NÃO replicar mudança pra outras páginas sem o user pedir explicitamente

## 3.4 Memórias detalhadas

Pra contexto histórico de cada regra, ver `/Users/democrart/.claude/projects/-Users-democrart-Desktop-BACKEND-zzosy/memory/MEMORY.md`. Chaves:
- `feedback_buttons_concise.md` — labels curtos
- `feedback_subnav_button_style.md` — estilo padrão subnav
- `feedback_field_title_subtitle.md` — helper antes do input
- `feedback_no_save_prompt_when_clean.md` — sem prompt quando clean
- `feedback_action_button_inside_list.md` — `+ X` dentro da lista
- `feedback_primary_action_fill_brand.md` — CTA = fill amarelo
- `feedback_realtime_preview_everywhere.md` — preview sempre fresh
- `feedback_dot_accepts_placeholder.md` — "." aceita sugestão
- `feedback_psd_roundtrip.md` — cadeia completa import → edit → export
- `feedback_central_helper_first.md` — centralizar antes da 4ª cópia
- `feedback_system_wide_thinking.md` — fix sweep system-wide
- `feedback_undo_force_restore_all_props.md` — undo enumera tudo
- `project_shape_import_flow.md` — fluxo shape específico
- `project_fabric_charspacing_per_char.md` — limitação Fabric v6
- `feedback_text_edit_inheritance.md` — rebuildSpans Adobe/Figma (substituição vs inserção)
- `project_matriz_pieces_propagation.md` — tabela matriz↔peças + precedência cor
