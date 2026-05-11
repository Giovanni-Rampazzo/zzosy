// Conversao entre unidades fisicas/relativas e pixels.
// Padrao de impressao/web: DPI define quantos pixels representam 1 polegada.
//
// 1 inch  = dpi px
// 1 cm    = (1/2.54)  × dpi px
// 1 mm    = (1/25.4)  × dpi px
// 1 pt    = (1/72)    × dpi px       (PostScript point)
// 1 pc    = (12/72)   × dpi px       (1 pica = 12 points)
// 1 px    = 1 px
//
// Default DPI 300 (impressao). 72 = padrao tela classico, mas pra impressao
// usamos 300 (ZZOSY padrao).

export type Unit = "px" | "in" | "cm" | "mm" | "pt" | "pc"

export const UNITS: { value: Unit; label: string }[] = [
  { value: "px", label: "Pixels" },
  { value: "in", label: "Inches" },
  { value: "cm", label: "Centimeters" },
  { value: "mm", label: "Millimeters" },
  { value: "pt", label: "Points" },
  { value: "pc", label: "Picas" },
]

/** Converte um valor em uma unidade qualquer pra pixels, dado o DPI. */
export function toPx(value: number, unit: Unit, dpi: number): number {
  if (!isFinite(value) || value <= 0) return 0
  switch (unit) {
    case "px": return Math.round(value)
    case "in": return Math.round(value * dpi)
    case "cm": return Math.round((value / 2.54) * dpi)
    case "mm": return Math.round((value / 25.4) * dpi)
    case "pt": return Math.round((value / 72) * dpi)
    case "pc": return Math.round((value / 6) * dpi)
    default: return Math.round(value)
  }
}

/** Converte pixels pra outra unidade, dado o DPI. Retorna float (UI arredonda se quiser). */
export function fromPx(px: number, unit: Unit, dpi: number): number {
  if (!isFinite(px) || px <= 0) return 0
  switch (unit) {
    case "px": return px
    case "in": return px / dpi
    case "cm": return (px / dpi) * 2.54
    case "mm": return (px / dpi) * 25.4
    case "pt": return (px / dpi) * 72
    case "pc": return (px / dpi) * 6
    default: return px
  }
}
