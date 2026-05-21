# Refactor do PSD Pipeline — Paridade Visual com Photoshop

**Autor:** Claude + Giovanni
**Data início:** 2026-05-21
**Status:** Planejamento

## Por que refatorar

O importer atual (`apps/web/components/campaign/PsdImporter.tsx`, ~2000 linhas) mistura 3 responsabilidades:

1. **Leitura** do PSD via ag-psd
2. **Rendering** (rasterização + composite + bake de effects)
3. **Tradução** pro modelo do editor (assets + layers)

O entrelaçamento causa problemas estruturais que **não tem solução incremental**:

- **Drop shadow dobrada**: importer baka shadow no `layer.canvas` (rasterização) + editor (Fabric) aplica shadow por cima.
- **Smart Object wrapper duplica conteúdo**: PA contém o design completo bakeado, layers acima desenham por cima → 2x visual.
- **Clipping chain quebra silenciosamente**: quando `layer.canvas` falta no clipBase, mask vira placeholder rect → foto não recortada na silhueta correta.
- **Adjustment layers compositados parcialmente** (Levels, Curves, etc).
- **Blend modes** mapeados aproximadamente, alguns silenciosamente ignorados.
- **Vector fill/stroke** rasterizados perdendo edibilidade.

Cada bug acima exige solução individual (heurísticas / fallbacks) que vira **gambiarra**. A solução estrutural é separar leitura de rendering.

## Arquitetura nova

```
┌─────────────────────────────────────────────────────────────────────┐
│                          PSD Pipeline novo                          │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────┐    ┌──────────────────┐    ┌───────────────────────┐
│  PSD bytes   │───▶│  psdReader.ts    │───▶│   PsdDocument         │
│  (.psd file) │    │  (dados puros)   │    │   (TypeScript model)  │
└──────────────┘    └──────────────────┘    └───────────┬───────────┘
                                                        │
                            ┌───────────────────────────┴──────────────┐
                            │                                          │
                            ▼                                          ▼
                  ┌────────────────────┐               ┌───────────────────────┐
                  │ psdToCampaign.ts   │               │  psdRenderer.ts       │
                  │ (assets + layers)  │               │  (preview/composite)  │
                  └─────────┬──────────┘               └───────────┬───────────┘
                            │                                      │
                            ▼                                      ▼
                  ┌────────────────────┐               ┌───────────────────────┐
                  │  ZZOSY DB          │               │  Thumbnail            │
                  │  (assets/pieces)   │               │  (preview UI)         │
                  └────────────────────┘               └───────────────────────┘
```

### Princípios

1. **`PsdDocument` é dados puros** — TypeScript discriminated union. Nenhuma referência a Canvas/DOM/Fabric.
2. **`psdReader.ts` lê e traduz** — zero rendering. Roda em browser ou Node (futuro suporte server-side).
3. **`psdRenderer.ts` rasteriza para preview** — único módulo que compõe pixels. Usado para thumbnail e debug. Não toca no editor.
4. **`psdToCampaign.ts` mapeia para o modelo ZZOSY** — assets + layers + masks. Recebe `PsdDocument`, devolve `CampaignAsset[]` + `KvLayer[]`.
5. **Editor (KeyVisionEditor) é único responsável pela render no canvas** — recebe layers limpos, aplica effects via Fabric properties (Shadow instance, filters, blend modes). **Nada é baked no canvas raster do asset.**

### Por que isso resolve os problemas

| Problema atual                          | Como o novo design resolve                                                                  |
|-----------------------------------------|---------------------------------------------------------------------------------------------|
| Drop shadow dobrada                     | Importer não baka. Editor aplica via `Fabric.Shadow` instance. Fonte única.                |
| Smart Object wrapper duplicado          | `PsdSmartObjectLayer` traz o nested content como referência separada. Renderer escolhe se inclui na composite ou só nos children. |
| Clipping fail silencioso                | `PsdClippingChain` é estrutura explícita com base + clipped layers. Editor renderiza em camadas.|
| Adjustment layers ignoradas             | `PsdAdjustmentLayer.adjustment` (Levels/Curves/etc) é dado. Editor aplica como Fabric filter ou via offscreen composite. |
| Vector fill rasterizado                 | `PsdShapeLayer.vectorFill + vectorStroke + paths`. Editor cria `Fabric.Path` com fill/stroke vivos. |
| Blend modes parcialmente mapeados       | `PsdBlendMode` é enum exaustivo. Mapping `psd → canvas globalCompositeOperation` em UMA função. Não-mapeados → warning explícito. |

## Fases

### Fase 0 — Planejamento (hoje, sessão atual)

