// Lista de fontes disponiveis pro editor.
// Tenta Local Font Access API primeiro (Chrome/Edge no Mac/Win retornam todas as
// fontes instaladas no sistema, com permissao do usuario). Se nao disponivel, usa
// lista expandida hardcoded com fontes comuns Mac/Win.

export interface FontFamily {
  /** Nome canonico da familia (ex: "Helvetica Neue") */
  family: string
  /**
   * Variantes desta familia, mapeando label legivel pra fontFamily real a aplicar.
   * Ex: { "Regular": "Helvetica Neue", "Bold": "Helvetica Neue Bold" }.
   * O label "Regular" e' sempre o canonico.
   */
  variants: Record<string, string>
}

// Lista expandida — fallback. Variantes inferidas a partir das mais comuns no macOS/Win.
// Cada item: { family, variants: { label -> fontFamily real } }
const FALLBACK_FONT_FAMILIES: FontFamily[] = [
  // Sans-serif
  { family: "Arial", variants: { "Regular": "Arial", "Bold": "Arial Bold", "Italic": "Arial Italic", "Bold Italic": "Arial Bold Italic", "Black": "Arial Black", "Narrow": "Arial Narrow" } },
  { family: "Avenir", variants: { "Regular": "Avenir", "Light": "Avenir Light", "Book": "Avenir Book", "Medium": "Avenir Medium", "Heavy": "Avenir Heavy", "Black": "Avenir Black" } },
  { family: "Avenir Next", variants: { "Regular": "Avenir Next", "Ultra Light": "Avenir Next Ultra Light", "Medium": "Avenir Next Medium", "Demi Bold": "Avenir Next Demi Bold", "Bold": "Avenir Next Bold", "Heavy": "Avenir Next Heavy" } },
  { family: "Calibri", variants: { "Regular": "Calibri", "Light": "Calibri Light", "Bold": "Calibri Bold", "Italic": "Calibri Italic" } },
  { family: "Cambria", variants: { "Regular": "Cambria", "Bold": "Cambria Bold" } },
  { family: "Candara", variants: { "Regular": "Candara", "Bold": "Candara Bold" } },
  { family: "Century Gothic", variants: { "Regular": "Century Gothic", "Bold": "Century Gothic Bold" } },
  { family: "Franklin Gothic", variants: { "Regular": "Franklin Gothic", "Medium": "Franklin Gothic Medium", "Book": "Franklin Gothic Book", "Demi": "Franklin Gothic Demi", "Heavy": "Franklin Gothic Heavy" } },
  { family: "Futura", variants: { "Regular": "Futura", "Medium": "Futura Medium", "Bold": "Futura Bold", "Condensed": "Futura Condensed" } },
  { family: "Geneva", variants: { "Regular": "Geneva" } },
  { family: "Gill Sans", variants: { "Regular": "Gill Sans", "Light": "Gill Sans Light", "Bold": "Gill Sans Bold", "UltraBold": "Gill Sans UltraBold" } },
  { family: "Helvetica", variants: { "Regular": "Helvetica", "Light": "Helvetica Light", "Bold": "Helvetica Bold", "Oblique": "Helvetica Oblique" } },
  { family: "Helvetica Neue", variants: { "Regular": "Helvetica Neue", "Ultra Light": "Helvetica Neue UltraLight", "Thin": "Helvetica Neue Thin", "Light": "Helvetica Neue Light", "Medium": "Helvetica Neue Medium", "Bold": "Helvetica Neue Bold", "Condensed Bold": "Helvetica Neue Condensed Bold", "Black": "Helvetica Neue Black" } },
  { family: "Impact", variants: { "Regular": "Impact" } },
  { family: "Lucida Grande", variants: { "Regular": "Lucida Grande", "Bold": "Lucida Grande Bold" } },
  { family: "Optima", variants: { "Regular": "Optima", "Italic": "Optima Italic", "Bold": "Optima Bold", "Extra Black": "Optima ExtraBlack" } },
  { family: "Segoe UI", variants: { "Regular": "Segoe UI", "Light": "Segoe UI Light", "Semibold": "Segoe UI Semibold", "Bold": "Segoe UI Bold" } },
  { family: "Tahoma", variants: { "Regular": "Tahoma", "Bold": "Tahoma Bold" } },
  { family: "Trebuchet MS", variants: { "Regular": "Trebuchet MS", "Bold": "Trebuchet MS Bold", "Italic": "Trebuchet MS Italic" } },
  { family: "Verdana", variants: { "Regular": "Verdana", "Bold": "Verdana Bold", "Italic": "Verdana Italic" } },

  // Serif
  { family: "American Typewriter", variants: { "Regular": "American Typewriter", "Light": "American Typewriter Light", "Bold": "American Typewriter Bold" } },
  { family: "Baskerville", variants: { "Regular": "Baskerville", "Italic": "Baskerville Italic", "Bold": "Baskerville Bold", "SemiBold": "Baskerville SemiBold" } },
  { family: "Big Caslon", variants: { "Regular": "Big Caslon" } },
  { family: "Bodoni 72", variants: { "Regular": "Bodoni 72", "Book": "Bodoni 72 Book", "Bold": "Bodoni 72 Bold" } },
  { family: "Book Antiqua", variants: { "Regular": "Book Antiqua", "Bold": "Book Antiqua Bold" } },
  { family: "Charter", variants: { "Regular": "Charter", "Bold": "Charter Bold", "Black": "Charter Black" } },
  { family: "Didot", variants: { "Regular": "Didot", "Italic": "Didot Italic", "Bold": "Didot Bold" } },
  { family: "Garamond", variants: { "Regular": "Garamond", "Bold": "Garamond Bold" } },
  { family: "Georgia", variants: { "Regular": "Georgia", "Bold": "Georgia Bold", "Italic": "Georgia Italic" } },
  { family: "Hoefler Text", variants: { "Regular": "Hoefler Text", "Italic": "Hoefler Text Italic", "Black": "Hoefler Text Black" } },
  { family: "Palatino", variants: { "Regular": "Palatino", "Italic": "Palatino Italic", "Bold": "Palatino Bold" } },
  { family: "Times New Roman", variants: { "Regular": "Times New Roman", "Italic": "Times New Roman Italic", "Bold": "Times New Roman Bold" } },

  // Monospace
  { family: "Andale Mono", variants: { "Regular": "Andale Mono" } },
  { family: "Consolas", variants: { "Regular": "Consolas", "Bold": "Consolas Bold" } },
  { family: "Courier", variants: { "Regular": "Courier", "Bold": "Courier Bold" } },
  { family: "Courier New", variants: { "Regular": "Courier New", "Bold": "Courier New Bold" } },
  { family: "Menlo", variants: { "Regular": "Menlo", "Bold": "Menlo Bold" } },
  { family: "Monaco", variants: { "Regular": "Monaco" } },
  { family: "SF Mono", variants: { "Regular": "SF Mono", "Light": "SF Mono Light", "Medium": "SF Mono Medium", "Bold": "SF Mono Bold" } },

  // Display
  { family: "Apple Chancery", variants: { "Regular": "Apple Chancery" } },
  { family: "Brush Script MT", variants: { "Regular": "Brush Script MT" } },
  { family: "Chalkboard SE", variants: { "Regular": "Chalkboard SE", "Bold": "Chalkboard SE Bold" } },
  { family: "Comic Sans MS", variants: { "Regular": "Comic Sans MS", "Bold": "Comic Sans MS Bold" } },
  { family: "Copperplate", variants: { "Regular": "Copperplate", "Light": "Copperplate Light", "Bold": "Copperplate Bold" } },
  { family: "Marker Felt", variants: { "Regular": "Marker Felt", "Wide": "Marker Felt Wide" } },
  { family: "Papyrus", variants: { "Regular": "Papyrus" } },
  { family: "Snell Roundhand", variants: { "Regular": "Snell Roundhand", "Bold": "Snell Roundhand Bold", "Black": "Snell Roundhand Black" } },
  { family: "Zapfino", variants: { "Regular": "Zapfino" } },
].sort((a, b) => a.family.localeCompare(b.family))

