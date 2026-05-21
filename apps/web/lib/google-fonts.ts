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
  { name: "Exo 2", category: "sans" },
  { name: "Exo", category: "sans" },
  { name: "Barlow", category: "sans" },
  { name: "Rubik", category: "sans" },
  { name: "Quicksand", category: "sans" },
  { name: "Titillium Web", category: "sans" },
  { name: "Ubuntu", category: "sans" },
  { name: "PT Sans", category: "sans" },
  { name: "Noto Sans", category: "sans" },
  { name: "IBM Plex Sans", category: "sans" },
  { name: "Heebo", category: "sans" },
  { name: "Cabin", category: "sans" },
  { name: "Oxygen", category: "sans" },
  { name: "Catamaran", category: "sans" },
  { name: "Hind", category: "sans" },
  { name: "Asap", category: "sans" },

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
export function loadGoogleFont(fontName: string): boolean {
  if (typeof document === "undefined") return false // SSR safe
  if (!fontName) return false

  const id = `gfont-${fontName.replace(/\s+/g, "-")}`
  if (document.getElementById(id)) return false // ja carregada

  const link = document.createElement("link")
  link.id = id
  link.rel = "stylesheet"
  // Carrega TODOS os pesos (100-900) + italic. PSDs frequentemente usam Light(300)
  // ou Black(900) que nao estao em 400/700. Antes carregavamos so 400;700 e o
  // browser caia em fallback pros outros pesos — texto Light virava Regular,
  // Bold virava Regular se a fonte nao tinha 700 mas tinha 800. Pedir ital,wght
  // com axis explicito cobre regular + italic em todos os pesos.
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, "+")}:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900&display=swap`
  document.head.appendChild(link)
  return true
}

// Normaliza nome PSD/PostScript pra Google Font family. PSD entrega nomes tipo
// "Helvetica-Bold", "OpenSans-Italic", "Sicredi-Sans-Bold-Italic", "Exo2Roman-Bold".
// Google Fonts quer "Helvetica", "Open Sans", "Sicredi Sans", "Exo 2".
//
// Sequencia (aplicada em ordem, cada passo opera no resultado do anterior):
//   1. Strip sufixo combinado weight+italic com hifen opcional entre eles:
//      "Sicredi-Sans-Bold-Italic" → "Sicredi-Sans"
//      "Helvetica-BoldItalic"     → "Helvetica"
//      "Helvetica-Bold"           → "Helvetica"
//   2. Strip sufixo "-Italic"/"-Oblique" remanescente (italic puro sem weight)
//   3. Strip sufixos "Roman" (variante regular PostScript) e "MT" (Adobe convention)
//   4. Hifens internos viram espacos: "Sicredi-Sans" → "Sicredi Sans"
//   5. CamelCase → "Camel Case": "OpenSans" → "Open Sans"
//   6. Letra + digito: "Exo2" → "Exo 2"
//   7. Match case-insensitive na lista curada de Google Fonts. Se nao bater,
//      retorna a string normalizada (loadGoogleFont devolve 404 silencioso
//      se nao for Google Font valida — fonte vira fallback CSS).
export function normalizePsdFontToGoogle(psdName: string): string | null {
  if (!psdName) return null
  let base = psdName
    // 1. Sufixo weight com italic opcional (com hifen opcional entre eles)
    .replace(/-(Thin|ExtraLight|UltraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|Black|Heavy)(-)?(Italic|Oblique)?$/i, "")
    // 2. Italic puro
    .replace(/-(Italic|Oblique)$/i, "")
    // 3. Variantes PostScript — exige boundary (separador) antes de Roman/MT.
    // Sem isso "FoxRoman" ou "Roman" sozinho seria gulosamente recortado (H4).
    .replace(/[\s\-_]Roman$/i, "")
    .replace(/[\s\-_]MT$/, "")
    .trim()
  // 4. Hifens internos viram espacos (PostScript usa hifen como separador)
  let spaced = base.replace(/-/g, " ")
  // 5. CamelCase → "Camel Case"
  spaced = spaced.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
  // 6. Letra + digito: "Exo2" → "Exo 2", "Source Sans3" → "Source Sans 3"
  spaced = spaced.replace(/([A-Za-z])(\d)/g, "$1 $2")
  // Limpa espacos multiplos / trim
  spaced = spaced.replace(/\s+/g, " ").trim()
  if (!spaced) return null
  // 7. Match na lista curada
  const match = GOOGLE_FONTS.find(f => f.name.toLowerCase() === spaced.toLowerCase())
  if (match) return match.name
  return spaced
}

/**
 * Extrai peso CSS numerico (100..900) do nome PostScript/PSD. PSDs entregam
 * nomes tipo "Sicredi-Sans-Bold", "InterMedium", "OpenSans-LightItalic" — o
 * peso esta no nome.
 *
 * Word boundary `(^|[\s\-_])` evita falso positivo. "Ariallight" (sem
 * separador) nao matcha — fontes reais sempre usam separador. Ordem: mais
 * especifico antes (ExtraBold antes de Bold, SemiBold antes de Bold,
 * ExtraLight antes de Light).
 */
export function extractFontWeight(psdName: string): number {
  if (!psdName) return 400
  const n = psdName
  // Padrao convencao PostScript: "Family-Weight" ou "Family-WeightItalic" ao
  // FINAL do nome. Boundary inicial (start/sep/lowercase pra CamelCase) +
  // sufixo opcional Italic/Oblique + END. Evita falsos positivos quando o
  // termo aparece embutido na familia (audit H3): "BlackOpsOne", "BlackPearl-
  // Regular", "Helvetica-Boldish" — nenhum termina em peso, todos retornam 400.
  const W = (term: string) => new RegExp(`(?:^|[\\s\\-_]|[a-z])${term}(?:Italic|Oblique)?$`, "i").test(n)
  if (W("(?:Extra|Ultra)\\s*Bold")) return 800
  if (W("(?:Extra|Ultra)\\s*Light") || W("Hairline")) return 200
  if (W("(?:Semi|Demi)\\s*Bold")) return 600
  if (W("(?:Black|Heavy)")) return 900
  if (W("Thin")) return 100
  if (W("Medium")) return 500
  if (W("Light")) return 300
  if (W("Bold")) return 700
  return 400
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
// Retorna numero de fontes NOVAS injetadas — caller usa pra decidir se vale
// a pena aguardar document.fonts.ready (se retorno=0 a espera eh desperdicio).
export function ensurePsdFontsReady(fontNames: string[]): number {
  if (typeof document === "undefined") return 0
  let added = 0
  for (const fn of fontNames) {
    const family = normalizePsdFontToGoogle(fn)
    if (!family) continue
    if (SYSTEM_FONTS.has(family)) continue
    if (loadGoogleFont(family)) added++
  }
  return added
}

// Forca o BROWSER a baixar e ativar cada @font-face especifico (todos os pesos
// comuns) usando document.fonts.load(). document.fonts.ready sozinho NAO
// dispara download enquanto a fonte nao for REFERENCIADA num elemento DOM —
// ate la o textbox cai em fallback Arial e tracking negativo visualmente cola
// as letras. Sintoma reportado pelo user: "texto do titulo muito colado".
// Esta funcao requesta cada combinacao weight × style relevante explicitamente,
// fazendo o browser puxar do CDN imediatamente. Promise resolve quando todas
// loadStatus = "loaded" ou rejeitam (timeout). Best-effort: se Google demorar,
// timeout libera o init pra continuar.
export async function forceLoadFontFaces(
  familyNames: string[],
  timeoutMs: number = 3000,
): Promise<void> {
  if (typeof document === "undefined") return
  const fonts = (document as any).fonts
  if (!fonts?.load) return
  // Lista de pesos comuns + 2 estilos. Cobre Thin..Black + italic. PSD pode
  // pedir qualquer peso entre 100-900; pre-carregamos todos pra texto com
  // styleRuns mistos (Light + Bold) ter ambos prontos juntos.
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900]
  const styles: ("normal" | "italic")[] = ["normal", "italic"]
  const promises: Promise<any>[] = []
  for (const fn of familyNames) {
    const family = normalizePsdFontToGoogle(fn)
    if (!family || SYSTEM_FONTS.has(family)) continue
    for (const w of weights) {
      for (const s of styles) {
        // Spec do load: `${style} ${weight} ${size}px "${family}"`. Size eh
        // arbitrario (apenas pra parser); peso e estilo eh o que importa pra
        // resolver qual @font-face baixar.
        const spec = `${s} ${w} 16px "${family.replace(/"/g, '\\"')}"`
        try {
          promises.push(fonts.load(spec).catch(() => {}))
        } catch { /* ignora specs invalidas */ }
      }
    }
  }
  if (promises.length === 0) return
  // Race com timeout pra nao bloquear init se Google estiver lento
  await Promise.race([
    Promise.allSettled(promises),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ])
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
 *
 * ESTRATEGIA ADOBE-STYLE — registra cada arquivo com MULTIPLOS aliases pra
 * cobrir todas as referencias que o PSD pode fazer:
 *   - Family name normalizado (ex: "Exo 2")             ← usado por fontWeight numerico
 *   - PostScript name do arquivo (ex: "Exo2Roman-Light") ← exato do PSD
 *   - Display name composto (ex: "Exo 2 Light")          ← Adobe Fonts naming
 *
 * Resultado: qualquer fontFamily que o styles[].fontFamily contiver achara
 * o arquivo certo. Sem alias multiplos, PSDs que referenciam pelo PostScript
 * name (alguns workflows) cairiam em fallback Google Fonts (metricas
 * diferentes do PSD original).
 */
