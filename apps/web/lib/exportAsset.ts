/**
 * Exportador de assets individuais.
 *
 * 2 formatos:
 *  - 'original': baixa o arquivo original (PNG/JPG/SVG pra IMAGE; TXT pra TEXT)
 *  - 'psd': gera PSD de 1 layer contendo o asset
 *
 * Casos cobertos:
 *  - IMAGE com imageUrl (raster ou SVG): fetch direto
 *  - IMAGE com smartObject preservado: usa o filePath do SO original (preserva
 *    bytes originais do PSD da matriz, ex: PSD, AI, SVG complexo)
 *  - TEXT: serializa TextSpan[] -> TXT (texto cru concatenado)
 *  - PSD: ag-psd writePsd com canvas (image) ou text layer (text)
 */
import { writePsdBuffer } from "ag-psd"

interface Asset {
  id: string
  type: "TEXT" | "IMAGE" | "SMART_OBJECT" | "SHAPE"
  label: string
  imageUrl?: string | null
  content?: any  // TextSpan[] (parsed) ou string JSON
  smartObject?: {
    filePath: string
    mime: string
    originalName: string
    width?: number | null
    height?: number | null
  } | null
}

function sanitizeFilename(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
}

const MIME_BY_EXT: Record<string, string> = {
  psd: "image/vnd.adobe.photoshop",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  txt: "text/plain",
  zip: "application/zip",
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  // Save As dialog (Chrome/Edge 86+) com fallback pra <a download>.
  const ext = (filename.split(".").pop() ?? "").toLowerCase()
  const mime = MIME_BY_EXT[ext] ?? blob.type ?? "application/octet-stream"
  const showSaveFilePicker = (window as any).showSaveFilePicker
  if (typeof showSaveFilePicker === "function") {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: filename,
        types: ext ? [{ description: ext.toUpperCase(), accept: { [mime]: [`.${ext}`] } }] : undefined,
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (e: any) {
      if (e?.name === "AbortError") return
      console.warn("[downloadBlob] showSaveFilePicker falhou, fallback:", e)
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function parseSpans(content: any): Array<{ text: string; style?: any }> {
  if (Array.isArray(content)) return content
  if (typeof content === "string") {
    try {
      const p = JSON.parse(content)
      if (Array.isArray(p)) return p
    } catch {}
    return [{ text: content }]
  }
  return []
}

function spansToText(spans: Array<{ text: string }>): string {
  return spans.map(s => s.text || "").join("")
}

// =========== ORIGINAL ===========

async function exportOriginal(asset: Asset) {
  const safe = sanitizeFilename(asset.label || asset.id)
  if (asset.type === "IMAGE" || asset.type === "SMART_OBJECT") {
    // Prioriza smart object preservado (bytes originais, melhor qualidade)
    if (asset.smartObject?.filePath) {
      const res = await fetch(asset.smartObject.filePath)
      if (!res.ok) throw new Error("Falha ao baixar smart object")
      const blob = await res.blob()
      const ext = asset.smartObject.originalName?.split(".").pop() || "bin"
      downloadBlob(blob, `${safe}.${ext}`)
      return
    }
    if (!asset.imageUrl) throw new Error("Asset sem imagem")
    const res = await fetch(asset.imageUrl)
    if (!res.ok) throw new Error("Falha ao baixar imagem")
    const blob = await res.blob()
    // Detecta extensao do URL
    const ext = asset.imageUrl.split("?")[0].split(".").pop()?.toLowerCase() || "png"
    downloadBlob(blob, `${safe}.${ext}`)
    return
  }
  // TEXT: exporta como .txt (texto cru concatenado)
  const spans = parseSpans(asset.content)
  const text = spansToText(spans)
  const blob = new Blob([text || asset.label], { type: "text/plain;charset=utf-8" })
  downloadBlob(blob, `${safe}.txt`)
}

// =========== PSD ===========

// Carrega um asset IMAGE como HTMLImageElement (pra extrair canvas)
async function loadImageEl(src: string): Promise<HTMLImageElement> {
  const blob = await (await fetch(src)).blob()
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Image load failed"))
      img.src = url
    })
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function imageToCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = img.naturalWidth || img.width || 1
  c.height = img.naturalHeight || img.height || 1
  const ctx = c.getContext("2d")!
  ctx.drawImage(img, 0, 0)
  return c
}

// Parse #rrggbb -> {r,g,b}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "")
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    }
  }
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  }
}

