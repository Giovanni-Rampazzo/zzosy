// Tipos compartilhados pra mascaras de layer (raster, vector, clipping).
// Modelo: cada layer pode ter uma mascara que controla a visibilidade.
// Inspirado no Photoshop (Layer Mask, Vector Mask, Clipping Mask).

export type MaskType = "raster" | "vector" | "clipping"

/**
 * Mascara raster: imagem em tons de cinza onde branco = visivel, preto =
 * invisivel, cinza = semi-transparente. Coordenadas relativas ao canvas
 * da peca/matriz (mesmo sistema de posX/posY de qualquer layer).
 */
export interface RasterMaskData {
  // PNG base64 com canal alpha invertido (preto = transparente).
  // Tipicamente exportado do PSD via ag-psd.
  dataUrl: string
  posX: number
  posY: number
  width: number
  height: number
}

/**
 * Mascara vetorial: SVG path. Branco interno (dentro do path) = visivel,
 * fora = invisivel. Suporta retangulos, elipses e paths arbitrarios.
 */
export interface VectorMaskData {
  // SVG path d="..." string. Ex: "M 0 0 L 100 0 L 100 100 L 0 100 Z" (retangulo)
  path: string
  // Bounding box do path em coordenadas do canvas
  posX: number
  posY: number
  width: number
  height: number
}

/**
 * Layer mask completa. Apenas um dos campos (raster | vector | clipping)
 * deve estar preenchido. Type indica qual.
 */
export interface LayerMask {
  type: MaskType
  enabled: boolean       // true = aplica mascara, false = ignora (Disable Mask no PS)
  inverted?: boolean     // true = preto vira branco e vice-versa
  raster?: RasterMaskData
  vector?: VectorMaskData
  // clipping: nao tem dados proprios. Significa "este layer recorta o layer ABAIXO
  // dele (no zIndex). Igual Clipping Mask do Photoshop (Cmd+Opt+G).
  clipping?: boolean
}
