# PSD Feature Matrix — Estado Atual vs Alvo

**Atualizado:** 2026-05-21 (escopo refinado pelo user)

Tabela acompanha cada feature do Photoshop e em que **fase do refactor** ela sai do estado "gambiarra" pra "profissional fiel à lógica Adobe".

## Escopo confirmado (Giovanni)

**Cobertura prevista:**
- Layer Effects (drop shadow, glow, stroke, overlays, satin, bevel)
- Masks (raster, vector, folder, clipping chain)
- Solid fills + colors
- Alpha channels (transparência preservada em todos os caminhos)
- Texto com runs de estilo, tracking, leading, alinhamento
- Smart Objects (embedded + transform)
- Shapes (paths + fill + stroke)
- Blend modes (todos os 27 oficiais + passThrough)
- Round-trip PSD (import → editar → export idêntico)

**Fora de escopo (não cobrimos):**
- Adjustment layers (Levels, Curves, Hue/Sat, etc) — usuário aplica manualmente
- Smart Filters (filter não-destrutivo) — usuário aplica direto no asset
- 3D layers / video layers / layer comps / slices
- Color modes além de RGB (CMYK preservado pra round-trip, mas não rendering)
- 16-bit / 32-bit per channel
- Layer styles (presets globais)

## Legenda
- ✅ Funciona corretamente (atende à paridade Adobe)
- 🟡 Funciona parcialmente (gambiarra ou caso edge falha)
- 🔴 Não suportado / falha silenciosa
- 🚫 Fora de escopo (decidido)

## Layers

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Raster image (com canvas)            | ✅ | ✅ | 0  |
| Background layer (auto-criado)       | ✅ | ✅ | 0  |
| Folder/Group                         | 🟡 | ✅ | 2  |
| Folder pass-through                  | 🟡 | ✅ | 5  |
| Empty layer (sem pixels)             | 🔴 | ✅ | 2  |

## Texto

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Texto single-style                   | ✅ | ✅ | 1  |
| Texto multi-run (cores/sizes/fonts)  | 🟡 | ✅ | 1  |
| Tracking (charSpacing)               | ✅ | ✅ | 1  |
| Leading (Adobe absolute pt)          | ✅ | ✅ | 1  |
| Line break (\\n)                     | ✅ | ✅ | 1  |
| Variable fonts (wght/ital axes)      | 🟡 | ✅ | 1  |
| Underline / strikethrough            | 🔴 | ✅ | 1  |
| Faux bold / faux italic              | 🟡 | ✅ | 1  |
| Drop shadow + glow no texto          | 🟡 | ✅ | 1  |
| Text on path / warp                  | 🚫 | 🚫 | —  |
| Vertical text                        | 🚫 | 🚫 | —  |

## Image

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Bbox + transform                     | 🟡 | ✅ | 2  |
| Effects nao-baked (vivos)            | 🔴 | ✅ | 2  |
| Color overlay                        | 🟡 | ✅ | 2  |
| Gradient overlay                     | 🟡 | ✅ | 2  |
| Pattern overlay                      | 🔴 | ✅ | 2  |
| Drop shadow + glow                   | 🟡 | ✅ | 2  |
| Stroke effect                        | 🟡 | ✅ | 2  |
| Satin                                | 🔴 | ✅ | 5  |
| Bevel & emboss                       | 🔴 | ✅ | 5  |

## Smart Object

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Smart Object embedded (preview)      | 🟡 | ✅ | 2  |
| Smart Object linked (file path)      | 🔴 | 🟡 | 2  |
| Smart Object com transform           | 🟡 | ✅ | 2  |
| Smart Object com nested PSB          | 🔴 | 🟡 | 2  |
| Smart Filter (filter nao-destrutivo) | 🚫 | 🚫 | —  |
| "Wrapper" detection (duplicacao)     | 🟡 | ✅ | 2  |

## Shape

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Shape com vectorMask + fill          | 🟡 | ✅ | 4  |
| Shape vivo (path editavel)           | 🔴 | ✅ | 4  |
| Vector stroke (largura/cor)          | 🟡 | ✅ | 4  |
| Gradient fill no shape               | 🟡 | ✅ | 4  |
| Pattern fill                         | 🔴 | ✅ | 4  |
| Even-odd vs nonzero                  | 🔴 | ✅ | 4  |
| Dashed stroke                        | 🔴 | ✅ | 4  |
| Compound paths                       | 🔴 | ✅ | 4  |

## Masks (núcleo do refactor — escopo confirmado)

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Raster mask                          | ✅ | ✅ | 3  |
| Vector mask                          | ✅ | ✅ | 3  |
| Folder mask                          | 🟡 | ✅ | 3  |
| Folder mask posRel                   | 🟡 | ✅ | 3  |
| Clipping chain (Layer 1 ← BA ← IMG)  | 🟡 | ✅ | 3  |
| Mask disabled (preservado)           | 🟡 | ✅ | 3  |
| Mask inverted                        | ✅ | ✅ | 3  |
| Mask + folder mask intersection      | 🟡 | ✅ | 3  |
| Mask soft edge (feather)             | 🔴 | ✅ | 3  |
| Mask density                         | 🔴 | ✅ | 3  |