/** Lista achatada (ainda exportada pra back-compat). */
export const FALLBACK_FONTS: string[] = FALLBACK_FONT_FAMILIES.map(f => f.family)

let cache: FontFamily[] | null = null
let askedThisSession = false

interface SystemFontData {
  postscriptName: string
  fullName: string
  family: string
  style: string
}

/**
 * Tenta obter familias com variantes via Local Font Access API.
 * Retorna null se a API nao existir ou o usuario negar permissao.
 */
async function tryLocalFontAccess(): Promise<FontFamily[] | null> {
  if (typeof window === "undefined") return null
  const w = window as any
  if (!w.queryLocalFonts) return null
  try {
    const fonts: SystemFontData[] = await w.queryLocalFonts()
    // Agrupa por familia, label = style (Regular/Light/Bold/etc), value = fullName
    const map = new Map<string, Record<string, string>>()
    for (const f of fonts) {
      if (!map.has(f.family)) map.set(f.family, {})
      const variants = map.get(f.family)!
      const styleLabel = (f.style || "Regular").trim() || "Regular"
      if (!variants[styleLabel]) {
        variants[styleLabel] = f.fullName || f.family
      }
    }
    const result: FontFamily[] = []
    for (const [family, variants] of map) result.push({ family, variants })
    return result.sort((a, b) => a.family.localeCompare(b.family))
  } catch {
    return null
  }
}

