"use client"
/**
 * Gerador de apresentacao PPTX da campanha (template Suno United Creators).
 *
 * Estrutura do deck:
 *  1. Capa (SUNO + UNITED CREATORS)
 *  2. Slide com nome da campanha (codigo da campanha = placeholder ate criarmos o campo)
 *  3. Slide com segmento (placeholder)
 *  4..N. Um slide por peca: nome + dimensao em boxes amarelos no topo, imagem centralizada
 *  N+1. Slide final OBRIGADO
 *
 * Roda 100% no client (pptxgenjs gera o arquivo no browser e dispara download direto).
 * Tamanho fixo 13.333 x 7.5 inches (16:9 widescreen, 1280x720pt).
 */
import PptxGenJS from "pptxgenjs"

interface Piece {
  id: string
  name: string | null
  segment?: string | null
  copy?: string | null
  imageUrl: string | null
  width: number
  height: number
}

interface CampaignData {
  name: string
  code?: string | null
  pieces: Piece[]
}

// Cores do template
const YELLOW = "F5C400"
const YELLOW_LIGHT = "F4B942" // box laranja claro arredondado dos slides 2/3
const BG_LIGHT = "F8F8F8"
const TEXT_DARK = "111111"
const TEXT_GRAY = "888888"

/**
 * Carrega imagem como dataURI (base64). pptxgenjs aceita dataURI direto via { data: "data:image/..." }.
 * Necessario porque nossas thumbs sao base64 puro armazenado em DB ou URL CORS-restrita.
 */
async function imgToDataUri(src: string): Promise<string | null> {
  if (!src) return null
  // Ja eh dataURI?
  if (src.startsWith("data:")) return src
  try {
    const r = await fetch(src)
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(fr.result as string)
      fr.onerror = () => reject(new Error("FileReader failed"))
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * Footer "Classificação da informação: Uso Interno" em todos os slides.
 */
function addFooter(slide: any, pptx: PptxGenJS) {
  slide.addText("Classificação da informação: Uso Interno", {
    x: 0, y: 7.0, w: 13.333, h: 0.4,
    fontFace: "Calibri", fontSize: 10, color: TEXT_GRAY,
    align: "center",
  })
}

/**
 * Slide 1: Capa
 *  - Logo SUNO no topo direito
 *  - Logo UNITED CREATORS gigante embaixo
 */
function addCoverSlide(pptx: PptxGenJS, sunoLogo: string | null, unitedLogo: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  // Logo SUNO topo direito (830x278 = ratio 2.99). Altura ~1.0", largura 2.99"
  if (sunoLogo) {
    slide.addImage({ data: sunoLogo, x: 10.0, y: 0.5, w: 2.99, h: 1.0 })
  } else {
    // Fallback texto
    slide.addText("SUNO", {
      x: 9.5, y: 0.4, w: 2.6, h: 0.9,
      fontFace: "Calibri", fontSize: 54, bold: true,
      color: TEXT_DARK, align: "right", valign: "middle",
    })
    slide.addShape("ellipse", {
      x: 12.2, y: 0.65, w: 0.45, h: 0.45,
      fill: { color: YELLOW }, line: { color: YELLOW },
    })
  }

  // Logo UNITED CREATORS gigante no centro-baixo (1792x226 = ratio 7.93). Largura 12", altura 12/7.93 = 1.51"
  if (unitedLogo) {
    slide.addImage({ data: unitedLogo, x: 0.66, y: 5.4, w: 12.0, h: 1.51 })
  } else {
    slide.addText("UNITED CREATORS", {
      x: 0.6, y: 5.2, w: 12.1, h: 1.4,
      fontFace: "Calibri", fontSize: 80, bold: true,
      color: TEXT_DARK, align: "left", valign: "middle",
    })
  }

  addFooter(slide, pptx)
}

/**
 * Slide 2: Codigo + Nome da campanha
 *  - Fundo amarelo full bleed
 *  - Box laranja claro arredondado bottom-left
 *  - "CÓDIGO CAMPANHA" bold (placeholder por enquanto)
 *  - Nome real abaixo, regular
 */
function addCodeSlide(pptx: PptxGenJS, campaignName: string, code: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: YELLOW }

  // Box arredondado laranja claro (60% transparente sobre amarelo)
  slide.addShape("roundRect", {
    x: 0.6, y: 4.5, w: 12.1, h: 2.0,
    fill: { color: YELLOW_LIGHT },
    line: { color: "FFFFFF", width: 1 },
    rectRadius: 0.15,
  })

  const codeText = (code && code.trim()) ? code.toUpperCase() : "CÓDIGO CAMPANHA"
  slide.addText(codeText, {
    x: 1.0, y: 4.8, w: 11.3, h: 0.6,
    fontFace: "Calibri", fontSize: 32, bold: true,
    color: "FFFFFF",
  })
  slide.addText(campaignName.toUpperCase(), {
    x: 1.0, y: 5.5, w: 11.3, h: 0.6,
    fontFace: "Calibri", fontSize: 28, bold: false,
    color: "FFFFFF",
  })

  addFooter(slide, pptx)
}

/**
 * Slide 3: Segmento
 */
function addSegmentSlide(pptx: PptxGenJS, segment: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: YELLOW }

  slide.addShape("roundRect", {
    x: 0.6, y: 5.2, w: 12.1, h: 1.2,
    fill: { color: YELLOW_LIGHT },
    line: { color: "FFFFFF", width: 1 },
    rectRadius: 0.15,
  })
  const segText = (segment && segment.trim()) ? segment.toUpperCase() : "SEGMENTO DA CAMPANHA"
  slide.addText(segText, {
    x: 1.0, y: 5.4, w: 11.3, h: 0.8,
    fontFace: "Calibri", fontSize: 32, bold: true, italic: true,
    color: "FFFFFF",
  })

  addFooter(slide, pptx)
}

