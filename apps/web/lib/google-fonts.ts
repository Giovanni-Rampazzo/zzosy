/**
 * Lista curada de Google Fonts populares pra identidade visual de marca.
 * Agrupadas por categoria. Foco em fontes versateis com mais de 1 peso.
 *
 * Pra adicionar uma fonte nova: nome exato do Google Fonts (case-sensitive).
 * O loader abaixo monta a URL automaticamente.
 */

export interface FontOption {
  name: string
  category: "sans" | "serif" | "display" | "mono" | "handwriting"
}

export const GOOGLE_FONTS: FontOption[] = [
  // Sans-serif (mais usadas em UI e branding moderno)
  { name: "Inter", category: "sans" },
  { name: "Roboto", category: "sans" },
  { name: "Open Sans", category: "sans" },
  { name: "Lato", category: "sans" },
  { name: "Montserrat", category: "sans" },
  { name: "Poppins", category: "sans" },
  { name: "Nunito", category: "sans" },
  { name: "Raleway", category: "sans" },
  { name: "Work Sans", category: "sans" },
  { name: "Manrope", category: "sans" },
  { name: "DM Sans", category: "sans" },
  { name: "Plus Jakarta Sans", category: "sans" },
  { name: "Outfit", category: "sans" },
  { name: "Figtree", category: "sans" },
  { name: "Karla", category: "sans" },
  { name: "Mulish", category: "sans" },
  { name: "Public Sans", category: "sans" },
  { name: "Source Sans 3", category: "sans" },

  // Serif (mais formais, editoriais)
  { name: "Playfair Display", category: "serif" },
  { name: "Merriweather", category: "serif" },
  { name: "Lora", category: "serif" },
  { name: "EB Garamond", category: "serif" },
  { name: "Cormorant Garamond", category: "serif" },
  { name: "Crimson Pro", category: "serif" },
  { name: "Spectral", category: "serif" },
  { name: "Libre Baskerville", category: "serif" },
  { name: "Source Serif 4", category: "serif" },

  // Display (titulos com personalidade)
  { name: "Oswald", category: "display" },
  { name: "Bebas Neue", category: "display" },
  { name: "Anton", category: "display" },
  { name: "Archivo Black", category: "display" },
  { name: "Abril Fatface", category: "display" },

  // Monospace (tech, codigo)
  { name: "JetBrains Mono", category: "mono" },
  { name: "Fira Code", category: "mono" },
  { name: "IBM Plex Mono", category: "mono" },
  { name: "Roboto Mono", category: "mono" },

  // Handwriting (assinatura, casual)
  { name: "Caveat", category: "handwriting" },
  { name: "Pacifico", category: "handwriting" },
  { name: "Dancing Script", category: "handwriting" },
  { name: "Kalam", category: "handwriting" },
]

/**
 * Carrega uma Google Font dinamicamente injetando uma tag <link> no <head>.
 * Idempotente: se a mesma fonte ja foi carregada, nao re-injeta.
 * Pesos carregados: 400 e 700 (regular e bold) — atende 99% dos casos.
 */