/**
 * Retorna a lista de familias (com variantes). Tenta Local Font Access uma vez (cacheado).
 * Se a API nao existir ou usuario negar, retorna FALLBACK_FONT_FAMILIES.
 *
 * IMPORTANTE: nao mesclamos local + fallback. O fallback contem variantes assumidas
 * (ex: "Helvetica Neue Bold") que podem nao existir no formato exato no sistema do
 * usuario (pode ser "HelveticaNeue-Bold" sem espaco etc). Misturar gera fontes fantasma
 * que o navegador nao acha — texto vira fallback CSS aleatorio. Por isso, ou usamos as
 * fontes reais do sistema, ou as do fallback inteiramente.
 */
export async function listFontFamilies(triggerPermissionRequest = false): Promise<FontFamily[]> {
  if (cache) return cache
  if (!triggerPermissionRequest && askedThisSession) return FALLBACK_FONT_FAMILIES
  if (triggerPermissionRequest) askedThisSession = true

  const local = await tryLocalFontAccess()
  if (local && local.length > 0) {
    cache = local
    return local
  }
  cache = FALLBACK_FONT_FAMILIES
  return FALLBACK_FONT_FAMILIES
}

/**
 * Back-compat: retorna so a lista de nomes de familia.
 * @deprecated use listFontFamilies pra ter as variantes
 */
export async function listAvailableFonts(triggerPermissionRequest = false): Promise<string[]> {
  const families = await listFontFamilies(triggerPermissionRequest)
  return families.map(f => f.family)
}

/**
 * Dado o fontFamily aplicado a um texto, descobre a familia base e o variant label.
 * Ex: "Helvetica Neue Bold" -> { family: "Helvetica Neue", variant: "Bold" }
 * Pra isso percorre todas as familias conhecidas e ve qual variant matches.
 * Se nao acha, retorna { family: appliedName, variant: "Regular" }.
 */
export function findFamilyAndVariant(appliedFontFamily: string, families: FontFamily[]): { family: string; variant: string } {
  if (!appliedFontFamily) return { family: "Arial", variant: "Regular" }
  for (const fam of families) {
    for (const [label, value] of Object.entries(fam.variants)) {
      if (value === appliedFontFamily) return { family: fam.family, variant: label }
    }
  }
  // Talvez o texto tenha sido salvo so com nome de familia sem variante
  const exact = families.find(f => f.family === appliedFontFamily)
  if (exact) return { family: exact.family, variant: "Regular" }
  return { family: appliedFontFamily, variant: "Regular" }
}

/** Limpa o cache — util pra forcar nova consulta apos usuario adicionar fontes. */
export function clearFontCache() {
  cache = null
  askedThisSession = false
}