/**
 * Slide de peca individual:
 *  - Box amarelo top-left com nome da peca (preto, bold)
 *  - Box amarelo menor abaixo com dimensao
 *  - Bolinha amarela top-right (decoracao)
 *  - Imagem centralizada (max 9.5 x 5.5, mantendo aspect)
 */
function addPieceSlide(pptx: PptxGenJS, piece: Piece, imgDataUri: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  const name = piece.name ?? "Peça sem nome"
  const dims = piece.width && piece.height ? `${piece.width} x ${piece.height} px` : "—"

  // Box amarelo nome (top-left) — radius 12pt = ~0.166" em pptxgenjs
  slide.addShape("roundRect", {
    x: 0.3, y: 0.3, w: Math.min(5.0, name.length * 0.16 + 0.5), h: 0.5,
    fill: { color: YELLOW }, line: { color: YELLOW },
    rectRadius: 0.12,
  })
  slide.addText(name, {
    x: 0.4, y: 0.3, w: Math.min(4.9, name.length * 0.16 + 0.4), h: 0.5,
    fontFace: "Calibri", fontSize: 14, bold: true,
    color: TEXT_DARK, valign: "middle", align: "left",
  })

  // Box amarelo dimensao (abaixo)
  slide.addShape("roundRect", {
    x: 0.3, y: 0.85, w: Math.min(3.0, dims.length * 0.13 + 0.4), h: 0.4,
    fill: { color: YELLOW }, line: { color: YELLOW },
    rectRadius: 0.10,
  })
  slide.addText(dims, {
    x: 0.4, y: 0.85, w: Math.min(2.9, dims.length * 0.13 + 0.3), h: 0.4,
    fontFace: "Calibri", fontSize: 11, bold: false,
    color: TEXT_DARK, valign: "middle", align: "left",
  })

  // Bolinha amarela top-right
  slide.addShape("ellipse", {
    x: 12.5, y: 0.4, w: 0.5, h: 0.5,
    fill: { color: YELLOW }, line: { color: YELLOW },
  })

  // Imagem da peca + opcional card de legenda.
  // Slide: 13.333 x 7.5
  const hasCopy = !!(piece.copy && piece.copy.trim().length > 0)

  if (hasCopy) {
    // Layout split: peca a esquerda 55%, copy a direita 45%
    // Area peca: x 0.4 -> 7.4 (w 7.0), y 1.5 -> 6.5 (h 5.0)
    // Area copy: x 7.6 -> 12.9 (w 5.3), y 1.5 -> 6.5 (h 5.0)
    if (imgDataUri && piece.width > 0 && piece.height > 0) {
      const maxW = 7.0, maxH = 5.0
      const ratio = Math.min(maxW / piece.width, maxH / piece.height)
      const w = piece.width * ratio
      const h = piece.height * ratio
      const x = 0.4 + (maxW - w) / 2
      const y = 1.5 + (maxH - h) / 2
      slide.addImage({ data: imgDataUri, x, y, w, h })
    } else if (imgDataUri) {
      slide.addImage({ data: imgDataUri, x: 0.7, y: 1.5, w: 6.4, h: 5.0 })
    } else {
      slide.addText("(Imagem não disponível)", {
        x: 0.4, y: 3.7, w: 7.0, h: 0.6,
        fontFace: "Calibri", fontSize: 14, color: TEXT_GRAY, align: "center",
      })
    }

    // Card legenda (background branco arredondado)
    slide.addShape("roundRect", {
      x: 7.6, y: 1.5, w: 5.3, h: 5.0,
      fill: { color: "FFFFFF" }, line: { color: "EEEEEE", width: 1 },
      rectRadius: 0.10,
    })
    // Label "LEGENDA"
    slide.addText("LEGENDA", {
      x: 7.85, y: 1.7, w: 4.8, h: 0.3,
      fontFace: "Calibri", fontSize: 9, bold: true,
      color: TEXT_DARK, charSpacing: 1, valign: "top",
    })
    // Texto da copy
    slide.addText(piece.copy!.trim(), {
      x: 7.85, y: 2.1, w: 4.8, h: 4.2,
      fontFace: "Calibri", fontSize: 11,
      color: TEXT_DARK, valign: "top", align: "left",
    })
  } else {
    // Layout original: imagem centralizada
    if (imgDataUri && piece.width > 0 && piece.height > 0) {
      const maxW = 11.0, maxH = 5.7
      const ratio = Math.min(maxW / piece.width, maxH / piece.height)
      const w = (piece.width * ratio)
      const h = (piece.height * ratio)
      const x = (13.333 - w) / 2
      const y = (7.5 - h) / 2
      slide.addImage({ data: imgDataUri, x, y, w, h })
    } else if (imgDataUri) {
      slide.addImage({ data: imgDataUri, x: 1.4, y: 1.0, w: 10.5, h: 5.5 })
    } else {
      slide.addText("(Imagem não disponível)", {
        x: 1.9, y: 3.5, w: 9.5, h: 0.6,
        fontFace: "Calibri", fontSize: 16, color: TEXT_GRAY, align: "center",
      })
    }
  }

  addFooter(slide, pptx)
}

