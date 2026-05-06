// Lista de fontes disponiveis pro editor.
// Tenta Local Font Access API primeiro (Chrome/Edge no Mac/Win retornam todas as
// fontes instaladas no sistema, com permissao do usuario). Se nao disponivel, usa
// lista expandida hardcoded com fontes comuns Mac/Win.

// Lista expandida — fallback. Cobre as fontes que aparecem na maioria dos Macs e Windows
// modernos (sistema + Office). Ordem alfabetica.
export const FALLBACK_FONTS: string[] = [
  // Sans-serif
  "Arial", "Arial Black", "Arial Narrow", "Arial Rounded MT Bold",
  "Avenir", "Avenir Next", "Avenir Next Condensed",
  "Calibri", "Cambria", "Candara", "Century Gothic",
  "DIN Alternate", "DIN Condensed",
  "Franklin Gothic Medium", "Futura", "Geneva", "Gill Sans", "Gill Sans MT",
  "Helvetica", "Helvetica Neue", "Impact",
  "Lucida Grande", "Lucida Sans Unicode",
  "Microsoft Sans Serif", "Myriad Pro",
  "Optima", "PT Sans",
  "Segoe UI", "Segoe UI Light", "Segoe UI Semibold",
  "Tahoma", "Trebuchet MS", "Verdana",
  // Serif
  "American Typewriter", "Baskerville", "Big Caslon", "Bodoni 72",
  "Book Antiqua", "Bookman Old Style",
  "Charter",
  "Didot",
  "Garamond", "Georgia",
  "Hoefler Text",
  "Lucida Bright",
  "Palatino", "Palatino Linotype",
  "Times", "Times New Roman",
  // Monospace
  "Andale Mono", "Consolas", "Courier", "Courier New",
  "Lucida Console", "Menlo", "Monaco", "PT Mono",
  "SF Mono",
  // Display / decorative
  "Apple Chancery", "Brush Script MT", "Chalkboard", "Chalkboard SE",
  "Comic Sans MS", "Copperplate",
  "Herculanum",
  "Marker Felt",
  "Papyrus", "Phosphate",
  "Snell Roundhand", "Stencil",
  "Trattatello", "Zapfino",
].sort()

let cache: string[] | null = null
let askedThisSession = false

interface FontData {
  postscriptName: string
  fullName: string
  family: string
  style: string
}

/**
 * Tenta obter a lista de fontes via Local Font Access API.
 * Retorna null se a API nao existir ou o usuario negar permissao.
 */
async function tryLocalFontAccess(): Promise<string[] | null> {
  if (typeof window === "undefined") return null
  const w = window as any
  if (!w.queryLocalFonts) return null
  try {
    const fonts: FontData[] = await w.queryLocalFonts()
    // Reduz pra familias unicas (ignora variantes Bold/Italic etc — Fabric escolhe via fontWeight/fontStyle).
    const families = Array.from(new Set(fonts.map(f => f.family))).sort()
    return families
  } catch (err) {
    // Permissao negada ou erro — silencia, fallback assume.
    return null
  }
}

/**
 * Retorna a lista de fontes disponiveis. Tenta Local Font Access uma vez (cacheado).
 * Se a API nao existir ou usuario negar, retorna FALLBACK_FONTS.
 *
 * `triggerPermissionRequest=true` faz o Chrome mostrar o dialogo de permissao se
 * ainda nao foi concedida. Use apenas em resposta a uma acao do usuario (click).
 */
export async function listAvailableFonts(triggerPermissionRequest = false): Promise<string[]> {
  if (cache) return cache

  // Se nao for chamada com permissao explicita e ja tentamos esta sessao, retorna fallback
  // pra evitar loop de pop-up.
  if (!triggerPermissionRequest && askedThisSession) return FALLBACK_FONTS

  if (triggerPermissionRequest) askedThisSession = true

  const local = await tryLocalFontAccess()
  if (local && local.length > 0) {
    // Mistura local + fallback (algumas web fonts nao aparecem em local), dedup, ordena
    const merged = Array.from(new Set([...local, ...FALLBACK_FONTS])).sort()
    cache = merged
    return merged
  }
  return FALLBACK_FONTS
}

/** Limpa o cache — util pra forcar nova consulta apos usuario adicionar fontes. */
export function clearFontCache() {
  cache = null
  askedThisSession = false
}
