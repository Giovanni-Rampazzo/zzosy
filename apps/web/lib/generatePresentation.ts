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
  widthValue?: number | null
  heightValue?: number | null
  widthUnit?: string | null
  heightUnit?: string | null
  steps?: Array<{ index: number; thumbnailUrl?: string | null; imageUrl?: string | null }> | null
}

export interface PptxBrand {
  primaryColor?: string  // hex com ou sem #
  logoUrl?: string       // path ou dataURI
  secondaryLogoUrl?: string
  footerText?: string
}

interface CampaignData {
  name: string
  code?: string | null
  pieces: Piece[]
  brand?: PptxBrand
}

// Defaults do template (sobrescritos por brand do tenant quando white-label ativo)
const YELLOW = "F5C400"
const BG_LIGHT = "F8F8F8"
const TEXT_DARK = "111111"
const TEXT_GRAY = "888888"

// pptxgenjs aceita hex sem '#'. Normaliza.
function normalizeHex(h: string | undefined | null, fallback: string): string {
  if (!h) return fallback
  const s = h.trim().replace(/^#/, "")
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : fallback
}
// Lighten hex multiplicando os 3 canais por um fator (>1 = mais claro).
// Resultado clampado em 0xFF. Usado pra gerar o "YELLOW_LIGHT" de boxes
// arredondados no slide 2 e 3 a partir da cor primaria do brand.
function lightenHex(hex: string, factor = 1.10): string {
  const n = parseInt(hex, 16)
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor))
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor))
  const b = Math.min(255, Math.round((n & 0xff) * factor))
  return ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0").toUpperCase()
}

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

interface Palette {
  primary: string       // hex sem '#'
  primaryLight: string  // hex mais claro (boxes slide 2/3)
  footerText: string
  logoUri: string | null
  secondaryLogoUri: string | null
}

/**
 * Footer (texto configuravel via brand) em todos os slides.
 */