/**
 * Slide final: OBRIGADO + smiley + SUNO no topo
 */
function addThanksSlide(pptx: PptxGenJS, sunoLogo: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  // Logo SUNO topo direito (menor que na capa). Altura ~0.6", largura 0.6 * 2.99 = 1.79"
  if (sunoLogo) {
    slide.addImage({ data: sunoLogo, x: 11.0, y: 0.4, w: 1.79, h: 0.6 })
  } else {
    slide.addText("SUNO", {
      x: 9.7, y: 0.35, w: 2.4, h: 0.7,
      fontFace: "Calibri", fontSize: 32, bold: true,
      color: TEXT_DARK, align: "right", valign: "middle",
    })
    slide.addShape("ellipse", {
      x: 12.0, y: 0.5, w: 0.35, h: 0.35,
      fill: { color: YELLOW }, line: { color: YELLOW },
    })
  }

  // OBRIGADO bottom-left
  slide.addText("OBRIGADO", {
    x: 0.5, y: 5.6, w: 7.0, h: 1.1,
    fontFace: "Calibri", fontSize: 60, bold: false,
    color: TEXT_DARK, align: "left", valign: "middle",
  })
  // Carinha smiley simples (bolinha amarela com olhos)
  slide.addShape("ellipse", {
    x: 4.7, y: 5.75, w: 0.85, h: 0.85,
    fill: { color: YELLOW }, line: { color: YELLOW },
  })
  slide.addText(";)", {
    x: 4.7, y: 5.78, w: 0.85, h: 0.85,
    fontFace: "Calibri", fontSize: 24, bold: true,
    color: TEXT_DARK, align: "center", valign: "middle",
  })

  addFooter(slide, pptx)
}

