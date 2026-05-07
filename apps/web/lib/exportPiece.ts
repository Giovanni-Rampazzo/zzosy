"use client"
// Exportacao de pecas: PSD editavel + PNG + JPG + PDF
// Suporta peca v2 (layers + assets) e v1 (canvasData legacy)

export type ExportFormat = "PSD" | "PNG" | "JPG" | "PDF"

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 100)
}

function safeName(s: string) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, "-")                    // tudo que nao for alfanumerico vira '-'
    .replace(/^-+|-+$/g, "")                           // tira '-' nas pontas
    .replace(/-{2,}/g, "-")                            // colapsa multiplos '-'
    .substring(0, 80)
}

function buildFileName(campaignName: string | undefined, piece: { name: string; width: number; height: number }) {
  const camp = campaignName ? safeName(campaignName) : ""
  const midia = safeName(piece.name)
  const dims = `${Math.round(piece.width)}x${Math.round(piece.height)}`
  // Formato: CAMPANHA_MIDIA_DIMENSOESxDIMENSOES (separador entre os 3 campos = '_')
  return [camp, midia, dims].filter(Boolean).join("_")
}

interface Asset {
  id: string; type: string; label: string; value: string | null; imageUrl: string | null; content: any
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

// Constroi o canvas Fabric da peca a partir de layers + assets
async function buildPieceCanvas(piece: any, assets: Asset[]): Promise<any> {
  const fabric = await import("fabric")
  const StaticCanvas = (fabric as any).StaticCanvas
  const Textbox = (fabric as any).Textbox
  const FabricImage = (fabric as any).FabricImage ?? (fabric as any).Image
  const Rect = (fabric as any).Rect

  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? piece.width ?? 1080
  const H = data?.height ?? piece.height ?? 1080
  const bgColor = data?.bgColor ?? "#ffffff"

  const el = document.createElement("canvas")
  el.width = W; el.height = H
  const fc = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, backgroundColor: bgColor })

  // V2: layers + assets
  if (data?.version === 2 && Array.isArray(data?.layers)) {
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]))
    const sorted = [...data.layers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

    for (const layer of sorted) {
      const asset = assetMap[layer.assetId]
      if (!asset) continue
      const overrides = layer.overrides ?? {}

      if (asset.type === "TEXT") {
        const spans = parseContent(asset.content)
        const fullText = spans.length ? spans.map((s: any) => s.text).join("") : (asset.value ?? asset.label)
        const def = spans[0]?.style ?? {}
        // Calcular styles per-char a partir dos spans (usados quando peça NAO tem overrides.styles)
        let assetStyles: any = undefined
        if (spans.length > 1) {
          const stylesMap: Record<number, Record<number, any>> = {}
          let lineNum = 0, col = 0
          const defaultKey = JSON.stringify(def)
          for (const span of spans) {
            const sStyle = span.style ?? {}
            const sKey = JSON.stringify(sStyle)
            for (const ch of (span.text ?? "")) {
              if (ch === "\n") { lineNum++; col = 0; continue }
              if (sKey !== defaultKey) {
                if (!stylesMap[lineNum]) stylesMap[lineNum] = {}
                stylesMap[lineNum][col] = {
                  fill: sStyle.color, fontSize: sStyle.fontSize,
                  fontWeight: sStyle.fontWeight, fontFamily: sStyle.fontFamily,
                }
              }
              col++
            }
          }
          if (Object.keys(stylesMap).length > 0) assetStyles = stylesMap
        }
        const t = new Textbox(fullText, {
          left: layer.posX, top: layer.posY,
          width: Math.max(layer.width ?? 400, 100),
          fontSize: overrides.fontSize ?? def.fontSize ?? 80,
          fontFamily: overrides.fontFamily ?? def.fontFamily ?? "Arial",
          fontWeight: overrides.fontWeight ?? def.fontWeight ?? "normal",
          fill: overrides.fill ?? def.color ?? "#111",
          scaleX: layer.scaleX ?? 1,
          scaleY: layer.scaleY ?? 1,
          angle: layer.rotation ?? 0,
          charSpacing: overrides.charSpacing ?? 0,
          lineHeight: overrides.lineHeight ?? 1.16,
          textAlign: overrides.textAlign ?? "left",
        })
        // Aplicar styles per-char DEPOIS (Fabric Textbox ignora styles no construtor)
        // Prioridade: overrides.styles (peca) > assetStyles (matriz/asset)
        const finalStyles = overrides.styles ?? assetStyles
        if (finalStyles && Object.keys(finalStyles).length > 0) {
          ;(t as any).set("styles", finalStyles)
          if ((t as any).initDimensions) (t as any).initDimensions()
        }
        ;(t as any).__assetId = asset.id
        ;(t as any).__assetLabel = asset.label
        fc.add(t)
      } else if (asset.type === "IMAGE") {
        if (asset.imageUrl) {
          try {
            const img = await new Promise<any>((resolve, reject) => {
              const ie = new window.Image()
              ie.crossOrigin = "anonymous"
              ie.onload = () => resolve(new FabricImage(ie, {
                left: layer.posX, top: layer.posY,
                scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1,
                angle: layer.rotation ?? 0,
              }))
              ie.onerror = reject
              ie.src = asset.imageUrl!
            })
            ;(img as any).__assetId = asset.id
            ;(img as any).__assetLabel = asset.label
            fc.add(img)
          } catch (e) { console.warn("img load fail:", asset.label, e) }
        } else {
          const r = new Rect({
            left: layer.posX, top: layer.posY,
            width: layer.width ?? 400, height: layer.height ?? 300,
            fill: "#d0d0d0", stroke: "#999",
            scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1, angle: layer.rotation ?? 0,
          })
          fc.add(r)
        }
      }
    }
    fc.renderAll()
    await new Promise(r => setTimeout(r, 250))
    return fc
  }

  // V1: canvasData legacy
  if (data?.canvasData) {
    await new Promise<void>((resolve) => {
      const r = fc.loadFromJSON(data.canvasData, () => resolve())
      if (r && typeof r.then === "function") r.then(() => resolve())
    })
    await new Promise(r => setTimeout(r, 250))
    fc.renderAll()
    return fc
  }
  return fc
}

