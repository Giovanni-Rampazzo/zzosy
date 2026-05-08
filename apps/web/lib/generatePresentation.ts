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
  imageUrl: string | null
  width: number
  height: number
}

interface CampaignData {
  name: string
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
 *  - SUNO (texto bold preto) + bolinha amarela (substitui logo real ate enviarem PNG)
 *  - "UNITED CREATORS" grande embaixo
 */
function addCoverSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  // SUNO no topo direito
  slide.addText("SUNO", {
    x: 9.5, y: 0.4, w: 2.6, h: 0.9,
    fontFace: "Calibri", fontSize: 54, bold: true,
    color: TEXT_DARK, align: "right", valign: "middle",
  })
  // Bolinha amarela ao lado do "O" (decorativa)
  slide.addShape("ellipse", {
    x: 12.2, y: 0.65, w: 0.45, h: 0.45,
    fill: { color: YELLOW }, line: { color: YELLOW },
  })

  // UNITED CREATORS gigante no centro-baixo
  slide.addText("UNITED CREATORS", {
    x: 0.6, y: 5.2, w: 12.1, h: 1.4,
    fontFace: "Calibri", fontSize: 80, bold: true,
    color: TEXT_DARK, align: "left", valign: "middle",
  })

  addFooter(slide, pptx)
}

/**
 * Slide 2: Codigo + Nome da campanha
 *  - Fundo amarelo full bleed
 *  - Box laranja claro arredondado bottom-left
 *  - "CÓDIGO CAMPANHA" bold (placeholder por enquanto)
 *  - Nome real abaixo, regular
 */
function addCodeSlide(pptx: PptxGenJS, campaignName: string) {
  const slide = pptx.addSlide()
  slide.background = { color: YELLOW }

  // Box arredondado laranja claro (60% transparente sobre amarelo)
  slide.addShape("roundRect", {
    x: 0.6, y: 4.5, w: 12.1, h: 2.0,
    fill: { color: YELLOW_LIGHT },
    line: { color: "FFFFFF", width: 1 },
    rectRadius: 0.15,
  })

  slide.addText("CÓDIGO CAMPANHA", {
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
 * Slide 3: Segmento (placeholder)
 */
function addSegmentSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide()
  slide.background = { color: YELLOW }

  slide.addShape("roundRect", {
    x: 0.6, y: 5.2, w: 12.1, h: 1.2,
    fill: { color: YELLOW_LIGHT },
    line: { color: "FFFFFF", width: 1 },
    rectRadius: 0.15,
  })
  slide.addText("SEGMENTO DA CAMPANHA", {
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

  // Box amarelo nome (top-left)
  slide.addShape("rect", {
    x: 0.3, y: 0.3, w: Math.min(5.0, name.length * 0.16 + 0.5), h: 0.5,
    fill: { color: YELLOW }, line: { color: YELLOW },
  })
  slide.addText(name, {
    x: 0.4, y: 0.3, w: Math.min(4.9, name.length * 0.16 + 0.4), h: 0.5,
    fontFace: "Calibri", fontSize: 14, bold: true,
    color: TEXT_DARK, valign: "middle", align: "left",
  })

  // Box amarelo dimensao (abaixo)
  slide.addShape("rect", {
    x: 0.3, y: 0.85, w: Math.min(3.0, dims.length * 0.13 + 0.4), h: 0.4,
    fill: { color: YELLOW }, line: { color: YELLOW },
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

  // Imagem da peca centralizada. Calcula aspect ratio pra caber em 9.5 x 5.5 max.
  if (imgDataUri && piece.width > 0 && piece.height > 0) {
    const maxW = 9.5, maxH = 5.5
    const ratio = Math.min(maxW / piece.width, maxH / piece.height)
    const w = (piece.width * ratio)
    const h = (piece.height * ratio)
    const x = (13.333 - w) / 2
    const y = 1.6 + (5.5 - h) / 2
    slide.addImage({ data: imgDataUri, x, y, w, h })
  } else if (imgDataUri) {
    // Sem dimensoes — usa caixa fixa 16:9
    slide.addImage({ data: imgDataUri, x: 1.9, y: 1.7, w: 9.5, h: 5.3 })
  } else {
    slide.addText("(Imagem não disponível)", {
      x: 1.9, y: 3.5, w: 9.5, h: 0.6,
      fontFace: "Calibri", fontSize: 16, color: TEXT_GRAY, align: "center",
    })
  }

  addFooter(slide, pptx)
}

/**
 * Slide final: OBRIGADO + smiley + SUNO no topo
 */
function addThanksSlide(pptx: PptxGenJS) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  slide.addText("SUNO", {
    x: 9.7, y: 0.35, w: 2.4, h: 0.7,
    fontFace: "Calibri", fontSize: 32, bold: true,
    color: TEXT_DARK, align: "right", valign: "middle",
  })
  slide.addShape("ellipse", {
    x: 12.0, y: 0.5, w: 0.35, h: 0.35,
    fill: { color: YELLOW }, line: { color: YELLOW },
  })

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
 * Gera e dispara download do .pptx da campanha.
 */
export async function generateCampaignPresentation(data: CampaignData): Promise<void> {
  const pptx = new PptxGenJS()
  pptx.layout = "LAYOUT_WIDE" // 13.333 x 7.5 inches (16:9)
  pptx.title = `${data.name} - Apresentação`
  pptx.author = "ZZOSY"

  // Capa + intro slides
  addCoverSlide(pptx)
  addCodeSlide(pptx, data.name)
  addSegmentSlide(pptx)

  // Pre-carrega todas as imagens em paralelo (acelera bastante em decks com 10+ pecas)
  const imgs = await Promise.all(
    data.pieces.map(p => p.imageUrl ? imgToDataUri(p.imageUrl) : Promise.resolve(null))
  )
  data.pieces.forEach((p, i) => addPieceSlide(pptx, p, imgs[i]))

  // Slide final
  addThanksSlide(pptx)

  await pptx.writeFile({ fileName: fileNameFor(data.name) })
}
