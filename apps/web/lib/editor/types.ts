// Tipos canonicos do editor — extraidos de KeyVisionEditor.tsx
// (2026-05-28) pra reduzir o arquivo principal e acelerar hot-reload.

export interface TextSpan {
  text: string
  style: { color?: string; fontSize?: number; fontWeight?: string; fontFamily?: string }
}

export interface Asset {
  id: string; type: string; label: string; value: string | null
  imageUrl: string | null; content: any
  lastOverride?: any
  // Smart Object preservado do PSD original (round-trip ZZOSY ↔ Photoshop).
  // null/undefined = asset eh IMAGE comum (PNG/JPG/SVG).
  smartObject?: {
    id: string
    guid: string
    filePath: string
    mime: string
    originalName: string
    width: number | null
    height: number | null
  } | null
}

export interface Layer {
  assetId: string; posX: number; posY: number
  scaleX: number; scaleY: number; rotation: number; zIndex: number; width: number; height?: number
  overrides?: any
}

export interface BrandColor {
  hex: string
  name?: string | null
  role?: "principal" | "secundaria" | "apoio" | "neutra" | "primary" | "secondary"
}

export interface CustomFontFile {
  url: string
  weight: number
  style: "normal" | "italic"
  fileName: string
}

export interface Campaign {
  id: string; name: string
  client: {
    id: string; name: string
    brandFont?: string | null
    brandColors?: BrandColor[] | null
    customFontFiles?: CustomFontFile[] | null
  }
  assets: Asset[]
  keyVision: { bgColor: string; layers: Layer[] | null; width?: number; height?: number; data?: any } | null
}

// ========================
// Background layer types
// ========================
// BG vira layer real (igual Photoshop). Pode ter varias empilhadas; ordem
// no array = ordem visual (idx 0 = fundo, ultimo = mais em cima dos BGs,
// mas TODOS abaixo de qualquer asset).
export type BgGradientStop = { offset: number; color: string }

// BlendMode usa nomes Canvas API (= valores aceitos em globalCompositeOperation).
// "source-over" eh o default ("Normal" no Photoshop).
export type BgBlendMode =
  | "source-over" | "multiply" | "screen" | "overlay"
  | "darken" | "lighten" | "color-dodge" | "color-burn"
  | "hard-light" | "soft-light" | "difference" | "exclusion"
  | "hue" | "saturation" | "color" | "luminosity"

export type BgLayerCommon = {
  opacity: number
  hidden?: boolean
  locked?: boolean
  blendMode?: BgBlendMode
  mask?: any // reusa schema do __maskData dos asset layers
  // Brand ref: indice em Client.brandColors. Quando setado, a cor solid
  // (kind="solid") eh ressincronizada automaticamente com brandColors[idx].hex
  // no load do canvas. Outros kinds ignoram esse campo.
  colorBrandIdx?: number
}

export type BgImageFit = "cover" | "contain" | "fill" | "tile"

export type BgLayerData =
  | (BgLayerCommon & { kind: "solid"; color: string })
  | (BgLayerCommon & { kind: "gradient"; gradientType: "linear" | "radial"; angle: number; stops: BgGradientStop[] })
  | (BgLayerCommon & { kind: "image"; imageDataUrl: string; fit: BgImageFit })