/**
 * Helper: nome de arquivo seguro a partir do nome da campanha + data atual.
 * Formato: "<nome>_<YYYY-MM-DD>.pptx"
 */
function fileNameFor(campaignName: string): string {
  const safe = (campaignName || "campanha")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "")
    .slice(0, 60) || "campanha"
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${safe}_${yyyy}-${mm}-${dd}.pptx`
}

/**
 * Constroi o objeto pptx populado com todos os slides (sem disparar download).
 * Compartilhado entre generateCampaignPresentation (download direto) e
 * buildCampaignPresentationBlob (usado na entrega pra empacotar no ZIP).
 */
async function buildPptx(data: CampaignData): Promise<PptxGenJS> {
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE" // 13.333 x 7.5 inches (16:9)
  pptx.title = `${data.name} - Apresentação`
  pptx.author = "ZZOSY"

  // Pre-carrega logos servidos do /public/presentation. URL relativa funciona pq mesmo origin.
  const [sunoLogo, unitedLogo] = await Promise.all([
    imgToDataUri("/presentation/suno.png"),
    imgToDataUri("/presentation/united-creators.png"),
  ])

  addCoverSlide(pptx, sunoLogo, unitedLogo)
  addCodeSlide(pptx, data.name, data.code ?? null)

  // Pre-carrega todas as imagens em paralelo
  const imgs = await Promise.all(
    data.pieces.map(p => p.imageUrl ? imgToDataUri(p.imageUrl) : Promise.resolve(null))
  )
  // Mapa imageUrl→idx pra recuperar o dataUri por peca durante o for
  const imgByPieceIdx = new Map<string, string | null>()
  data.pieces.forEach((p, i) => imgByPieceIdx.set(p.id, imgs[i]))

  // Agrupa pecas por segmento. Mesma logica da pagina de presentation:
  // - Pecas sem segmento ficam num grupo "" e NAO recebem slide divisor
  // - Pecas com segmento sao agrupadas e cada grupo recebe um divisor antes
  const map = new Map<string, Piece[]>()
  for (const p of data.pieces) {
    const key = (p.segment ?? "").trim() || ""
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(p)
  }
  const groups: Array<{ segment: string | null; pieces: Piece[] }> = []
  if (map.has("")) groups.push({ segment: null, pieces: map.get("")! })
  const segNames = [...map.keys()].filter(k => k !== "").sort((a, b) => a.localeCompare(b, "pt-BR"))
  for (const s of segNames) groups.push({ segment: s, pieces: map.get(s)! })

  for (const group of groups) {
    if (group.segment !== null) {
      addSegmentSlide(pptx, group.segment)
    }
    for (const p of group.pieces) {
      addPieceSlide(pptx, p, imgByPieceIdx.get(p.id) ?? null)
    }
  }

  addThanksSlide(pptx, sunoLogo)
  return pptx
}

/**
 * Gera e dispara download do .pptx da campanha.
 */
export async function generateCampaignPresentation(data: CampaignData): Promise<void> {
  const pptx = await buildPptx(data)
  await pptx.writeFile({ fileName: fileNameFor(data.name) })
}

/**
 * Gera o .pptx e retorna como Blob (sem download).
 * Usado pelo fluxo de entrega pra empacotar dentro do ZIP em pasta Deck/.
 */
export async function buildCampaignPresentationBlob(data: CampaignData): Promise<{ blob: Blob; fileName: string }> {
  const pptx = await buildPptx(data)
  // pptxgenjs permite writeFile com outputType "blob" — retorna Blob direto sem download
  const blob = await pptx.write({ outputType: "blob" }) as unknown as Blob
  return { blob, fileName: fileNameFor(data.name) }
}
