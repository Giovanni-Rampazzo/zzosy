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

### Primary (CTA destacado)
- `Button variant="primary"` — fundo amarelo #F5C400 + texto preto bold
- USE APENAS pra:
  - Botão "← Voltar" no header (ex: "← Campanhas")
  - **UMA** ação principal por seção (próximo passo mais provável)
- NUNCA mais de um primary visível na mesma área

### Subnavegação (botões agrupados)
- TODOS mesmo estilo (secondary, border 2px #555, fundo branco)
- TODOS mesmo tamanho/altura
- Gap UNIFORME entre eles

### Labels de botões
- **Curtos**: 2-3 palavras máximo
- **Não-didáticos**: "Salvar" não "Salvar alterações"; "← Campanhas" não "← Voltar para Campanhas de XYZ"
- Contexto adicional via `title` (tooltip), não no label visível

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

## 2.8 Como me corrigir

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
