/**
 * Tipografia da marca — fonte unica de verdade compartilhada por:
 *   - /clients/[id]/edit (UI de setup do cliente)
 *   - /campaigns/[id]/assets (cria texto novo com preset default)
 *   - KeyVisionEditor (sync ao vivo quando user muda preset do cliente)
 *   - api/clients/[id] (PATCH propaga as mudancas pras pecas)
 *
 * Sem este arquivo, cada lugar definia seus proprios defaults — drift entre
 * UI e backend. Filosofia ZZOSY: logica de uma pagina propaga pra todas.
 *
 * Modelo Adobe-style: peso/tamanho/entrelinha/entreletra. Entrelinha em pt
 * absoluto (igual leading do Photoshop). Entreletra em 1/1000 em (mesma
 * unidade do Fabric charSpacing e do tracking PSD).
 */

export type BrandPresetKey = "titulo" | "subtitulo" | "body" | "legenda"

export interface BrandPreset {
  fontWeight: number
  fontSize: number
  /**
   * Entrelinha em pontos (Adobe-style). Compativel com leadingPt usado no
   * KeyVisionEditor. Ao aplicar no Fabric, lineHeight = leadingPt / fontSize.
   */
  leadingPt: number
  /**
   * Entreletra em 1/1000 em (PSD tracking unit, mesma unidade do Fabric
   * charSpacing). Valor positivo = mais espaco; negativo = mais junto.
   */
  charSpacing: number
  /**
   * Familia da fonte. Quando undefined/vazio, usa `client.brandFont` como
   * fallback. Permite ter Titulo numa fonte e Body em outra (Adobe-style
   * paragraph styles). Se setado, sobrescreve a brandFont so pra este preset.
   */
  fontFamily?: string
}

export type BrandTypography = Record<BrandPresetKey, BrandPreset>

export const PRESET_ORDER: BrandPresetKey[] = ["titulo", "subtitulo", "body", "legenda"]

export const PRESET_LABELS: Record<BrandPresetKey, string> = {
  titulo: "Título",
  subtitulo: "Subtítulo",
  body: "Corpo de texto",
  legenda: "Legenda",
}

export const PRESET_DESCRIPTIONS: Record<BrandPresetKey, string> = {
  titulo: "Manchete, headline principal",
  subtitulo: "Apoio do título, destaques",
  body: "Texto corrido, paragrafos",
  legenda: "Crédito, observação, rodapé",
}

// Defaults Adobe/Figma. Adobe Illustrator/InDesign/Photoshop tem "Auto Leading"
// = 120% do fontSize (1.2x). Figma tambem usa 1.2 como default. Entreletra
// (tracking) default = 0 = sem ajuste (mesmo de Adobe/Figma).
//
// Calculo: leadingPt = round(fontSize * 1.2). Numeros usados aqui sao os
// defaults que o user ve a primeira vez que abre /clients/[id]/edit:
//   titulo    80pt → 96pt leading
//   subtitulo 48pt → 58pt leading
//   body      24pt → 29pt leading
//   legenda   16pt → 19pt leading
// User pode sobrescrever a qualquer momento — esses sao apenas os defaults
// iniciais. Quando o user muda fontSize sem mexer no leading, mantemos o
// leading absoluto (Adobe-style: leading e fontSize sao independentes).
export const DEFAULT_TYPOGRAPHY: BrandTypography = {
  titulo:    { fontWeight: 700, fontSize: 80, leadingPt: 96, charSpacing: 0 },
  subtitulo: { fontWeight: 600, fontSize: 48, leadingPt: 58, charSpacing: 0 },
  body:      { fontWeight: 400, fontSize: 24, leadingPt: 29, charSpacing: 0 },
  legenda:   { fontWeight: 400, fontSize: 16, leadingPt: 19, charSpacing: 0 },
}

/**
 * Normaliza dado vindo do banco (pode ter chaves faltando, valores invalidos,
 * versoes antigas sem leadingPt/charSpacing). Sempre retorna BrandTypography
 * completo — UI e propagacao sempre operam em formato canonico.
 */
export function normalizeTypography(raw: any): BrandTypography {
  const out: any = {}
  for (const k of PRESET_ORDER) {
    const r = raw?.[k]
    const def = DEFAULT_TYPOGRAPHY[k]
    out[k] = {
      fontWeight:  Number.isFinite(r?.fontWeight)  ? r.fontWeight  : def.fontWeight,
      fontSize:    Number.isFinite(r?.fontSize)    ? r.fontSize    : def.fontSize,
      leadingPt:   Number.isFinite(r?.leadingPt)   ? r.leadingPt   : def.leadingPt,
      charSpacing: Number.isFinite(r?.charSpacing) ? r.charSpacing : def.charSpacing,
      // fontFamily: string vazio = undefined (cai no brandFont do cliente).
      // Sem isso, preset salvo com "" trazia overrides com fontFamily="" e
      // Fabric caia em fallback CSS.
      fontFamily: (typeof r?.fontFamily === "string" && r.fontFamily.trim()) ? r.fontFamily.trim() : undefined,
    }
  }
  return out
}

/** Compara dois presets de tipografia campo a campo. */
export function presetsEqual(a: BrandPreset | undefined, b: BrandPreset | undefined): boolean {
  if (!a || !b) return false
  return a.fontWeight === b.fontWeight
    && a.fontSize === b.fontSize
    && a.leadingPt === b.leadingPt
    && a.charSpacing === b.charSpacing
    && (a.fontFamily ?? "") === (b.fontFamily ?? "")
}

/**
 * Lista de keys que mudaram entre dois snapshots de brandTypography.
 * Server usa pra decidir o que propagar.
 */
export function diffTypography(oldT: BrandTypography, newT: BrandTypography): BrandPresetKey[] {
  const changed: BrandPresetKey[] = []
  for (const k of PRESET_ORDER) {
    if (!presetsEqual(oldT[k], newT[k])) changed.push(k)
  }
  return changed
}

export const WEIGHT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 100, label: "Thin" },
  { value: 200, label: "ExtraLight" },
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "SemiBold" },
  { value: 700, label: "Bold" },
  { value: 800, label: "ExtraBold" },
  { value: 900, label: "Black" },
]