function addFooter(slide: any, pptx: PptxGenJS, palette: Palette) {
  slide.addText(palette.footerText, {
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
function addCoverSlide(pptx: PptxGenJS, palette: Palette) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  // Logo principal topo direito (proporcional, altura fixa 1.0")
  if (palette.logoUri) {
    slide.addImage({ data: palette.logoUri, x: 10.0, y: 0.5, w: 2.99, h: 1.0, sizing: { type: "contain", w: 2.99, h: 1.0 } })
  } else {
    slide.addShape("ellipse", {
      x: 12.2, y: 0.65, w: 0.45, h: 0.45,
      fill: { color: palette.primary }, line: { color: palette.primary },
    })
  }

  // Logo grande centro-baixo (proporcional, largura 12")
  if (palette.secondaryLogoUri) {
    slide.addImage({ data: palette.secondaryLogoUri, x: 0.66, y: 5.4, w: 12.0, h: 1.51, sizing: { type: "contain", w: 12.0, h: 1.51 } })
  }

  addFooter(slide, pptx, palette)
}

/**
 * Slide 2: Codigo + Nome da campanha
 *  - Fundo amarelo full bleed
 *  - Box laranja claro arredondado bottom-left
 *  - "CÓDIGO CAMPANHA" bold (placeholder por enquanto)
 *  - Nome real abaixo, regular
 */
function addCodeSlide(pptx: PptxGenJS, palette: Palette, campaignName: string, code: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: palette.primary }

  // Box arredondado mais claro sobre a primary
  slide.addShape("roundRect", {
    x: 0.6, y: 4.5, w: 12.1, h: 2.0,
    fill: { color: palette.primaryLight },
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

  addFooter(slide, pptx, palette)
}

/**
 * Slide 3: Segmento
 */
function addSegmentSlide(pptx: PptxGenJS, palette: Palette, segment: string | null) {
  const slide = pptx.addSlide()
  slide.background = { color: palette.primary }

  slide.addShape("roundRect", {
    x: 0.6, y: 5.2, w: 12.1, h: 1.2,
    fill: { color: palette.primaryLight },
    line: { color: "FFFFFF", width: 1 },
    rectRadius: 0.15,
  })
  const segText = (segment && segment.trim()) ? segment.toUpperCase() : "SEGMENTO DA CAMPANHA"
  slide.addText(segText, {
    x: 1.0, y: 5.4, w: 11.3, h: 0.8,
    fontFace: "Calibri", fontSize: 32, bold: true, italic: true,
    color: "FFFFFF",
  })

  addFooter(slide, pptx, palette)
}

/**
 * Slide de peca individual:
 *  - Box amarelo top-left com nome da peca (preto, bold)
 *  - Box amarelo menor abaixo com dimensao
 *  - Bolinha amarela top-right (decoracao)
 *  - Imagem centralizada (max 9.5 x 5.5, mantendo aspect)
 */
function addPieceSlide(pptx: PptxGenJS, palette: Palette, piece: Piece, imgDataUri: string | null, stepImages?: Array<string | null>) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  const name = piece.name ?? "Peça sem nome"
  // Formata dimensao na unidade original (cm, mm, etc) quando o MediaFormat
  // foi cadastrado com unidade nao-px. Fallback: width/height em px.
  const wV = (piece.widthValue != null && piece.widthValue > 0) ? piece.widthValue : piece.width
  const hV = (piece.heightValue != null && piece.heightValue > 0) ? piece.heightValue : piece.height
  const wU = piece.widthUnit || "px"
  const hU = piece.heightUnit || "px"
  const fmt = (n: number) => Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString()
  const dims = (piece.width && piece.height)
    ? (wU === hU ? `${fmt(wV)} x ${fmt(hV)} ${wU}` : `${fmt(wV)} ${wU} x ${fmt(hV)} ${hU}`)
    : "—"

  // Header: box amarelo com nome + dimensao em texto puro ao lado (sem fundo).
  // Replica look da apresentacao web: fonte ~12px equivalente (9pt em PPT),
  // padding lateral confortavel (~0.2"), altura suficiente pra nao apertar.
  // Slide PPTX = 13.333 x 7.5 in. 9pt Calibri bold ~0.063" por char em media.
  const FONT_SIZE = 9
  const PAD_X = 0.2  // padding lateral interno (~5mm, ~20px no web)
  const CHAR_W = 0.067 // largura media de char Calibri 9pt bold em inches
  const nameH = 0.4
  // Calcula largura proporcional ao texto + padding dos 2 lados
  const nameW = name.length * CHAR_W + (PAD_X * 2)
  const gap = 0.2
  // Box amarelo nome (top-left)
  slide.addShape("roundRect", {
    x: 0.3, y: 0.3, w: nameW, h: nameH,
    fill: { color: palette.primary }, line: { color: palette.primary },
    rectRadius: 0.08,
  })
  slide.addText(name, {
    x: 0.3, y: 0.3, w: nameW, h: nameH,
    fontFace: "Calibri", fontSize: FONT_SIZE, bold: true,
    color: TEXT_DARK, valign: "middle", align: "center",
    margin: 0,
  })
  // Dimensao em texto puro (sem fundo amarelo), ao lado do nome
  const dimsX = 0.3 + nameW + gap
  slide.addText(dims, {
    x: dimsX, y: 0.3, w: 2.5, h: nameH,
    fontFace: "Calibri", fontSize: FONT_SIZE, bold: false,
    color: TEXT_DARK, valign: "middle", align: "left",
    margin: 0,
  })

  // Bolinha amarela top-right
  slide.addShape("ellipse", {
    x: 12.5, y: 0.4, w: 0.5, h: 0.5,
    fill: { color: palette.primary }, line: { color: palette.primary },
  })

  // Imagem da peca + opcional card de legenda.
  // Slide: 13.333 x 7.5
  const hasCopy = !!(piece.copy && piece.copy.trim().length > 0)

  // PEÇA A 100% (72 DPI): regra do usuario — peca aparece no tamanho real
  // a 72 DPI sempre que couber na area util do slide. Se for maior que a
  // area, reduz proporcionalmente. PPTX usa polegadas; 1 inch = 72 px a 72 DPI.
  // Slide 13.333" x 7.5" = 960 x 540 px @ 72 DPI.
  //
  // Area util definida pra nao encostar nos boxes amarelos em cima:
  //   header (nome+dim) vai ate y ~0.7" -> area util y 1.0 -> 7.2 (h 6.2")
  //   largura inteira do slide com margem lateral pequena: x 0.3 -> 13.03 (w 12.73")
  //
  // px -> inches @ 72 DPI: divide por 72.
  const PX_PER_INCH = 72
  const AREA_X = 0.3
  const AREA_Y = 1.0
  const AREA_W = 12.73
  const AREA_H = 6.2

  if (hasCopy) {
    // Layout 2/3 + 1/3: peca a esquerda (8.49"), gap (0.25"), legenda direita (4.0")
    // Total: 0.3 + 8.49 + 0.25 + 4.0 + 0.3 = 13.34 (~ slide w 13.333)
    const PIECE_AREA_W = 8.49
    const PIECE_AREA_X = 0.3
    const SPLIT_AREA_H = 6.2
    const CARD_X = 0.3 + PIECE_AREA_W + 0.25
    const CARD_W = 4.0

    // Multi-step: renderiza todos lado a lado na area da peca, ALINHADOS AO
    // TOPO (sem padding vertical centralizando) e ENCOSTADOS A ESQUERDA. Cada
    // step ocupa exatamente o espaco da sua proporção; o conjunto se ajusta
    // pra caber em PIECE_AREA_W. Sobra horizontal vai entre o ultimo step e
    // a legenda (nao entre cells), evitando espacos brancos esquisitos.
    const hasMultiStep = Array.isArray(stepImages) && stepImages.length >= 2
    if (hasMultiStep) {
      const total = stepImages!.length
      const GAP = 0.1
      const LABEL_H = 0.25
      const availH = SPLIT_AREA_H - LABEL_H - 0.1
      const idealW = piece.width > 0 ? piece.width / PX_PER_INCH : 4
      const idealH = piece.height > 0 ? piece.height / PX_PER_INCH : 4
      // Escala preferencial: limitada pela altura disponivel. Se 3 steps lado
      // a lado nessa escala extrapolam PIECE_AREA_W, reduz uniformemente.
      const scaleByH = availH / idealH
      const totalWByH = idealW * scaleByH * total + GAP * (total - 1)
      const ratio = totalWByH <= PIECE_AREA_W
        ? scaleByH
        : (PIECE_AREA_W - GAP * (total - 1)) / (idealW * total)
      const stepW = idealW * ratio
      const stepH = idealH * ratio
      for (let i = 0; i < total; i++) {
        const x = PIECE_AREA_X + i * (stepW + GAP)
        const y = AREA_Y + LABEL_H + 0.1
        const globalIdx = ((piece as any).__stepIndexOffset ?? 0) + i
        // Label "Step N" alinhada a esquerda, do tamanho do step
        slide.addText(`STEP ${globalIdx + 1}`, {
          x, y: AREA_Y, w: stepW, h: LABEL_H,
          fontFace: "Calibri", fontSize: 8, bold: true,
          color: "888888", align: "center", valign: "middle",
          margin: 0,
        })
        const img = stepImages![i]
        if (img && piece.width > 0 && piece.height > 0) {
          slide.addImage({ data: img, x, y, w: stepW, h: stepH })
        } else {
          slide.addText("(sem preview)", {
            x, y: y + stepH / 2 - 0.15, w: stepW, h: 0.3,
            fontFace: "Calibri", fontSize: 10, color: TEXT_GRAY, align: "center",
          })
        }
      }
    } else if (imgDataUri && piece.width > 0 && piece.height > 0) {
      // Tamanho ideal a 100% (72 DPI)
      const idealW = piece.width / PX_PER_INCH
      const idealH = piece.height / PX_PER_INCH
      // Se cabe na area, usa tamanho real. Senao reduz proporcional.
      const ratio = Math.min(1, PIECE_AREA_W / idealW, SPLIT_AREA_H / idealH)
      const w = idealW * ratio
      const h = idealH * ratio
      // Centralizada na area da peca
      const x = PIECE_AREA_X + (PIECE_AREA_W - w) / 2
      const y = AREA_Y + (SPLIT_AREA_H - h) / 2
      slide.addImage({ data: imgDataUri, x, y, w, h })
    } else if (imgDataUri) {
      slide.addImage({ data: imgDataUri, x: 0.7, y: 1.5, w: 7.5, h: 5.0 })
    } else {
      slide.addText("(Imagem não disponível)", {
        x: PIECE_AREA_X, y: 3.7, w: PIECE_AREA_W, h: 0.6,
        fontFace: "Calibri", fontSize: 14, color: TEXT_GRAY, align: "center",
      })
    }

    // Card legenda — corpo branco com header amarelo cheio em cima.
    // Estrutura: bg branco geral + faixa amarela superior + texto da copy embaixo.
    slide.addShape("roundRect", {
      x: CARD_X, y: AREA_Y, w: CARD_W, h: SPLIT_AREA_H,
      fill: { color: "FFFFFF" }, line: { color: "EEEEEE", width: 1 },
      rectRadius: 0.10,
    })
    // Faixa amarela em cima (header "Legenda:")
    slide.addShape("roundRect", {
      x: CARD_X, y: AREA_Y, w: CARD_W, h: 0.4,
      fill: { color: palette.primary }, line: { color: palette.primary },
      rectRadius: 0.10,
    })
    // Pequeno rect amarelo embaixo da faixa pra "cortar" os cantos arredondados
    // de baixo (gambiarra do pptxgenjs que nao suporta border-radius parcial).
    slide.addShape("rect", {
      x: CARD_X, y: AREA_Y + 0.2, w: CARD_W, h: 0.2,
      fill: { color: palette.primary }, line: { color: palette.primary, width: 0 },
    })
    // Texto "Legenda:" italico no header amarelo
    slide.addText("Legenda:", {
      x: CARD_X + 0.18, y: AREA_Y, w: CARD_W - 0.36, h: 0.4,
      fontFace: "Calibri", fontSize: 11, bold: true, italic: true,
      color: TEXT_DARK, valign: "middle", align: "left",
    })
    // Texto da copy (corpo) — fontSize 11, centralizado verticalmente
    // (mesmo look da apresentacao web: legenda alinhada no centro do card).
    // autoFit:'none' (default seria 'normal' em algumas versoes do pptxgenjs,
    // que reduz a fonte se o texto nao couber — quebra o tamanho exato pedido).
    slide.addText(piece.copy!.trim(), {
      x: CARD_X + 0.18, y: AREA_Y + 0.55, w: CARD_W - 0.36, h: SPLIT_AREA_H - 0.7,
      fontFace: "Calibri", fontSize: 11,
      color: TEXT_DARK, valign: "middle", align: "left",
      autoFit: false,
      shrinkText: false,
    } as any)
  } else {
    // Layout sem copy: peca centralizada na area util inteira.
    // Multi-step: mesma logica, mas usa AREA_W inteira.
    const hasMultiStep = Array.isArray(stepImages) && stepImages.length >= 2
    if (hasMultiStep) {
      const total = stepImages!.length
      const GAP = 0.15
      const LABEL_H = 0.3
      const cellW = (AREA_W - GAP * (total - 1)) / total
      const cellH = AREA_H - LABEL_H - 0.15
      for (let i = 0; i < total; i++) {
        const cellX = AREA_X + i * (cellW + GAP)
        slide.addText(`STEP ${i + 1}`, {
          x: cellX, y: AREA_Y, w: cellW, h: LABEL_H,
          fontFace: "Calibri", fontSize: 10, bold: true,
          color: "888888", align: "center", valign: "middle",
          margin: 0,
        })
        const img = stepImages![i]
        if (img && piece.width > 0 && piece.height > 0) {
          const idealW = piece.width / PX_PER_INCH
          const idealH = piece.height / PX_PER_INCH
          const ratio = Math.min(cellW / idealW, cellH / idealH)
          const w = idealW * ratio
          const h = idealH * ratio
          const x = cellX + (cellW - w) / 2
          const y = AREA_Y + LABEL_H + 0.15 + (cellH - h) / 2
          slide.addImage({ data: img, x, y, w, h })
        } else {
          slide.addText("(sem preview)", {
            x: cellX, y: AREA_Y + LABEL_H + 0.15 + cellH / 2 - 0.15, w: cellW, h: 0.3,
            fontFace: "Calibri", fontSize: 11, color: TEXT_GRAY, align: "center",
          })
        }
      }
    } else if (imgDataUri && piece.width > 0 && piece.height > 0) {
      // Tamanho ideal a 100% (72 DPI)
      const idealW = piece.width / PX_PER_INCH
      const idealH = piece.height / PX_PER_INCH
      // Reduz so se nao couber. ratio <= 1 sempre.
      const ratio = Math.min(1, AREA_W / idealW, AREA_H / idealH)
      const w = idealW * ratio
      const h = idealH * ratio
      // Centralizada na area util
      const x = AREA_X + (AREA_W - w) / 2
      const y = AREA_Y + (AREA_H - h) / 2
      slide.addImage({ data: imgDataUri, x, y, w, h })
    } else if (imgDataUri) {
      slide.addImage({ data: imgDataUri, x: 0.7, y: 1.0, w: 11.9, h: 6.2 })
    } else {
      slide.addText("(Imagem não disponível)", {
        x: 1.9, y: 3.5, w: 9.5, h: 0.6,
        fontFace: "Calibri", fontSize: 16, color: TEXT_GRAY, align: "center",
      })
    }
  }

  addFooter(slide, pptx, palette)
}

/**
 * Slide final: OBRIGADO + smiley + SUNO no topo
 */
function addThanksSlide(pptx: PptxGenJS, palette: Palette) {
  const slide = pptx.addSlide()
  slide.background = { color: BG_LIGHT }

  // Logo topo direito (proporcional)
  if (palette.logoUri) {
    slide.addImage({ data: palette.logoUri, x: 11.0, y: 0.4, w: 1.79, h: 0.6, sizing: { type: "contain", w: 1.79, h: 0.6 } })
  } else {
    slide.addShape("ellipse", {
      x: 12.0, y: 0.5, w: 0.35, h: 0.35,
      fill: { color: palette.primary }, line: { color: palette.primary },
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
    fill: { color: palette.primary }, line: { color: palette.primary },
  })
  slide.addText(";)", {
    x: 4.7, y: 5.78, w: 0.85, h: 0.85,
    fontFace: "Calibri", fontSize: 24, bold: true,
    color: TEXT_DARK, align: "center", valign: "middle",
  })

  addFooter(slide, pptx, palette)
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

  // Monta a palette baseada no brand do tenant (com fallback nos defaults).
  const primary = normalizeHex(data.brand?.primaryColor, YELLOW)
  const palette: Palette = {
    primary,
    primaryLight: lightenHex(primary, 1.10),
    footerText: (data.brand?.footerText?.trim()) || "Classificação da informação: Uso Interno",
    logoUri: await imgToDataUri(data.brand?.logoUrl?.trim() || "/presentation/suno.png"),
    secondaryLogoUri: await imgToDataUri(data.brand?.secondaryLogoUrl?.trim() || "/presentation/united-creators.png"),
  }

  addCoverSlide(pptx, palette)
  addCodeSlide(pptx, palette, data.name, data.code ?? null)

  // Pre-carrega todas as imagens em paralelo
  const imgs = await Promise.all(
    data.pieces.map(p => p.imageUrl ? imgToDataUri(p.imageUrl) : Promise.resolve(null))
  )
  // Mapa imageUrl→idx pra recuperar o dataUri por peca durante o for
  const imgByPieceIdx = new Map<string, string | null>()
  data.pieces.forEach((p, i) => imgByPieceIdx.set(p.id, imgs[i]))

  // STEPS: pre-carrega imagens dos steps tambem (pecas multi-step).
  // Mapa: pieceId -> array<string|null> com dataUri de cada step.
  const stepImgsByPieceIdx = new Map<string, Array<string | null>>()
  await Promise.all(
    data.pieces.map(async (p) => {
      if (!p.steps || p.steps.length < 2) return
      const stepImgs = await Promise.all(
        p.steps.map(s => {
          const src = s.imageUrl ?? s.thumbnailUrl ?? null
          return src ? imgToDataUri(src) : Promise.resolve(null)
        })
      )
      stepImgsByPieceIdx.set(p.id, stepImgs)
    })
  )

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
      addSegmentSlide(pptx, palette, group.segment)
    }
    for (const p of group.pieces) {
      const allStepImgs = stepImgsByPieceIdx.get(p.id)
      const totalSteps = Array.isArray(allStepImgs) ? allStepImgs.length : 0
      // Pecas com > 4 steps: quebra em multiplos slides (4 por slide).
      // Pecas com <= 4 steps ou sem steps: 1 slide.
      const STEPS_PER_SLIDE_PPTX = 4
      if (totalSteps > STEPS_PER_SLIDE_PPTX) {
        for (let chunkStart = 0; chunkStart < totalSteps; chunkStart += STEPS_PER_SLIDE_PPTX) {
          const chunk = allStepImgs!.slice(chunkStart, chunkStart + STEPS_PER_SLIDE_PPTX)
          const chunkIdx = Math.floor(chunkStart / STEPS_PER_SLIDE_PPTX)
          const totalChunks = Math.ceil(totalSteps / STEPS_PER_SLIDE_PPTX)
          const isLastChunk = chunkIdx === totalChunks - 1
          // Renomeia a peca pra incluir "(Parte N/M)" e marca o indice inicial
          // pros labels "Step N" continuarem a numeracao global.
          // copy: so o ultimo chunk mostra a legenda (mais natural).
          const chunkPiece: any = {
            ...p,
            name: `${p.name ?? "Peça"} (Parte ${chunkIdx + 1}/${totalChunks})`,
            __stepIndexOffset: chunkStart,
            copy: isLastChunk ? p.copy : null,
          }
          addPieceSlide(pptx, palette, chunkPiece, imgByPieceIdx.get(p.id) ?? null, chunk)
        }
      } else {
        addPieceSlide(pptx, palette, p, imgByPieceIdx.get(p.id) ?? null, allStepImgs)
      }
    }
  }

  addThanksSlide(pptx, palette)
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