export function loadCustomFontFamily(fontName: string, files: CustomFontFile[]): void {
  if (typeof document === "undefined") return
  if (!fontName || !files || files.length === 0) return

  const id = `cfontfam-${fontName.replace(/\s+/g, "-")}`
  const existing = document.getElementById(id) as HTMLStyleElement | null

  const escapedFamily = fontName.replace(/'/g, "\\'")
  // Deriva aliases adicionais por arquivo: PostScript name (do filename) e
  // display name (family + weight name). Cada @font-face com font-family
  // diferente, mesma src — browser resolve qualquer um.
  const weightNames: Record<number, string> = {
    100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular",
    500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black",
  }
  const cssParts: string[] = []
  for (const f of files) {
    const format = formatFromDataUrl(f.url)
    // 1) Family canonico (ex: "Exo 2")
    cssParts.push(`@font-face { font-family: '${escapedFamily}'; src: url('${f.url}') format('${format}'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: swap; }`)
    // 2) PostScript name (do fileName, sem extensao). PSDs frequentemente
    //    armazenam exatamente esse nome em styles[].fontFamily se nao
    //    normalizado. Registra como alias do mesmo arquivo.
    const psName = f.fileName.replace(/\.(ttf|otf|woff2?|).*$/i, "").trim()
    if (psName && psName !== fontName) {
      const escapedPS = psName.replace(/'/g, "\\'")
      cssParts.push(`@font-face { font-family: '${escapedPS}'; src: url('${f.url}') format('${format}'); font-weight: 400; font-style: ${f.style}; font-display: swap; }`)
    }
    // 3) Display name = family + weight name (ex: "Exo 2 Light"). Adobe
    //    Fonts e InDesign costumam usar essa forma.
    const wName = weightNames[f.weight] ?? "Regular"
    if (wName !== "Regular" || f.style === "italic") {
      const displayName = `${fontName} ${wName}${f.style === "italic" ? " Italic" : ""}`
      const escapedDisplay = displayName.replace(/'/g, "\\'")
      cssParts.push(`@font-face { font-family: '${escapedDisplay}'; src: url('${f.url}') format('${format}'); font-weight: 400; font-style: normal; font-display: swap; }`)
    }
  }
  const css = cssParts.join("\n")

  if (existing) {
    existing.textContent = css
    return
  }
  const style = document.createElement("style")
  style.id = id
  style.textContent = css
  document.head.appendChild(style)
}
