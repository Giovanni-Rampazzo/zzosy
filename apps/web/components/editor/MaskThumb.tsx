"use client"
/**
 * MaskThumb — renderiza thumbnail B/W do alpha channel da mask, estilo Photoshop.
 *
 * 3 tipos suportados:
 *   - RASTER: usa dataUrl direto da mask (ja em B/W grayscale)
 *   - VECTOR: renderiza path SVG branco sobre fundo preto
 *   - CLIPPING: usa silhueta do layer ABAIXO (chama getBaseSilhouette helper)
 *
 * Estilo: 16×16 px (Photoshop layer panel size), border + checker bg quando
 * mask disabled.
 *
 * Click: dispara onFocus pra entrar em "mask edit mode" no canvas
 * (Fase B — visual indicator + brush futuro).
 */
import { useEffect, useRef, useState } from "react"

interface Props {
  /** __maskData do Fabric obj (raster/vector/clipping). */
  mask: any
  /** Fabric obj com a mask — pra clipping, precisa achar o base. */
  obj?: any
  /** Canvas Fabric — pra clipping resolver o base layer. */
  fc?: any
  /** Click no thumb pra focar/editar a mask. */
  onFocus?: () => void
  /** Indica que mask edit mode esta ativo (border destacada). */
  focused?: boolean
  /** Tamanho (default 16 — Photoshop layer panel). */
  size?: number
}

export function MaskThumb({ mask, obj, fc, onFocus, focused = false, size = 16 }: Props) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!mask) { setDataUrl(null); return }
    let cancelled = false
    ;(async () => {
      const url = await renderMaskToBwDataUrl(mask, obj, fc, size * 4)  // 4× pra retina
      if (!cancelled) setDataUrl(url)
    })()
    return () => { cancelled = true }
  }, [mask, obj, fc, size])

  if (!mask) return null

  const disabled = mask.enabled === false
  const border = focused ? "2px solid #F5C400" : "1px solid #666"
  const opacity = disabled ? 0.3 : 1

  // Clipping (originalmente clipping, convertida pra raster pra renderizar):
  // visual distinto pra nao confundir com raster mask normal (user reportou
  // 2026-05-27 'misturando as bolas, sao duas coisas diferentes').
  const isClipping = mask.__fromClipping === true || mask.type === "clipping"
  const tooltip = isClipping
    ? "Clipping mask (clipa no layer abaixo) — click to edit"
    : focused ? "Editing mask" : `${mask.type} mask — click to edit`

  return (
    <button
      type="button"
      title={tooltip}
      onClick={e => { e.stopPropagation(); onFocus?.() }}
      style={{
        width: size, height: size, padding: 0, flexShrink: 0,
        border: isClipping ? (focused ? "2px solid #00BCD4" : "1px solid #00BCD4") : border,
        borderRadius: 2, cursor: "pointer",
        background: "#000",
        backgroundImage: dataUrl ? `url(${dataUrl})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity,
        outline: "none",
        position: "relative",
      }}
    >
      {isClipping && (
        <span style={{
          position: "absolute", bottom: -2, right: -2,
          fontSize: 9, lineHeight: 1, color: "#00BCD4",
          background: "#000", borderRadius: 2, padding: "0 1px",
          pointerEvents: "none",
        }}>⏎</span>
      )}
    </button>
  )
}

/**
 * Gera dataUrl PNG B/W do alpha channel do mask. Branco = visivel, preto =
 * escondido (convencao PS). Operacao async porque pode envolver image load.
 */
export async function renderMaskToBwDataUrl(
  mask: any,
  obj: any,
  fc: any,
  size: number,
): Promise<string | null> {
  if (typeof document === "undefined") return null
  if (!mask) return null
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  // Fundo preto = mask area escondida
  ctx.fillStyle = "#000"
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = "#fff"

  if (mask.type === "raster" && mask.raster?.dataUrl) {
    // Raster mask ja vem como B/W. Carrega e desenha.
    const img = await loadImage(mask.raster.dataUrl)
    if (img) {
      ctx.drawImage(img, 0, 0, size, size)
    }
    return canvas.toDataURL("image/png")
  }

  if (mask.type === "vector" && mask.vector?.path) {
    // Vector mask: parseia path SVG e desenha em branco no canvas.
    const v = mask.vector
    const pathBbox = { x: v.posX, y: v.posY, w: v.width, h: v.height }
    // Normaliza coords pro tamanho do thumb.
    const path = new Path2D(v.path)
    const sx = size / Math.max(1, pathBbox.w)
    const sy = size / Math.max(1, pathBbox.h)
    ctx.save()
    ctx.translate(-pathBbox.x * sx, -pathBbox.y * sy)
    ctx.scale(sx, sy)
    ctx.fillStyle = "#fff"
    ctx.fill(path)
    ctx.restore()
    return canvas.toDataURL("image/png")
  }

  if (mask.type === "clipping" && obj && fc) {
    // Clipping mask: silhouette do layer abaixo. Pega o base e renderiza
    // seu alpha como branco no thumb.
    const baseSilhouette = await renderBaseSilhouette(obj, fc, size)
    if (baseSilhouette) {
      ctx.drawImage(baseSilhouette, 0, 0, size, size)
    } else {
      // Fallback: thumb cinza com label "C" pra indicar clipping
      ctx.fillStyle = "#888"
      ctx.fillRect(0, 0, size, size)
      ctx.fillStyle = "#000"
      ctx.font = `bold ${Math.round(size * 0.6)}px sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText("C", size / 2, size / 2)
    }
    return canvas.toDataURL("image/png")
  }

  return canvas.toDataURL("image/png")
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const im = new Image()
    im.crossOrigin = "anonymous"
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null)
    im.src = url
  })
}