async function fetchPieceWithAssets(pieceId: string): Promise<{ piece: any; assets: Asset[] }> {
  const pres = await fetch(`/api/pieces/${pieceId}`)
  const piece = await pres.json()
  const cres = await fetch(`/api/campaigns/${piece.campaignId}`)
  const camp = await cres.json()
  return { piece, assets: camp.assets ?? [] }
}

async function renderToCanvas(pieceLite: { id?: string; name: string; data: any; width: number; height: number }): Promise<HTMLCanvasElement> {
  // Sempre busca peça + assets do servidor (sync) caso tenha id
  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    const fetched = await fetchPieceWithAssets(pieceLite.id)
    piece = fetched.piece
    assets = fetched.assets
  }
  const fc = await buildPieceCanvas(piece, assets)
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? pieceLite.width
  const H = data?.height ?? pieceLite.height

  const out = document.createElement("canvas")
  out.width = W; out.height = H
  const ctx = out.getContext("2d", { alpha: false } as any)!
  ctx.fillStyle = data?.bgColor ?? "#ffffff"
  ctx.fillRect(0, 0, W, H)
  ctx.drawImage(fc.getElement() as HTMLCanvasElement, 0, 0)
  fc.dispose()
  return out
}

export async function exportPNGBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const c = await renderToCanvas(piece)
  return await new Promise<Blob>((resolve, reject) => {
    c.toBlob(b => b ? resolve(b) : reject(new Error("toBlob PNG falhou")), "image/png")
  })
}

export async function exportJPGBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const c = await renderToCanvas(piece)
  return await new Promise<Blob>((resolve, reject) => {
    c.toBlob(b => b ? resolve(b) : reject(new Error("toBlob JPG falhou")), "image/jpeg", 0.92)
  })
}