- [x] Architecture doc (este arquivo)
- [ ] `lib/psd/types.ts` — todos os tipos
- [ ] `lib/psd/reader.ts` — skeleton + leitura básica
- [ ] Feature matrix doc

**Critério de saída:** user (Giovanni) aprova o data model + concorda com fases seguintes.

### Fase 1 — Reader + Text layer (sessão 1-2)

- [ ] `lib/psd/reader.ts` completo: PSD bytes → PsdDocument
- [ ] Implementar TEXT layer 100% end-to-end:
  - Reader extrai spans com font/size/weight/style/color/tracking/leading/align
  - `psdToCampaign` cria TEXT asset com spans
  - Editor render: Fabric.Textbox + styles per-char + effects via Fabric props
  - **Nenhum bake no canvas**
- [ ] Test fixture: 3 PSDs com text + drop shadow + outras effects
- [ ] Validação visual: text + shadow renderiza igual PS (ou explicitar diferença)

**Critério de saída:** drop shadow não dobra mais. Texto multi-line + multi-style renderiza fielmente.

### Fase 2 — Image + Smart Object (sessão 3-4)

- [ ] Reader extrai image layers (raster) com bbox + transform + effects metadata
- [ ] Reader extrai Smart Objects com `placedLayer` + transform + nested content
- [ ] `psdToCampaign` cria IMAGE assets com effects no asset metadata (não baked)
- [ ] Editor render aplica effects via Fabric: drop shadow, color overlay, stroke, glow
- [ ] Smart Object wrapper detection sem heurística — usa nested structure

**Critério de saída:** image layers renderizam com effects vivos, nada baked.

### Fase 3 — Masks + Clipping (sessão 5-6)

- [ ] `PsdMaskData` discriminated union: raster (canvas data) | vector (SVG path) | clipping (referência ao base)
- [ ] Clipping chain explícita: `PsdClippingChain { base: PsdLayer; clipped: PsdLayer[] }`
- [ ] Editor render compõe clipping via offscreen Fabric.Group ou globalCompositeOperation
- [ ] Folder masks via inheritedMask herdada explicitamente

**Critério de saída:** shield-mask do Sicredi renderiza exatamente como PS, sem fallback rect.

### Fase 4 — Shapes + Vector (sessão 7)

- [ ] `PsdShapeLayer` com vectorPath + vectorFill (solid/gradient/pattern) + vectorStroke
- [ ] Editor cria `Fabric.Path` com fill/stroke nativos
- [ ] Edição vetorial no editor (sem rasterizar)

### Fase 5 — Adjustment + Blend Modes (sessão 8-9)

- [ ] `PsdAdjustmentLayer` types: Levels, Curves, HueSat, ColorBalance, Brightness, Contrast, etc
- [ ] Editor aplica via Fabric `Filter` ou offscreen composite
- [ ] Blend modes: mapping completo PSD → canvas + fallback documentado

### Fase 6 — Round-trip (sessão 10-11)

- [ ] `psdWriter.ts` — PsdDocument → PSD bytes (via ag-psd write)
- [ ] Editor → PsdDocument → bytes (export funcional)
- [ ] Test: import PSD → export PSD → diff binário aceitável

### Fase 7 — Cleanup (sessão 12)

- [ ] Deletar `PsdImporter.tsx` legado (manter import history em git)
- [ ] Deletar gambiarras: `autoHideWrapperSmartObjects`, fallback composite slice em mask, etc
- [ ] Documentar limitações remanescentes em ARCHITECTURE.md

## Estimativa

**~10 sessões** de trabalho focado (1 sessão = 2-4 horas de Claude).

Considerando ~2-3 sessões por semana, **3-4 semanas de calendário**.

## Riscos

1. **ag-psd limitações:** algumas features do PSD podem não ser expostas pela lib. Mitigação: documentar no feature matrix, propor fallback.
2. **Fabric.js limitações:** filters/composite specs diferentes do PSD. Mitigação: usar offscreen canvas + drawImage com globalCompositeOperation pra blends complexos.
3. **Performance:** modelo separado vs baked pode ser mais lento (effects calculados live). Mitigação: cache de render quando layer não muda.
4. **Regressão visual:** durante a transição, alguns PSDs podem ficar piores antes de ficar melhores. Mitigação: branch separado, comparison testing com fixtures.

## Decisão necessária do user

**Antes de seguir pra Fase 1, preciso de:**

1. Aprovação do data model (após F12.2)
2. Confirmação que não tem feature urgente que dependa do importer atual nas próximas 3 semanas
3. Branch strategy: `claude/psd-refactor` ou continuar no branch atual?