async function exportPsd(asset: Asset) {
  const safe = sanitizeFilename(asset.label || asset.id)

  if (asset.type === "IMAGE" || asset.type === "SMART_OBJECT") {
    if (!asset.imageUrl) throw new Error("Asset sem imagem")
    const img = await loadImageEl(asset.imageUrl)
    const canvas = imageToCanvas(img)
    const w = canvas.width
    const h = canvas.height
    const psd: any = {
      width: w,
      height: h,
      children: [
        {
          name: asset.label || "Layer 1",
          canvas,
          top: 0, left: 0, bottom: h, right: w,
        },
      ],
    }
    const buf = writePsdBuffer(psd)
    downloadBlob(new Blob([new Uint8Array(buf as any)], { type: "image/vnd.adobe.photoshop" }), `${safe}.psd`)
    return
  }

  // TEXT: cria PSD com text layer editavel.
  // Estimativa de bounding box pelo primeiro span (cor/fonte/tamanho dominante).
  const spans = parseSpans(asset.content)
  const text = spansToText(spans) || asset.label || "Texto"
  const firstStyle = spans[0]?.style ?? {}
  const fontFamily = firstStyle.fontFamily || "Arial"
  const fontSize = firstStyle.fontSize || 80
  const color = firstStyle.color || "#111111"
  const rgb = hexToRgb(color)
  // Estimativa simples de tamanho do canvas baseado em chars * fontSize/2
  const lines = text.split("\n")
  const maxLineLen = Math.max(...lines.map(l => l.length), 10)
  const canvasW = Math.max(400, Math.ceil(maxLineLen * fontSize * 0.6) + 40)
  const canvasH = Math.max(200, Math.ceil(lines.length * fontSize * 1.2) + 40)

  // Renderiza preview do texto num canvas pra que o PSD tenha um composite valido
  // (Photoshop precisa do canvas no layer; sem ele o text aparece em branco).
  const previewCanvas = document.createElement("canvas")
  previewCanvas.width = canvasW
  previewCanvas.height = canvasH
  const ctx = previewCanvas.getContext("2d")!
  ctx.fillStyle = "#ffffff00"
  ctx.font = `${fontSize}px "${fontFamily}"`
  ctx.fillStyle = color
  ctx.textBaseline = "top"
  lines.forEach((line, i) => {
    ctx.fillText(line, 20, 20 + i * fontSize * 1.2)
  })

  const psd: any = {
    width: canvasW,
    height: canvasH,
    children: [
      {
        name: asset.label || "Texto",
        canvas: previewCanvas,
        top: 20, left: 20, bottom: canvasH - 20, right: canvasW - 20,
        text: {
          text,
          transform: [1, 0, 0, 1, 20, 20 + fontSize],
          style: {
            font: { name: fontFamily },
            fontSize,
            fillColor: { r: rgb.r, g: rgb.g, b: rgb.b },
          },
          paragraphStyle: { justification: "left" },
        },
      },
    ],
  }
  const buf = writePsdBuffer(psd)
  downloadBlob(new Blob([new Uint8Array(buf as any)], { type: "image/vnd.adobe.photoshop" }), `${safe}.psd`)
}

// =========== API publica ===========

export async function exportAsset(asset: Asset, format: "original" | "psd") {
  if (format === "original") return exportOriginal(asset)
  return exportPsd(asset)
}