/**
 * Pega a silhueta do layer ABAIXO (clipping mask base) renderizada no tamanho
 * do thumb. Usa o clipPath ja existente OU clona o base e usa toCanvasElement.
 */
async function renderBaseSilhouette(
  obj: any,
  fc: any,
  size: number,
): Promise<HTMLCanvasElement | null> {
  // Procura o layer imediatamente abaixo
  const all = fc.getObjects().filter((o: any) =>
    !o.__isBg && !o.__isBleedOverlay && !o.__isStrokeGhost
  )
  const idx = all.indexOf(obj)
  if (idx <= 0) return null
  const base = all[idx - 1]
  if (!base) return null
  try {
    // toCanvasElement renderiza o object em tamanho natural.
    const baseCanvas: HTMLCanvasElement = base.toCanvasElement({ multiplier: 1 })
    // Cria thumb redimensionado + extrai alpha → branco
    const out = document.createElement("canvas")
    out.width = size
    out.height = size
    const ctx = out.getContext("2d")
    if (!ctx) return null
    // Desenha base scaled pra caber no thumb
    const w = baseCanvas.width, h = baseCanvas.height
    if (w === 0 || h === 0) return null
    const scale = Math.min(size / w, size / h)
    const tw = w * scale, th = h * scale
    const tx = (size - tw) / 2, ty = (size - th) / 2
    ctx.drawImage(baseCanvas, tx, ty, tw, th)
    // Converte pra B/W via alpha → branco sobre preto.
    const id = ctx.getImageData(0, 0, size, size)
    const d = id.data
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]
      d[i] = d[i + 1] = d[i + 2] = a
      d[i + 3] = 255
    }
    ctx.putImageData(id, 0, 0)
    // Re-fill bg preto onde alpha era 0 (areas fora do scaled)
    const id2 = ctx.getImageData(0, 0, size, size)
    const d2 = id2.data
    for (let i = 0; i < d2.length; i += 4) {
      // ja convertido — apenas garante que pixels totalmente pretos ficam pretos
      if (d2[i] === 0 && d2[i + 1] === 0 && d2[i + 2] === 0) {
        // ok
      }
    }
    return out
  } catch {
    return null
  }
}
