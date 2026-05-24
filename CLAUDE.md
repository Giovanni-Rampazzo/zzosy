# ZZOSY — Regras Universais

**LEIA ANTES DE CADA AÇÃO.** Este arquivo é a fonte única de verdade pro padrão do sistema. Toda decisão de UI/UX/lógica deve passar por aqui primeiro. Se algo no código contradiz, o código está errado — não esta regra.

---

## 1. Botões / Componentes

### Botões secondary (padrão default)
- Fundo branco + border 2px #555 + texto preto bold
- `Button variant="secondary"` (componente existente)
- USE ISSO em 90% dos casos

### Botões primary (CTA destacado)
- Fundo amarelo #F5C400 + texto preto bold
- `Button variant="primary"`
- USE APENAS pra:
  - Botão "← Voltar" no header (ex: "← Campanhas")
  - **UMA** ação principal por seção (o "próximo passo" mais provável)
  - NUNCA mais de um primary visível na mesma área (perde hierarquia)

### Subnavegação (botões agrupados de navegação contextual)
- TODOS com mesmo estilo (border 2px #555, fundo branco)
- TODOS mesmo tamanho/altura
- Gap UNIFORME entre eles (sem agrupar com gap maior — agrupamento via SEÇÃO/LABEL se necessário)
- Se for navegar entre subpáginas, NÃO repetir botões em sidebar + tabs (escolher um lugar só)

### Labels de botões
- **Curtos**: 2-3 palavras máximo
- **Não-didáticos**: "Salvar" não "Salvar alterações", "← Campanhas" não "← Voltar para Campanhas de XYZ"
- Contexto adicional via `title` (tooltip), não no label visível

### Botões `+ Adicionar X` ficam DENTRO da lista
- Header da tabela / toolbar interna da lista
- NUNCA em header separado acima da lista
- Padrão em TODO ZZOSY

---

## 2. Layout / Estrutura

### Headers de páginas
- **Título à esquerda** + botão de ação (geralmente "← Voltar") à direita, MESMA LINHA
- Sem breadcrumb "ZZOSY / cliente / campanha" — poluição visual
- Sem labels redundantes (ex: PSD name + counters no topo)
- Padrão: `display:flex justify-content:space-between align-items:center`

### Espaçamento
- Padding container: 16-32px máximo
- MarginBottom entre seções: 12-16px (não 24-32)
- Box padding interno: 12-16px vertical
- **Sempre questionar**: "tem espaço vazio sem função aqui?" Se sim, encolher.

### Cards
- `background: white, borderRadius: 10, border: 1px solid #E0E0E0`
- Padding 12-16px

### Subseções (Labels MATRIZ / CONTEÚDO / etc)
- **NÃO** usar labels uppercase pra separar grupos pequenos (≤5 itens) — gap visual já chega
- USE labels só quando lista é grande/comprida E precisa de orientação

---

## 3. Inputs / Forms

### Number inputs
- Sem stepper nativo (escondido via globals.css `-webkit-appearance: none`)
- Setas teclado ↑↓ + scroll wheel pra incrementar

### Titulo/Subtitulo em fields
- Descrição/helper text vai ANTES do input (entre label e field), NÃO depois
- Padrão: label → helper → input

### Dot (".") aceita placeholder
- Field vazio + user digita "." = adopta sugestão do placeholder
- Implementar em TODO field com placeholder útil

### Save prompt
- NUNCA perguntar "salvar?" se user não alterou nada
- Checar `isDirty` antes
- Após init/load, resetar `isDirty = false`

---

## 4. Preview / Realtime (PRERROGATIVA ZZOSY)

- **Thumbs/cards/mini-renders SEMPRE refletem estado atual**
- Stale = bug, sem exceção
- Edit asset → regen pieces que usam o asset
- Save piece → regen thumb
- Cross-tab broadcast (BroadcastChannel)
- Mesmo com 50 janelas abertas: tudo sincroniza

---

## 5. PSD Round-trip (Photoshop ⟷ ZZOSY)

### Toda prop editável precisa cadeia ida+volta completa
1. **Reader** (`lib/psd/reader.ts`): extrai do PSD
2. **toCampaign** (`lib/psd/toCampaign.ts`): emite asset+layer
3. **Persist** (`/api/campaigns/[id]/import-psd`): grava no DB
4. **Editor load** (`KeyVisionEditor.tsx addAssetToCanvas`): lê e renderiza Fabric
5. **Export** (`lib/exportPiece.ts`): converte Fabric → ag-psd
6. **Writer** (`lib/psd/writer.ts`): grava PSD

Esquecer 1 step = drift/perda. **TODO fix de import requer revisar export equivalente.**

### Shape ≠ Image
- PSD shape vetorial (vectorMask + vectorFill/Stroke) → asset.type=SHAPE
- Editor renderiza como Fabric.Path com fill/stroke editáveis
- Export volta como shape vetorial (vectorMask preservado)
- **Nunca rasterizar shape silenciosamente** — usuário perde edição vetorial

### Texto editável
- TEXT layer mantém edição (não rasterizar)
- Per-char styles (fontSize, color, charSpacing) preservados via `obj.styles[line][col]`
- Fabric v6.9.1 NÃO suporta `charSpacing` per-char nativamente — usar `lib/fabricCharSpacingPatch.ts`

---

## 6. Editor / Fabric

### Undo
- Todo listener Fabric que chama `pushHistory` PRECISA do guard `isApplyingHistory` ANTES de qualquer outra lógica
- `applySnapshot` enumera TODAS as props customizadas e atribui direto — NÃO confiar em `loadFromJSON`
- Lista de props undo-restored centralizada em UMA constante (`HISTORY_PROPS_TO_INCLUDE`)

### Per-char styles (Fabric Textbox)
- Fabric v7 serializa em ARRAY `{start, end, style}`
- Runtime usa OBJECT `{line: {col: style}}`
- SEMPRE converter via `util.stylesFromArray` ao assignar do snap

### Bleed overlays
- 4 overlays que cobrem fora da peça (mascarar pra preview)
- `__isBleedOverlay = true` + `excludeFromExport: true`
- FILTRAR antes de save: `if (o.__isBleedOverlay) return false`
- NUNCA logar warning sobre eles (são esperados)

### Helper central ANTES da 4ª cópia
- 3+ sites com código igual = centralizar AGORA
- Drift por copy-paste é causa raiz de muitos bugs

---

## 7. Pensar como sistema

- Fix em 1 spot = sweep imediato pra todos os spots similares
- Anti-padrão: deixar pontual
- Ex: se mudou estilo de botão em 1 lugar, replicar em todos similares

---

## 8. NÃO FAZER

- ❌ NÃO inventar UI que o user não pediu (ex: "+ adicionar código" como compensação por remover placeholder)
- ❌ NÃO criar arquivo .md docs/README sem ser pedido
- ❌ NÃO usar emoji em código
- ❌ NÃO adicionar comments óbvios ("// busca o user", "// retorna o array")
- ❌ NÃO usar `console.log` direto em código que vai pra prod — use `editorLog` (silencia em prod)
- ❌ NÃO confirmar destrutivo "tem certeza?" se for reversível (undo cobre)
- ❌ NÃO perguntar "salvar?" quando user não alterou nada
- ❌ NÃO repetir informação em 2 lugares (ex: "Apresentação" no subnav E na sidebar)
- ❌ NÃO usar variant primary em mais de UM botão por área

---

## 9. Memórias detalhadas (Claude memory)

Pra contexto histórico de cada regra, ver `/Users/democrart/.claude/projects/-Users-democrart-Desktop-BACKEND-zzosy/memory/MEMORY.md`. Algumas chaves:
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

---

## 10. Como me corrigir

Se eu violar uma regra dessa lista, me aponta especificamente: "Você violou regra X". Vou voltar e arrumar.

Se uma regra precisa mudar ou ser adicionada, **diga "atualiza CLAUDE.md com:"** + a nova regra. Vou editar este arquivo + fazer commit.