export function loadGoogleFont(fontName: string): void {
  if (typeof document === "undefined") return // SSR safe
  if (!fontName) return

  const id = `gfont-${fontName.replace(/\s+/g, "-")}`
  if (document.getElementById(id)) return

  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, "+")}:wght@400;700&display=swap`
  document.head.appendChild(link)
}

// Normaliza nome PSD/PostScript pra Google Font family. PSD entrega nomes tipo
// "Helvetica-Bold", "OpenSans-Italic" ou "Montserrat-SemiBold" — Google Fonts
// quer "Helvetica", "Open Sans", "Montserrat". Tira sufixos de peso/estilo e
// converte camelCase pra "Camel Case" quando bate com family conhecida.
export function normalizePsdFontToGoogle(psdName: string): string | null {
  if (!psdName) return null
  // Remove sufixos comuns de peso/estilo (PostScript convention -Weight, -Style)
  let base = psdName.replace(/-(Thin|ExtraLight|UltraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|Black|Heavy)(Italic|Oblique)?$/i, "")
                    .replace(/-(Italic|Oblique)$/i, "")
                    .trim()
  // Insere espaco em camelCase: "OpenSans" → "Open Sans", "DMSans" → "DM Sans"
  const spaced = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  // Procura match case-insensitive na lista de Google Fonts conhecidas
  const match = GOOGLE_FONTS.find(f => f.name.toLowerCase() === spaced.toLowerCase())
  if (match) return match.name
  // Fallback: retorna o nome normalizado mesmo sem match (Google pode ter,
  // so nao esta na nossa lista curada). loadGoogleFont retornara 404 silencioso
  // se nao existir — sem efeito colateral.
  return spaced
}

// Lista de fontes do sistema que NAO precisam ir pro Google (estao no SO).
const SYSTEM_FONTS = new Set([
  "Arial", "Helvetica", "Times New Roman", "Times", "Courier New", "Courier",
  "Verdana", "Georgia", "Tahoma", "Trebuchet MS", "Impact", "Comic Sans MS",
  "Lucida Sans", "Lucida Console", "Palatino", "Garamond", "Bookman",
  "Avenir", "Avenir Next", "Futura", "Optima", "Geneva", "Monaco",
  "Menlo", "Consolas", "Cambria", "Calibri", "Segoe UI",
])

// Auto-carrega fontes do PSD via Google Fonts (best-effort). Pula system fonts
// (Arial/Helvetica/etc) que ja estao no browser. Para fontes nao-Google nem
// system, deixa o alerta de "missing fonts" do PsdImporter fazer o seu papel.
export function ensurePsdFontsReady(fontNames: string[]): void {
  if (typeof document === "undefined") return
  for (const fn of fontNames) {
    const family = normalizePsdFontToGoogle(fn)
    if (!family) continue
    if (SYSTEM_FONTS.has(family)) continue
    loadGoogleFont(family)
  }
}

/**
 * Arquivo de fonte custom dentro da familia.
 * weight 100-900, style normal/italic, dataUrl base64 (TTF/OTF/WOFF).
 */
export interface CustomFontFile {
  url: string
  weight: number
  style: "normal" | "italic"
  fileName: string
}

/**
 * Tenta inferir peso e estilo da fonte pelo nome do arquivo.
 * Ex: "SicrediSans-Bold.ttf" → { weight: 700, style: "normal" }
 *     "Lato-LightItalic.ttf" → { weight: 300, style: "italic" }
 * A ordem dos regex importa — mais especifico primeiro.
 */
export function detectFontMetadata(fileName: string): { weight: number; style: "normal" | "italic" } {
  const n = fileName.toLowerCase().replace(/\.(ttf|otf|woff2?|).*$/, "")
  const style: "normal" | "italic" = /italic|oblique/.test(n) ? "italic" : "normal"

  // Ordem importa: termos mais especificos antes dos genericos
  let weight = 400
  if (/extra[\s_-]?bold|ultra[\s_-]?bold/.test(n)) weight = 800
  else if (/extra[\s_-]?light|ultra[\s_-]?light/.test(n)) weight = 200
  else if (/semi[\s_-]?bold|demi[\s_-]?bold/.test(n)) weight = 600
  else if (/black|heavy/.test(n)) weight = 900
  else if (/thin|hairline/.test(n)) weight = 100
  else if (/medium/.test(n)) weight = 500
  else if (/bold/.test(n)) weight = 700
  else if (/light/.test(n)) weight = 300
  else if (/regular|book|normal/.test(n)) weight = 400
  // default 400 ja setado

  return { weight, style }
}

/**
 * Detecta o format CSS pelo prefixo do data URL.
 * Vem da API /upload que ja detecta pelo mime correto.
 */
function formatFromDataUrl(dataUrl: string): string {
  if (dataUrl.startsWith("data:font/otf")) return "opentype"
  if (dataUrl.startsWith("data:font/woff2")) return "woff2"
  if (dataUrl.startsWith("data:font/woff")) return "woff"
  return "truetype"
}

/**
 * Carrega uma familia de fonte custom — multiplos arquivos com a mesma
 * font-family mas pesos/estilos diferentes. CSS escolhe o arquivo certo
 * automaticamente quando o texto pedir font-weight ou font-style especifico.
 *
 * Idempotente: re-injeta o CSS no mesmo <style> tag se a familia ja
 * existe (ex: trocou um arquivo).
 */
export function loadCustomFontFamily(fontName: string, files: CustomFontFile[]): void {
  if (typeof document === "undefined") return
  if (!fontName || !files || files.length === 0) return

  const id = `cfontfam-${fontName.replace(/\s+/g, "-")}`
  const existing = document.getElementById(id) as HTMLStyleElement | null

  const escapedName = fontName.replace(/'/g, "\\'")
  const css = files.map(f => {
    const format = formatFromDataUrl(f.url)
    return `@font-face { font-family: '${escapedName}'; src: url('${f.url}') format('${format}'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`
  }).join("\n")

  if (existing) {
    existing.textContent = css
    return
  }
  const style = document.createElement("style")
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