export async function exportPDFBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const c = await renderToCanvas(piece)
  const jpegDataUrl = c.toDataURL("image/jpeg", 0.92)
  const jpegBase64 = jpegDataUrl.split(",")[1]
  const jpegBytes = atob(jpegBase64)
  const jpegBuf = new Uint8Array(jpegBytes.length)
  for (let i = 0; i < jpegBytes.length; i++) jpegBuf[i] = jpegBytes.charCodeAt(i)

  const W = c.width, H = c.height
  const enc = new TextEncoder()
  const parts: Array<Uint8Array> = []
  const offsets: number[] = []
  let pos = 0
  function push(s: string | Uint8Array) {
    const u = typeof s === "string" ? enc.encode(s) : s
    parts.push(u); pos += u.length
  }
  function startObj(idx: number) { offsets[idx] = pos; push(`${idx} 0 obj\n`) }
  function endObj() { push("\nendobj\n") }

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
  startObj(1); push("<< /Type /Catalog /Pages 2 0 R >>"); endObj()
  startObj(2); push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"); endObj()
  startObj(3); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`); endObj()
  startObj(4)
  push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuf.length} >>\nstream\n`)
  push(jpegBuf)
  push("\nendstream")
  endObj()
  const content = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`
  startObj(5)
  push(`<< /Length ${content.length} >>\nstream\n${content}endstream`)
  endObj()
  const xrefOffset = pos
  push(`xref\n0 6\n0000000000 65535 f \n`)
  for (let i = 1; i <= 5; i++) push(offsets[i].toString().padStart(10, "0") + " 00000 n \n")
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  const total = parts.reduce((a, p) => a + p.length, 0)
  const buf = new Uint8Array(total)
  let off = 0
  for (const p of parts) { buf.set(p, off); off += p.length }
  return new Blob([buf], { type: "application/pdf" })
}

function parseColor(c: string): { r: number; g: number; b: number } {
  if (typeof c !== "string") return { r: 0, g: 0, b: 0 }
  const hex = c.replace("#", "")
  if (hex.length === 6) return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16) }
  if (hex.length === 3) return { r: parseInt(hex[0]+hex[0],16), g: parseInt(hex[1]+hex[1],16), b: parseInt(hex[2]+hex[2],16) }
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return { r: +m[1], g: +m[2], b: +m[3] }
  return { r: 0, g: 0, b: 0 }
}

// Photoshop espera PostScript name no campo `font.name`, nao display name.
// Sem isso, abrir o PSD reclama "missing font" mesmo com a fonte instalada.
const PS_FONTS: Record<string, { regular: string; bold?: string }> = {
  "Arial":           { regular: "ArialMT",           bold: "Arial-BoldMT" },
  "Arial Black":     { regular: "Arial-Black" },
  "Georgia":         { regular: "Georgia",           bold: "Georgia-Bold" },
  "Times New Roman": { regular: "TimesNewRomanPSMT", bold: "TimesNewRomanPS-BoldMT" },
  "Courier New":     { regular: "CourierNewPSMT",    bold: "CourierNewPS-BoldMT" },
  "Verdana":         { regular: "Verdana",           bold: "Verdana-Bold" },
  "Impact":          { regular: "Impact" },
  "Trebuchet MS":    { regular: "TrebuchetMS",       bold: "TrebuchetMS-Bold" },
  "Palatino":        { regular: "Palatino-Roman",    bold: "Palatino-Bold" },
  "Tahoma":          { regular: "Tahoma",            bold: "Tahoma-Bold" },
  "Helvetica Neue":  { regular: "HelveticaNeue",     bold: "HelveticaNeue-Bold" },
}

function toPSFont(family: string, isBold: boolean): { name: string; fauxBold: boolean } {
  const f = PS_FONTS[family]
  if (!f) return { name: family, fauxBold: isBold }       // fonte desconhecida: passa direto
  if (isBold && f.bold) return { name: f.bold, fauxBold: false }
  if (isBold && !f.bold) return { name: f.regular, fauxBold: true } // sem variante bold: faux
  return { name: f.regular, fauxBold: false }
}

function buildStyleRuns(textbox: any, fullText: string, scale: number = 1): any[] {
  const runs: any[] = []
  const styles = textbox.styles ?? {}
  const lines = fullText.split("\n")
  let charIdx = 0
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    const lineStyles = styles[lineNum] ?? {}
    let prevStyleKey = ""
    let runStart = charIdx
    let runStyle: any = null
    for (let col = 0; col <= line.length; col++) {
      const cs = col < line.length ? lineStyles[col] : null
      const fill = cs?.fill ?? textbox.fill ?? "#000000"
      const fontSize = (cs?.fontSize ?? textbox.fontSize ?? 48) * scale
      const fontFamily = cs?.fontFamily ?? textbox.fontFamily ?? "Arial"
      const fontWeight = cs?.fontWeight ?? textbox.fontWeight ?? "normal"
      const styleKey = `${fill}|${fontSize}|${fontFamily}|${fontWeight}`
      if (styleKey !== prevStyleKey && col > 0) {
        runs.push({ length: charIdx + col - 1 - runStart + 1, style: runStyle })
        runStart = charIdx + col
      }
      if (styleKey !== prevStyleKey) {
        const isBold = (fontWeight === "bold" || fontWeight === 700)
        const ps = toPSFont(fontFamily, isBold)
        runStyle = {
          font: { name: ps.name },
          fontSize: Math.round(fontSize),
          fillColor: parseColor(fill),
          fauxBold: ps.fauxBold,
        }
        prevStyleKey = styleKey
      }
    }
    runs.push({ length: charIdx + line.length - runStart, style: runStyle })
    charIdx += line.length
    if (lineNum < lines.length - 1) {
      const last = runs[runs.length - 1]
      if (last) last.length += 1
      charIdx += 1
    }
  }
  return runs.filter(r => r.length > 0)
}

export async function exportPSDBlob(pieceLite: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    const fetched = await fetchPieceWithAssets(pieceLite.id)
    piece = fetched.piece
    assets = fetched.assets
  }
  const fc = await buildPieceCanvas(piece, assets)
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? pieceLite.width
  const H = data?.height ?? pieceLite.height

  const objects = fc.getObjects()
  const agpsd = await import("ag-psd") as any

  const psdLayers: any[] = []

  // BACKGROUND: adiciona como primeira layer (vai pro fundo no Photoshop) com a cor de fundo do canvas
  const bgColor = data?.bgColor ?? "#ffffff"
  const bgCanvas = document.createElement("canvas")
  bgCanvas.width = W; bgCanvas.height = H
  const bgCtx = bgCanvas.getContext("2d")!
  bgCtx.fillStyle = bgColor
  bgCtx.fillRect(0, 0, W, H)
  psdLayers.push({
    name: "Background",
    top: 0, left: 0, bottom: H, right: W,
    canvas: bgCanvas,
  })

  for (const obj of objects) {
    if ((obj as any).__isBg) continue
    // DIAGNOSTICO: tipo de cada objeto que entra no loop
    console.log("[PSD-LOOP]", { type: obj.type, isBg: (obj as any).__isBg, hasText: !!(obj as any).text, name: (obj as any).__assetLabel })
    const ox = obj.left ?? 0
    const oy = obj.top ?? 0
    const ow = (obj.width ?? 100) * (obj.scaleX ?? 1)
    const oh = (obj.height ?? 100) * (obj.scaleY ?? 1)
    const left = Math.round(ox)
    const top = Math.round(oy)
    const right = Math.round(ox + ow)
    const bottom = Math.round(oy + oh)
    const w = Math.max(1, right - left)
    const h = Math.max(1, bottom - top)
    let name = (obj as any).__assetLabel ?? obj.type ?? "Layer"

    if (obj.type === "textbox" || obj.type === "i-text" || obj.type === "text") {
      // Nome da layer = label do asset (editavel na pagina de assets).
      // Fallback: conteudo do texto se nao tiver label.
      if (!((obj as any).__assetLabel)) {
        const txt = ((obj as any).text ?? "").trim().replace(/\s+/g, " ")
        if (txt.length > 0) name = txt.length > 64 ? txt.substring(0, 64) + "…" : txt
      }
      // Texto: rasteriza COMO FALLBACK VISUAL + engineData pra Photoshop oferecer edicao.
      // Combinado com invalidateTextLayers:true no writePsd, Photoshop ao abrir mostra
      // dialogo "Update text layers" → ao aceitar, recomputa do engineData (texto editavel
      // com formatacao correta). Se cancelar, fica o canvas raster (visual correto, mas
      // nao-editavel).
      // CRITICO: obj.fontSize do Fabric eh ANTES do scale. O bbox (w/h) JA esta com scale aplicado.
      // Se nao multiplicar pelo scale aqui, fontSize fica enorme ("DATA" virou 137px no PSD com scaleY=0.12).
      // Usamos scaleY pra fontSize (consistente com como Fabric escala texto verticalmente).
      const sY = obj.scaleY ?? 1
      const fontSize = Math.round((obj.fontSize ?? 48) * sY)
      // CHAVE: usa as LINHAS WRAPPEADAS pelo Fabric (visual real do editor) como texto.
      // obj.text e' o texto cru (so com \n explicitos do usuario).
      // obj._textLines e' o array de linhas REAIS apos o wrap automatico pelo width do Textbox.
      // Se mandassemos obj.text cru, Photoshop tentaria wrappar de novo e poderia diferir
      // (mesma fonte com metricas ligeiramente diferentes da Fabric => quebra em outro ponto).
      // Juntando as linhas wrappeadas com \n explicitos, garantimos o mesmo visual.
      const wrappedLines = (obj as any)._textLines as string[][] | undefined
      const fullText = (Array.isArray(wrappedLines) && wrappedLines.length > 0)
        ? wrappedLines.map(line => Array.isArray(line) ? line.join("") : String(line)).join("\n")
        : (obj.text ?? "")
      const styleRuns = buildStyleRuns(obj, fullText, sY)
      const isBold = (obj.fontWeight === "bold" || obj.fontWeight === 700)
      const ps = toPSFont(obj.fontFamily ?? "Arial", isBold)
      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const lctx = layerCanvas.getContext("2d")! // alpha:true (transparente)
      try {
        const rendered = obj.toCanvasElement({ multiplier: 1 })
        lctx.drawImage(rendered, 0, 0, w, h)
      } catch (e) { console.warn("rasterize text fail:", name, e) }
      // DIAGNOSTICO TEMPORARIO
      console.log("[PSD-TEXT-EXPORT]", {
        name,
        rawText: JSON.stringify(obj.text),
        wrappedLineCount: wrappedLines?.length,
        finalText: JSON.stringify(fullText),
        fontFamily: obj.fontFamily, psFontName: ps.name, fauxBold: ps.fauxBold,
        rawFontSize: obj.fontSize, scaleY: sY, scaledFontSize: fontSize,
        bbox: { left, top, w, h },
        styleRunsCount: styleRuns.length,
      })
      psdLayers.push({
        name, top, left, bottom, right,
        canvas: layerCanvas,
        text: {
          text: fullText,
          transform: [1, 0, 0, 1, left, top + fontSize],
          // Point text com quebras explicitas (vindas do wrap do Fabric).
          // Sem boxBounds: deixa Photoshop respeitar nossas quebras sem tentar re-wrappar.
          style: {
            font: { name: ps.name },
            fontSize,
            fillColor: parseColor(obj.fill ?? "#000000"),
            fauxBold: ps.fauxBold,
          },
          styleRuns,
          paragraphStyle: { justification: "left" },
        },
      })
    } else {
      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const lctx = layerCanvas.getContext("2d")! // alpha:true (transparente) — antes forcava branco e quebrava qualquer asset com transparencia ou cor branca
      try {
        const img = obj.toCanvasElement({ multiplier: 1 })
        lctx.drawImage(img, 0, 0, w, h)
        psdLayers.push({ name, top, left, bottom, right, canvas: layerCanvas })
      } catch (e) { console.warn("rasterize fail:", name, e) }
    }
  }

  // Composite (preview)
  const compositeCanvas = document.createElement("canvas")
  compositeCanvas.width = W
  compositeCanvas.height = H
  const cctx = compositeCanvas.getContext("2d", { alpha: false } as any)!
  cctx.fillStyle = data?.bgColor ?? "#ffffff"
  cctx.fillRect(0, 0, W, H)
  cctx.drawImage(fc.getElement(), 0, 0)

  const thumbCanvas = document.createElement("canvas")
  const thumbScale = Math.min(256 / W, 256 / H)
  thumbCanvas.width = Math.round(W * thumbScale)
  thumbCanvas.height = Math.round(H * thumbScale)
  const tctx = thumbCanvas.getContext("2d", { alpha: false } as any)!
  tctx.fillStyle = "#fff"
  tctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height)
  tctx.drawImage(compositeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height)

  const psd: any = {
    width: W, height: H,
    canvas: compositeCanvas,
    children: psdLayers,
    imageResources: { thumbnail: thumbCanvas },
  }
  const buffer = agpsd.writePsd(psd, { generateThumbnail: false, invalidateTextLayers: true })
  fc.dispose()
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" })
}

const EXT_MAP: Record<ExportFormat, string> = { PSD: "psd", PNG: "png", JPG: "jpg", PDF: "pdf" }

async function buildBlob(piece: { id?: string; name: string; data: any; width: number; height: number }, format: ExportFormat): Promise<Blob> {
  switch (format) {
    case "PNG": return exportPNGBlob(piece)
    case "JPG": return exportJPGBlob(piece)
    case "PDF": return exportPDFBlob(piece)
    case "PSD": return exportPSDBlob(piece)
  }
}

export async function exportPieces(
  pieces: Array<{ id?: string; name: string; data: any; width: number; height: number }>,
  formats: ExportFormat[],
  onProgress?: (msg: string) => void,
  campaignName?: string,
): Promise<void> {
  const total = pieces.length * formats.length
  if (total === 0) return

  if (total === 1) {
    const piece = pieces[0]
    const fmt = formats[0]
    onProgress?.(`Gerando ${piece.name} (${fmt})`)
    const blob = await buildBlob(piece, fmt)
    downloadBlob(blob, `${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`)
    return
  }

  const JSZip = (await import("jszip")).default
  const zip = new JSZip()
  let done = 0
  for (const piece of pieces) {
    for (const fmt of formats) {
      done++
      onProgress?.(`${done}/${total} — ${piece.name} (${fmt})`)
      try {
        const blob = await buildBlob(piece, fmt)
        const buf = await blob.arrayBuffer()
        zip.file(`${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`, buf)
      } catch (e) {
        console.error("Falha exportar", piece.name, fmt, e)
      }
    }
  }

  onProgress?.(`Empacotando zip...`)
  const zipBlob = await zip.generateAsync({ type: "blob" })
  const zipBase = campaignName ? safeName(campaignName) : "export"
  const zipName = `${zipBase}_${new Date().toISOString().slice(0, 10)}.zip`
  downloadBlob(zipBlob, zipName)
}

export async function exportPiece(
  piece: { id?: string; name: string; data: any; width: number; height: number },
  format: ExportFormat
) {
  return exportPieces([piece], [format])
}


/**
 * Monta um ZIP de entrega organizado em pasta por MÍDIA / pasta por FORMATO / arquivos.
 * Retorna o Blob (não dispara download — quem chama decide o que fazer com ele).
 *
 * Estrutura de pasta esperada: ZIP/{Mídia}/{Formato}/{nome-arquivo}.{ext}
 * - mídia: vem de piece.media (string livre, ex: "Instagram", "Facebook")
 * - formato: nome do extensao em maiusculo (PSD, PNG, JPG, PDF)
 */
export async function buildDeliveryZip(
  pieces: Array<{ id: string; name: string; data: any; width: number; height: number; media?: string }>,
  formats: ExportFormat[],
  campaignName?: string,
  onProgress?: (msg: string) => void,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default
  const zip = new JSZip()
  let done = 0
  const total = pieces.length * formats.length

  for (const piece of pieces) {
    const mediaFolder = (piece.media || "Outros").trim().replace(/[\\/:*?"<>|]/g, "-")
    for (const fmt of formats) {
      done++
      onProgress?.(`${done}/${total} — ${piece.name} (${fmt})`)
      try {
        const blob = await buildBlob(piece, fmt)
        const buf = await blob.arrayBuffer()
        const folderPath = `${mediaFolder}/${fmt.toUpperCase()}`
        const fileName = `${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`
        zip.file(`${folderPath}/${fileName}`, buf)
      } catch (e) {
        console.error("Falha exportar", piece.name, fmt, e)
      }
    }
  }

  onProgress?.(`Empacotando zip...`)
  return await zip.generateAsync({ type: "blob" })
}
