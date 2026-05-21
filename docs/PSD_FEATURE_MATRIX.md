# PSD Feature Matrix — Estado Atual vs Alvo

**Atualizado:** 2026-05-21 (início do refactor)

Tabela acompanha cada feature do Photoshop e em que **fase do refactor** ela sai do estado "gambiarra" pra "profissional fiel".

Legenda:
- ✅ Funciona corretamente (atende a paridade)
- 🟡 Funciona parcialmente (gambiarra ou caso edge falha)
- 🔴 Não suportado / falha silenciosa
- 🚫 Não planejado (fora de escopo)

## Layers

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Raster image (com canvas)            | ✅ | ✅ | 0  |
| Background layer (auto-criado)       | ✅ | ✅ | 0  |
| Folder/Group                          | 🟡 | ✅ | 2  |
| Folder pass-through                  | 🟡 | ✅ | 5  |
| Empty layer / smart filter only      | 🔴 | ✅ | 2  |

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
| Satin                                 | 🔴 | ✅ | 5  |
| Bevel & emboss                        | 🔴 | ✅ | 5  |

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

## Masks

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

## Adjustments

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| Levels                               | 🟡 | ✅ | 5  |
| Curves                               | 🟡 | ✅ | 5  |
| Brightness/Contrast                  | 🟡 | ✅ | 5  |
| Hue/Saturation                       | 🟡 | ✅ | 5  |
| Color Balance                        | 🔴 | ✅ | 5  |
| Black & White                        | 🔴 | ✅ | 5  |
| Invert                               | 🔴 | ✅ | 5  |
| Photo Filter                         | 🔴 | ✅ | 5  |
| Gradient Map                         | 🔴 | ✅ | 5  |
| Selective Color                      | 🔴 | ✅ | 5  |
| Adjustment com clipping (afeta so 1) | 🟡 | ✅ | 5  |
| Adjustment de folder                 | 🔴 | ✅ | 5  |

## Blend Modes (27 total)

| Categoria                  | Modes                                          | Atual | Alvo | Fase |
|----------------------------|------------------------------------------------|:-:|:-:|:-:|
| Normal                     | normal, dissolve                               | 🟡 | ✅ | 5  |
| Darken                     | darken, multiply, colorBurn, linearBurn, darkerColor | 🟡 | ✅ | 5  |
| Lighten                    | lighten, screen, colorDodge, linearDodge, lighterColor | 🟡 | ✅ | 5  |
| Contrast                   | overlay, softLight, hardLight, vividLight, linearLight, pinLight, hardMix | 🔴 | ✅ | 5  |
| Comparative                | difference, exclusion, subtract, divide        | 🔴 | ✅ | 5  |
| HSL                        | hue, saturation, color, luminosity             | 🔴 | ✅ | 5  |
| passThrough (folder)       | passThrough                                    | 🔴 | ✅ | 5  |

## Round-trip (export)

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| PNG export                           | ✅ | ✅ | 6  |
| JPG export                           | ✅ | ✅ | 6  |
| PSD export (basico)                  | 🟡 | ✅ | 6  |
| PSD export com effects               | 🟡 | ✅ | 6  |
| PSD export com smart objects         | 🟡 | ✅ | 6  |
| PSD export com adjustments           | 🔴 | ✅ | 6  |
| PSD export round-trip identico       | 🔴 | 🟡 | 6  |
| PDF export                           | ✅ | ✅ | 6  |

## Outras

| Feature                              | Atual | Alvo | Fase |
|--------------------------------------|:-:|:-:|:-:|
| ICC profile preservation             | 🔴 | 🟡 | 6  |
| CMYK colors                          | 🟡 | ✅ | 6  |
| 16-bit / 32-bit per channel          | 🚫 | 🚫 | —  |
| Layer comps                          | 🚫 | 🚫 | —  |
| Slices / image maps                  | 🚫 | 🚫 | —  |
| 3D layers / video                    | 🚫 | 🚫 | —  |
| Layer styles (presets)               | 🚫 | 🚫 | —  |
| Paths panel (work paths)             | 🚫 | 🚫 | —  |
| Channels (alpha custom)              | 🚫 | 🚫 | —  |