## Alpha / Transparency (escopo confirmado)

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Layer alpha (canvas RGBA)            | ✅ | ✅ | 0  |
| Layer opacity (0-100)                | ✅ | ✅ | 0  |
| Fill opacity (separada de layer op)  | 🔴 | ✅ | 2  |
| Transparência preservada no export   | ✅ | ✅ | 6  |
| Transparency-protected (lock alpha)  | ✅ | ✅ | 0  |
| Alpha channels customizados          | 🔴 | 🟡 | 6  |

## Solid Fills (escopo confirmado)

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Solid Color Fill layer               | 🟡 | ✅ | 0  |
| Background color global              | ✅ | ✅ | 0  |
| Color overlay como effect            | 🟡 | ✅ | 2  |
| Solid color em shape fill            | 🟡 | ✅ | 4  |

## Effects (Layer Styles — escopo confirmado)

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Drop Shadow (offset/blur/spread)     | 🟡 | ✅ | 2  |
| Inner Shadow                         | 🔴 | ✅ | 2  |
| Outer Glow                           | 🟡 | ✅ | 2  |
| Inner Glow                           | 🔴 | ✅ | 2  |
| Stroke (inside/center/outside)       | 🟡 | ✅ | 2  |
| Color Overlay                        | 🟡 | ✅ | 2  |
| Gradient Overlay                     | 🟡 | ✅ | 2  |
| Pattern Overlay                      | 🔴 | ✅ | 2  |
| Satin                                | 🔴 | ✅ | 5  |
| Bevel & Emboss                       | 🔴 | ✅ | 5  |
| Effect blendMode per-effect          | 🔴 | ✅ | 5  |
| Effect opacity per-effect            | 🔴 | ✅ | 5  |

## Adjustment Layers (FORA DE ESCOPO)

| Feature                              | Status |
|--------------------------------------|:-:|
| Levels / Curves / Brightness / etc   | 🚫 |

Decisão: usuário aplica ajustes manualmente no asset antes de importar.
PSDs com Adjustment Layers ignoram esses layers no import. Marca aviso
no console: "Adjustment Layer 'X' ignorado — aplique manualmente."

## Blend Modes (27 total — escopo confirmado pra fidelidade Adobe)

| Categoria                  | Modes                                          | Atual | Alvo | Fase |
|----------------------------|------------------------------------------------|:-:|:-:|:-:|
| Normal                     | normal, dissolve                               | 🟡 | ✅ | 5  |
| Darken                     | darken, multiply, colorBurn, linearBurn, darkerColor | 🟡 | ✅ | 5  |
| Lighten                    | lighten, screen, colorDodge, linearDodge, lighterColor | 🟡 | ✅ | 5  |
| Contrast                   | overlay, softLight, hardLight, vividLight, linearLight, pinLight, hardMix | 🔴 | ✅ | 5  |
| Comparative                | difference, exclusion, subtract, divide        | 🔴 | ✅ | 5  |
| HSL                        | hue, saturation, color, luminosity             | 🔴 | ✅ | 5  |
| passThrough (folder)       | passThrough                                    | 🔴 | ✅ | 5  |

## Round-trip (export — escopo confirmado)

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| PNG export                           | ✅ | ✅ | 6  |
| JPG export                           | ✅ | ✅ | 6  |
| PSD export (basico)                  | 🟡 | ✅ | 6  |
| PSD export com effects vivos         | 🟡 | ✅ | 6  |
| PSD export com smart objects         | 🟡 | ✅ | 6  |
| PSD export round-trip identico       | 🔴 | ✅ | 6  |
| PSD export preserva alpha            | 🟡 | ✅ | 6  |
| PSD export preserva masks            | 🟡 | ✅ | 6  |
| PDF export                           | ✅ | ✅ | 6  |

## Fora de escopo (decidido)

| Feature                              | Status |
|--------------------------------------|:-:|
| Adjustment layers                    | 🚫 |
| Smart Filters                        | 🚫 |
| 3D layers                            | 🚫 |
| Video layers / timeline              | 🚫 |
| Layer comps                          | 🚫 |
| Slices / image maps                  | 🚫 |
| Text warp / vertical text            | 🚫 |
| 16-bit / 32-bit per channel          | 🚫 |
| CMYK rendering (preserva pra export) | 🚫 |
| ICC profile rendering                | 🚫 |
| Channel mixer custom                 | 🚫 |

## Reasoning sobre escopo

User decidiu cortar Adjustments + Smart Filters. Isso simplifica DRASTICAMENTE
o renderer porque:
- Adjustments precisam de offscreen composite com filter chain → complexo
- Smart Filters precisam interpretar filtros não-destrutivos → muito complexo
- Sem essas duas, o renderer fica linear (layer por layer + effects do layer)

A regra fica: **"o que tá visualmente no PSD é o que importamos"**, sem
re-aplicar adjustments. Designer aplica ajustes ANTES de salvar o PSD
final que vai pro ZZOSY. Esse fluxo já é como muitos workflows funcionam.

Decisão consistente com a filosofia ZZOSY de "starting point editável",
não "PSD authoring tool".
