"use client"
// Exportacao de pecas: PSD editavel + PNG + JPG + PDF
// Suporta peca v2 (layers + assets) e v1 (canvasData legacy)

import { getPostScriptName } from "@/lib/fonts"
import {
  psdPx,
  hexToAgPsdRgb as hexToAgPsdRgbShared,
  extractAlphaFromColor,
  fabricBlendToPsd,
  fabricOpacityToPsd,
  normalizeBlendModeForAgPsd,
} from "@/lib/psd/psdHelpers"
import { leadingPtToFabricLineHeight, applyLeadingPtToFabric } from "@/lib/fabricLineHeight"

export type ExportFormat = "PSD" | "PNG" | "JPG" | "PDF"

// Bake raster mask no bitmap pro pipeline de export (PSD/PNG/JPG/PDF).
// Mesma logica do composeRasterMaskIntoImage do editor: converte coords da
// mask (canvas-space) pra image-natural-space dividindo por scale, depois
// usa destination-in pra recortar pixels.
async function bakeRasterMaskExport(
  sourceImg: HTMLImageElement,
  maskRaster: { dataUrl: string; posX: number; posY: number; width: number; height: number },
  assetPosX: number,
  assetPosY: number,
  assetW: number,
  assetH: number,
  inverted: boolean,
  scaleX: number = 1,
  scaleY: number = 1,
): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null
  const maskImg = await new Promise<HTMLImageElement | null>((resolve) => {
    const im = new Image()
    im.crossOrigin = "anonymous"
    im.onload = () => resolve(im)
    im.onerror = () => resolve(null)
    im.src = maskRaster.dataUrl
  })
  if (!maskImg) return null
  const canvas = document.createElement("canvas")
  canvas.width = assetW; canvas.height = assetH
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.drawImage(sourceImg, 0, 0, assetW, assetH)
  ctx.globalCompositeOperation = inverted ? "destination-out" : "destination-in"
  const ratioX = scaleX !== 0 ? 1 / scaleX : 1
  const ratioY = scaleY !== 0 ? 1 / scaleY : 1
  const maskOffsetX = (maskRaster.posX - assetPosX) * ratioX
  const maskOffsetY = (maskRaster.posY - assetPosY) * ratioY
  const maskW = maskRaster.width * ratioX
  const maskH = maskRaster.height * ratioY
  ctx.drawImage(maskImg, maskOffsetX, maskOffsetY, maskW, maskH)
  ctx.globalCompositeOperation = "source-over"
  return canvas
}

// MIME type por extensao — usado pelo Save As dialog do showSaveFilePicker.
const MIME_BY_EXT: Record<string, string> = {
  psd: "image/vnd.adobe.photoshop",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  pdf: "application/pdf",
  zip: "application/zip",
}

/**
 * Toast visivel com link manual pra download. Mostra QUANDO o iframe automatico
 * pode ter sido bloqueado (adblocker, content blocker, etc — sintoma classico:
 * funciona em janela anonima mas nao no browser normal). User clica = gesture
 * direto = browser sempre permite. Auto-some em 15s.
 */
function showDownloadFallbackToast(url: string, filename: string): void {
  if (typeof document === "undefined") return
  // Remove toast anterior se existir
  document.getElementById("__zzosy-download-toast")?.remove()
  const toast = document.createElement("div")
  toast.id = "__zzosy-download-toast"
  toast.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 99999;
    background: #1a1a1a; color: white;
    padding: 14px 18px; border-radius: 8px;
    font-family: 'DM Sans', system-ui, sans-serif; font-size: 13px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); border: 1px solid #F5C400;
    display: flex; flex-direction: column; gap: 10px; max-width: 360px;
  `
  toast.innerHTML = `
    <div style="font-weight:600;color:#F5C400">Download iniciado</div>
    <div style="color:#bbb;font-size:12px;line-height:1.4">Se não apareceu em Downloads (extensões podem bloquear), clique abaixo:</div>
    <div style="display:flex;gap:8px;align-items:center">
      <a id="__zzosy-download-link" href="${url}" download="${filename.replace(/"/g, "")}" target="_blank"
        style="background:#F5C400;color:#111;padding:8px 14px;border-radius:4px;text-decoration:none;font-weight:700;font-size:12px">
        Baixar manualmente
      </a>
      <button id="__zzosy-download-close" style="background:transparent;color:#888;border:none;cursor:pointer;font-size:14px;padding:4px 8px">Fechar</button>
    </div>
  `
  document.body.appendChild(toast)
  const close = () => toast.remove()
  toast.querySelector("#__zzosy-download-close")?.addEventListener("click", close)
  toast.querySelector("#__zzosy-download-link")?.addEventListener("click", () => setTimeout(close, 500))
  setTimeout(close, 15000)
}

async function downloadBlob(blob: Blob, filename: string, targetWindow?: Window | null): Promise<void> {
  // PLANO A+B 2026-05-24: adblockers bloqueiam iframe.src e .click() programatico
  // pq o user gesture se perdeu na chain async do export. Solucao:
  //   B) targetWindow = tab vazia aberta SYNC no click do user (gesture vivo).
  //      Setamos targetWindow.location.href = url quando o proxy retorna.
  //   A) fallback: window.location.href = url. Browser ve Content-Disposition
  //      e baixa sem realmente navegar a SPA — extensions raramente bloqueiam
  //      navegacao (seria quebrar o site).
  //   Toast manual SEMPRE visivel se nada disparar.
  let safeFilename = (filename ?? "").trim()
  if (!safeFilename || /^\.+$/.test(safeFilename)) safeFilename = `download-${Date.now()}.bin`
  if (!/\.[a-zA-Z0-9]+$/.test(safeFilename)) safeFilename = `${safeFilename}.bin`
  console.log("[downloadBlob]", { filename: safeFilename, size: blob.size, mime: blob.type, hasTargetWindow: !!targetWindow })
  try {
    const fd = new FormData()
    fd.append("file", blob, safeFilename)
    fd.append("filename", safeFilename)
    const res = await fetch("/api/download-proxy", { method: "POST", body: fd })
    if (!res.ok) throw new Error(`proxy upload failed: ${res.status}`)
    const { url } = await res.json()
    if (!url) throw new Error("proxy returned no url")
    console.log("[downloadBlob] proxy OK, url:", url)
    let triggered = false
    // PLANO B: tab dedicada com gesture preservado
    if (targetWindow && !targetWindow.closed) {
      try {
        targetWindow.location.href = url
        // Content-Disposition: attachment faz browser baixar SEM navegar a tab.
        // A tab fica em about:blank — fechamos apos 3s. Se o download falhou
        // ela navega pro URL e mostra; user pode fechar manualmente.
        setTimeout(() => { try { if (targetWindow && !targetWindow.closed) targetWindow.close() } catch {} }, 3000)
        triggered = true
      } catch (e) {
        console.warn("[downloadBlob] targetWindow.location.href falhou:", e)
      }
    }
    // PLANO A: navegar a SPA (browser pega Content-Disposition e baixa, sem navegar)
    if (!triggered) {
      try {
        window.location.href = url
        triggered = true
      } catch (e) {
        console.warn("[downloadBlob] window.location.href falhou:", e)
      }
    }
    // Toast manual sempre — fallback visivel se algum metodo falhou silenciosamente.
    showDownloadFallbackToast(url, safeFilename)
  } catch (e) {
    console.warn("[downloadBlob] proxy falhou, fallback file-saver:", e)
    try {
      const { saveAs } = await import("file-saver")
      saveAs(blob, safeFilename)
    } catch (e2) {
      console.warn("[downloadBlob] file-saver tb falhou, ultimo fallback <a download>:", e2)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = safeFilename
      a.style.position = "fixed"; a.style.opacity = "0"
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
    }
  }
}

function safeName(s: string) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9]+/g, "-")                    // tudo que nao for alfanumerico vira '-'
    .replace(/^-+|-+$/g, "")                           // tira '-' nas pontas
    .replace(/-{2,}/g, "-")                            // colapsa multiplos '-'
    .substring(0, 80)
}

function buildFileName(campaignName: string | undefined, piece: { name: string; width: number; height: number; __stepIndex?: number }) {
  const camp = campaignName ? safeName(campaignName) : ""
  // Se a peca veio expandida de multi-step, tira o sufixo "_Step{N}" do name
  // pra que o midia seja o nome original limpo. O step entra no final via
  // __stepIndex (setado em expandSteps).
  const cleanName = (piece as any).__stepIndex !== undefined
    ? piece.name.replace(/_Step\d+$/i, "")
    : piece.name
  const midia = safeName(cleanName)
  const dims = `${Math.round(piece.width)}x${Math.round(piece.height)}`
  const stepPart = (piece as any).__stepIndex !== undefined
    ? `Step${((piece as any).__stepIndex as number) + 1}`
    : ""
  // Formato: CAMPANHA_MIDIA_DIMENSOES[_StepN] — step sempre por ultimo pra
  // ordenacao alfabetica agrupar todos os steps de uma mesma peca juntos.
  return [camp, midia, dims, stepPart].filter(Boolean).join("_")
}

/**
 * Spread comum aplicado a TODA layer pushed pro ag-psd (TEXT/SHAPE/Smart
 * Object/IMAGE). Centraliza opacity/blendMode/effects/__groupPath em vez
 * de repetir o padrao em 4 sites. Sem isso, adicionar um novo field
 * round-trip exige tocar todas as branches (drift garantido — ja aconteceu).
 *
 * Use sempre como `...commonAgPsdLayerFields(obj, ..., ..., ...)`.
 */
function commonAgPsdLayerFields(
  obj: any,
  opacity: number | undefined,
  blend: string | undefined,
  effects: any | undefined,
): Record<string, unknown> {
  return {
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blend ? { blendMode: blend } : {}),
    ...(effects ? { effects } : {}),
    // anotacao temporaria: removida antes do writePsd na fase de nesting.
    __groupPath: Array.isArray((obj as any)?.__groupPath) ? (obj as any).__groupPath : undefined,
  }
}

// Renderiza todos os BG layers (BgLayerData[]) num CanvasRenderingContext2D.
// Suporta solid, gradient linear/radial e image (cover/contain/fill/tile).
// Respeita opacity, blendMode (globalCompositeOperation) e hidden.
// Ignora mask por enquanto (mask só funciona no editor; export degraded).
// Async pq image precisa carregar.
async function renderBgLayersOntoCanvas(
  ctx: CanvasRenderingContext2D, layers: any[], w: number, h: number,
): Promise<void> {
  for (const layer of layers) {
    if (!layer || layer.hidden) continue
    ctx.save()
    ctx.globalAlpha = typeof layer.opacity === "number" ? layer.opacity : 1
    ctx.globalCompositeOperation = (layer.blendMode ?? "source-over") as GlobalCompositeOperation
    try {
      if (layer.kind === "solid") {
        ctx.fillStyle = layer.color ?? "#ffffff"
        ctx.fillRect(0, 0, w, h)
      } else if (layer.kind === "gradient") {
        const angle = typeof layer.angle === "number" ? layer.angle : 90
        const rad = (angle * Math.PI) / 180
        const cx = w / 2, cy = h / 2
        const r = Math.max(w, h) / 2
        const grad = layer.gradientType === "radial"
          ? ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) / 2)
          : ctx.createLinearGradient(cx - Math.cos(rad) * r, cy - Math.sin(rad) * r, cx + Math.cos(rad) * r, cy + Math.sin(rad) * r)
        for (const s of (layer.stops ?? [])) {
          if (typeof s?.offset === "number" && typeof s?.color === "string") grad.addColorStop(s.offset, s.color)
        }
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, w, h)
      } else if (layer.kind === "image" && typeof layer.imageDataUrl === "string" && layer.imageDataUrl) {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const i = new window.Image()
          i.crossOrigin = "anonymous"
          i.onload = () => resolve(i)
          i.onerror = () => reject(new Error("img load"))
          i.src = layer.imageDataUrl
        })
        if (layer.fit === "tile") {
          const pat = ctx.createPattern(img, "repeat")
          if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h) }
        } else if (layer.fit === "fill") {
          ctx.drawImage(img, 0, 0, w, h)
        } else {
          const iw = img.naturalWidth || img.width || 1
          const ih = img.naturalHeight || img.height || 1
          const s = layer.fit === "contain" ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)
          const dw = iw * s, dh = ih * s
          ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
        }
      }
    } catch (e) {
      console.warn("[bg-export] falha renderizando BG layer:", e)
    } finally {
      ctx.restore()
    }
  }
}

// Pega bgLayers do data; se nao existir, migra do bgColor/bgOpacity legacy
// pra um array com 1 BG solid (back-compat).
function bgLayersFromData(data: any): any[] {
  if (Array.isArray(data?.bgLayers) && data.bgLayers.length > 0) return data.bgLayers
  return [{ kind: "solid", color: data?.bgColor ?? "#ffffff", opacity: typeof data?.bgOpacity === "number" ? data.bgOpacity : 1 }]
}

interface Asset {
  id: string; type: string; label: string; value: string | null; imageUrl: string | null; content: any
  smartObject?: {
    id: string
    guid: string
    filePath: string
    mime: string
    originalName: string
    width: number | null
    height: number | null
  } | null
}

// Normaliza um asset vindo da API (CampaignAsset com include smartObject) pro
// formato local Asset usado pelos export pipelines.
function normalizeAsset(a: any): Asset {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    value: a.value ?? null,
    imageUrl: a.imageUrl ?? null,
    content: a.content ?? null,
    smartObject: a.smartObject ? {
      id: a.smartObject.id,
      guid: a.smartObject.guid,
      filePath: a.smartObject.filePath,
      mime: a.smartObject.mime,
      originalName: a.smartObject.originalName,
      width: a.smartObject.width ?? null,
      height: a.smartObject.height ?? null,
    } : null,
  }
}

function parseContent(raw: any): any[] {
  if (!raw) return []
  if (typeof raw === "string") { try { return JSON.parse(raw) } catch { return [] } }
  if (Array.isArray(raw)) return raw
  return []
}

/**
 * Parseia content de SHAPE asset (path + fill + stroke + fillRule). Aceita
 * tanto string JSON (formato banco) quanto objeto direto (caches em memoria).
 * Espelha a logica do KeyVisionEditor pra rendering consistente entre editor
 * e export.
 */
function parseShapeContent(raw: any): { path?: string; pathBbox?: any; fill?: any; stroke?: any; fillRule?: any } | null {
  if (!raw) return null
  let parsed: any = raw
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw) } catch { return null }
  }
  if (typeof parsed !== "object") return null
  return parsed
}

/**
 * Converte SVG path string "M ax ay C cp1x cp1y, cp2x cp2y, ax2 ay2 ... Z"
 * em ag-psd knots[] (inverso do reader.ts:bezierPathToSvg).
 *
 * Aplica transformacao Fabric (left/top atual + scaleX/Y) sobre o pathBbox
 * original — assim, mover/escalar a SHAPE no editor reflete no vector
 * exportado pro PSD.
 *
 * Limitacao atual: nao suporta rotacao. Se obj.angle != 0, fallback rasteriza.
 * Cobertura: M, L, C, Z (subset que reader produz pra shapes do PS).
 */
function svgPathToAgPsdKnots(
  svg: string,
  pathBboxLeft: number,
  pathBboxTop: number,
  worldLeft: number,
  worldTop: number,
  scaleX: number,
  scaleY: number,
): Array<{ points: number[] }> | null {
  if (!svg) return null
  // Transforma um ponto do path-space pro world-space (canvas final do PSD).
  const tx = (x: number) => worldLeft + (x - pathBboxLeft) * scaleX
  const ty = (y: number) => worldTop + (y - pathBboxTop) * scaleY
  // Tokens: split por M/L/C/Z (preservando o operador).
  const tokens = svg.replace(/Z\s*$/i, "").trim().split(/(?=[MLCZmlcz])/).map(s => s.trim()).filter(Boolean)
  type Knot = { cpL: { x: number; y: number }; anchor: { x: number; y: number }; cpR: { x: number; y: number } }
  const knots: Knot[] = []
  for (const tok of tokens) {
    const op = tok[0].toUpperCase()
    const nums = (tok.slice(1).match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
    if (op === "M") {
      knots.push({
        cpL: { x: tx(nums[0]), y: ty(nums[1]) },
        anchor: { x: tx(nums[0]), y: ty(nums[1]) },
        cpR: { x: tx(nums[0]), y: ty(nums[1]) },
      })
    } else if (op === "L") {
      const x = tx(nums[0]), y = ty(nums[1])
      if (knots.length > 0) {
        knots[knots.length - 1].cpR = { x, y }
      }
      knots.push({ cpL: { x, y }, anchor: { x, y }, cpR: { x, y } })
    } else if (op === "C") {
      // C cp1x cp1y, cp2x cp2y, endx endy
      const cp1x = tx(nums[0]), cp1y = ty(nums[1])
      const cp2x = tx(nums[2]), cp2y = ty(nums[3])
      const endx = tx(nums[4]), endy = ty(nums[5])
      if (knots.length > 0) {
        knots[knots.length - 1].cpR = { x: cp1x, y: cp1y }
      }
      knots.push({
        cpL: { x: cp2x, y: cp2y },
        anchor: { x: endx, y: endy },
        cpR: { x: endx, y: endy }, // sera atualizado pelo proximo C
      })
    }
  }
  if (knots.length === 0) return null
  // Path fechado: ultimo knot duplica o primeiro (M e ultimo C voltam pro start).
  // Detecta e funde — transferindo cpL do ultimo pro primeiro.
  if (knots.length >= 2) {
    const first = knots[0]
    const last = knots[knots.length - 1]
    if (Math.abs(first.anchor.x - last.anchor.x) < 0.5 && Math.abs(first.anchor.y - last.anchor.y) < 0.5) {
      first.cpL = last.cpL
      knots.pop()
    }
  }
  return knots.map(k => ({
    points: [k.cpL.x, k.cpL.y, k.anchor.x, k.anchor.y, k.cpR.x, k.cpR.y],
  }))
}

const hexToAgPsdRgb = hexToAgPsdRgbShared
const extractAlpha = extractAlphaFromColor

// Constroi o canvas Fabric da peca a partir de layers + assets
export async function buildPieceCanvas(piece: any, assets: Asset[]): Promise<any> {
  const fabric = await import("fabric")
  const StaticCanvas = (fabric as any).StaticCanvas
  const Textbox = (fabric as any).Textbox
  const FabricImage = (fabric as any).FabricImage ?? (fabric as any).Image
  const Rect = (fabric as any).Rect
  const Shadow = (fabric as any).Shadow
  const Path = (fabric as any).Path

  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? piece.width ?? 1080
  const H = data?.height ?? piece.height ?? 1080
  // BG-7: usa novo schema bgLayers se existir, senao migra do bgColor legacy.
  // StaticCanvas tem backgroundColor apenas pra cor solida; pra gradient/image
  // multilayer, a renderizacao completa do BG eh feita no ctx final ANTES do
  // drawImage(fc) — ver bloco "ctx.fillStyle = bgColor[0]" mais abaixo.
  const bgLayers = bgLayersFromData(data)
  const fallbackBg = bgLayers[0]?.kind === "solid" ? bgLayers[0].color : "#ffffff"

  const el = document.createElement("canvas")
  el.width = W; el.height = H
  const fc = new StaticCanvas(el, { width: W, height: H, enableRetinaScaling: false, backgroundColor: fallbackBg })
  // Pareia com KeyVisionEditor: o editor define fc.clipPath = pageRect (commit
  // 9968ddc) escondendo o que sai da pagina. Sem o mesmo clip no export, layers
  // overflow visiveis no PNG/JPG/PSD divergem do que o user ve (audit H2).
  try {
    const Rect = (fabric as any).Rect
    if (Rect) {
      ;(fc as any).clipPath = new Rect({
        left: 0, top: 0, width: W, height: H,
        absolutePositioned: true, selectable: false, evented: false,
      })
    }
  } catch {}

  // V2: layers + assets
  if (data?.version === 2 && Array.isArray(data?.layers)) {
    const assetMap = Object.fromEntries(assets.map(a => [a.id, a]))
    const sorted = [...data.layers].sort((a: any, b: any) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

    for (const layer of sorted) {
      const asset = assetMap[layer.assetId]
      if (!asset) continue
      // Layers hidden no PSD não devem renderizar (mas continuam no JSON pra
      // round-trip preservar o estado).
      if (layer.hidden === true) continue
      const overrides = layer.overrides ?? {}
      // PSD opacity/blendMode (capturados no import) → Fabric props.
      // Fabric aceita "opacity" 0..1 e "globalCompositeOperation" (canvas spec).
      // Sanity check: opacity < 0.01 = bug do importer antigo (divisão 2x por 255).
      // Trata como 1 pra render sair visível mesmo em KV/peças não-reimportados.
      const rawOpacity = typeof layer.opacity === "number" ? layer.opacity : 1
      const layerOpacity = (rawOpacity > 0 && rawOpacity < 0.01) ? 1 : rawOpacity
      const layerBlend = typeof layer.blendMode === "string" && layer.blendMode ? layer.blendMode : "source-over"
      const layerEffects = (layer.effects && typeof layer.effects === "object") ? layer.effects : null
      // Fabric v7 exige Shadow INSTANCE — passar plain object faz o render
      // sair em branco silenciosamente.
      const fabricShadow = (() => {
        if (!layerEffects) return undefined
        const d = layerEffects.dropShadow ?? layerEffects.outerGlow
        if (!d) return undefined
        return new Shadow({ color: d.color ?? "rgba(0,0,0,0.5)", offsetX: d.offsetX ?? 0, offsetY: d.offsetY ?? 0, blur: d.blur ?? 5 })
      })()
      const fabricStroke = layerEffects?.stroke ? { stroke: layerEffects.stroke.color, strokeWidth: layerEffects.stroke.width ?? 1 } : null

      if (asset.type === "TEXT") {
        const spans = parseContent(asset.content)
        // overrides.text: se a peca/matriz salvou quebras de linha locais (\n
        // inserido pelo user no editor), usar esse texto em vez do raw do asset.
        // Sem isso, o PSD exportado nao tem as quebras, e texto vem ofuscado.
        const rawAssetText = spans.length ? spans.map((s: any) => s.text).join("") : (asset.value ?? asset.label)
        const fullText: string = (typeof overrides.text === "string" && overrides.text.length > 0)
          ? overrides.text
          : rawAssetText
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
          // Default lineHeight 1.0 (1:1 com fontSize) pra bater com o editor.
          // Antes era 1.16 (Fabric default) — gerava entrelinha errada no PSD.
          lineHeight: overrides.lineHeight ?? 1.0,
          textAlign: overrides.textAlign ?? "left",
          opacity: layerOpacity,
          globalCompositeOperation: layerBlend,
          ...(fabricStroke ?? {}),
          ...(fabricShadow ? { shadow: fabricShadow } : {}),
        })
        // leadingPt: fonte da verdade pra entrelinha (Adobe-style). Aplica apos
        // o construtor pra exporter conseguir ler em buildStyleRuns.
        if (overrides.leadingPt !== undefined && overrides.leadingPt !== null) {
          ;(t as any).leadingPt = overrides.leadingPt
          // applyLeadingPtToFabric MEDE o factor real do Fabric naquela linha
          // (em vez de assumir constante 1.13) — match exato baseline-to-baseline
          // com PSD. User reportou 2026-05-23 com print: ainda ~10% off com
          // helper fast path; medicao runtime resolve completamente.
          applyLeadingPtToFabric(t, overrides.leadingPt)
        }
        // Aplicar styles per-char DEPOIS (Fabric Textbox ignora styles no construtor)
        // Prioridade: overrides.styles (peca) > assetStyles (matriz/asset)
        const finalStyles = overrides.styles ?? assetStyles
        if (finalStyles && Object.keys(finalStyles).length > 0) {
          ;(t as any).set("styles", finalStyles)
          if ((t as any).initDimensions) (t as any).initDimensions()
        }
        // Anti-overwrap: PSD media o textbox com sub-pixel precision do Photoshop.
        // No browser, font metrics podem variar centesimos de pixel e fazer um
        // texto que cabia em N linhas no PSD quebrar pra N+1. KeyVisionEditor
        // ja faz esse autofit no addAssetToCanvas; PRECISA bater AQUI tb pra
        // que o thumb gerado off-screen tenha o MESMO layout que o editor
        // mostra. Sem isso, preview vinha com texto quebrado em 2 linhas mas
        // editor abria em 1 linha (autofit so rodava la).
        try {
          const fullText: string = (t as any).text ?? ""
          const expectedLines = (fullText.match(/\n/g)?.length ?? 0) + 1
          let attempts = 0
          while (((t as any)._textLines?.length ?? 0) > expectedLines && attempts < 3) {
            const currentWidth = (t as any).width ?? Math.max(layer.width ?? 400, 100)
            ;(t as any).set("width", Math.ceil(currentWidth * 1.05))
            if ((t as any).initDimensions) (t as any).initDimensions()
            attempts++
          }
        } catch { /* tolera erro: thumb sai com wrap original */ }
        ;(t as any).__assetId = asset.id
        ;(t as any).__assetLabel = asset.label
        if (layer.mask) (t as any).__maskData = layer.mask
        if (layerEffects) (t as any).__psdEffects = layerEffects
        // nameSource ('lnsr') preservado do PSD original. Round-trip: PSD
        // importado com 'lyr ' (nome manual) volta a sair como 'lyr '.
        if (typeof (layer as any).nameSource === "string") {
          ;(t as any).__psdNameSource = (layer as any).nameSource
        }
        // groupPath: hierarquia de folders do PSD original. Sem isso o export
        // PSD (nestByGroupPath) caia em "raiz" e perdia toda a estrutura de
        // grupos — designer abria no Photoshop e via layers achatados.
        if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) {
          ;(t as any).__groupPath = layer.groupPath
        }
        fc.add(t)
      } else if (asset.type === "IMAGE") {
        if (asset.imageUrl) {
          try {
            // Mesmo fix do KeyVisionEditor: SVGs sem width/height intrinsecos carregam
            // com naturalWidth=150 (default do user-agent). Injeta dimensoes do viewBox
            // no markup via Blob URL pra Fabric pegar tamanho real.
            const isSvg = /\.svg(\?|$)/i.test(asset.imageUrl)
            let imgSrc = asset.imageUrl
            if (isSvg) {
              try {
                const txt = await fetch(asset.imageUrl).then(r => r.text())
                const widthAttr = txt.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)?.[1]
                const heightAttr = txt.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)?.[1]
                const viewBox = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
                const numFromAttr = (s?: string) => {
                  if (!s) return undefined
                  const n = parseFloat(s)
                  return Number.isFinite(n) && n > 0 ? n : undefined
                }
                let w = numFromAttr(widthAttr)
                let h = numFromAttr(heightAttr)
                if ((!w || !h) && viewBox) {
                  const parts = viewBox.split(/[\s,]+/).map(Number)
                  if (parts.length === 4 && parts.every(Number.isFinite)) {
                    w = w ?? parts[2]
                    h = h ?? parts[3]
                  }
                }
                if (w && h && (!widthAttr || !heightAttr)) {
                  const patched = txt.replace(/<svg\b([^>]*)>/i, (_, attrs) => {
                    let a = attrs
                    if (!/\swidth\s*=/i.test(a)) a += ` width="${w}"`
                    if (!/\sheight\s*=/i.test(a)) a += ` height="${h}"`
                    return `<svg${a}>`
                  })
                  const blob = new Blob([patched], { type: "image/svg+xml" })
                  imgSrc = URL.createObjectURL(blob)
                }
              } catch (e) { console.warn("[SVG-EXPORT] falha lendo dimensoes:", e) }
            }
            const img = await new Promise<any>((resolve, reject) => {
              const ie = new window.Image()
              ie.crossOrigin = "anonymous"
              ie.onload = async () => {
                const sxBake = layer.scaleX ?? 1
                const syBake = layer.scaleY ?? 1
                // Bake da raster mask no bitmap, igual o editor faz. Sem isso,
                // a renderizacao pra preview/composite/PDF/JPG/PNG sai com a
                // IMAGEM INTEIRA (sem recorte), em vez do que a mask deveria
                // revelar. Photoshop tambem recebe o canvas raster bakeado +
                // o layer.mask original em paralelo (round-trip), entao o PSD
                // exportado fica visualmente correto E editavel.
                let source: HTMLImageElement | HTMLCanvasElement = ie
                let maskBaked = false
                if (layer?.mask?.type === "raster" && layer.mask.enabled !== false && layer.mask.raster?.dataUrl) {
                  try {
                    const baked = await bakeRasterMaskExport(
                      ie, layer.mask.raster,
                      layer.posX ?? 0, layer.posY ?? 0,
                      ie.naturalWidth || ie.width || 1,
                      ie.naturalHeight || ie.height || 1,
                      !!layer.mask.inverted, sxBake, syBake,
                    )
                    if (baked) { source = baked; maskBaked = true }
                  } catch (e) { console.warn("[export-mask-bake] fail:", asset.label, e) }
                }
                const fImg = new FabricImage(source, {
                  left: layer.posX, top: layer.posY,
                  scaleX: sxBake, scaleY: syBake,
                  angle: layer.rotation ?? 0,
                  opacity: layerOpacity,
                  globalCompositeOperation: layerBlend,
                  ...(fabricStroke ?? {}),
                  ...(fabricShadow ? { shadow: fabricShadow } : {}),
                })
                // Marca pro export PSD nao re-aplicar a mask (evita dupla mask:
                // canvas baked + mask ag-psd = Photoshop corta a interseccao).
                if (maskBaked) (fImg as any).__maskAlreadyBaked = true
                resolve(fImg)
              }
              ie.onerror = reject
              ie.src = imgSrc
            })
            ;(img as any).__assetId = asset.id
            ;(img as any).__assetLabel = asset.label
            // Preserva mask do layer pro export PSD reproduzi-la no arquivo.
            if (layer.mask) (img as any).__maskData = layer.mask
            if (layerEffects) (img as any).__psdEffects = layerEffects
            // groupPath: hierarquia de folders do PSD (round-trip).
            if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) {
              ;(img as any).__groupPath = layer.groupPath
            }
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
      } else if (asset.type === "SHAPE") {
        // F12 Fase 4 (export-side): SHAPE assets — Fabric.Path com fill/stroke
        // vivos (sem rasterizar). Antes esse caminho NAO existia em
        // buildPieceCanvas → SHAPE invisivel no canvas montado pro export →
        // PSD/PNG/JPG saiam VAZIOS apos importar PSD com vetor.
        try {
          const shape = parseShapeContent(asset.content)
          if (shape?.path) {
            const overrides = layer.overrides ?? {}
            // Editor pode sobrescrever fill/stroke/strokeWidth via painel —
            // overrides ganham prioridade sobre o asset original.
            const fillProp = overrides.fill !== undefined ? overrides.fill
              : (shape.fill?.kind === "solid" ? shape.fill.color : "transparent")
            const strokeProp = overrides.stroke !== undefined ? overrides.stroke
              : (shape.stroke?.color ?? undefined)
            const strokeW = overrides.strokeWidth !== undefined ? overrides.strokeWidth
              : (shape.stroke?.width ?? 0)
            // PARAMETRIC SHAPE: recomputa path com dimensoes/raio efetivos.
            // Effective W = bbox.W * layer.scaleX (a menos que ja exista override
            // bboxW). Sem multiplicar pelo layer.scaleX, exports saiam 3x menores
            // que o editor quando user escalava o shape (user reportou 2026-05-22).
            //
            // Apos recompute path tem dims absolutos → Fabric.Path NAO precisa
            // de scaleX/Y (set como 1) → PSD vai com path no tamanho correto.
            // Promocao parametric: PSD shapes nao parametricos viram parametricos
            // quando user edita cornerRadius via panel. Sem promover no export,
            // o PNG/PSD da peca saia com path original (corner radius perdido).
            // Detecta pela presenca de cornerRadius>0 + bboxW/bboxH em overrides.
            // Mesmo pattern que KeyVisionEditor.tsx load (manter em sync).
            const userPromoted = !(shape as any).kind
              && typeof overrides.cornerRadius === "number" && overrides.cornerRadius > 0
              && typeof overrides.bboxW === "number" && overrides.bboxW > 0
              && typeof overrides.bboxH === "number" && overrides.bboxH > 0
            const shapeKind = ((shape as any).kind ?? (userPromoted ? "roundedRect" : undefined)) as ("rectangle"|"roundedRect"|"ellipse"|undefined)
            const layerScaleX = layer.scaleX ?? 1
            const layerScaleY = layer.scaleY ?? 1
            let pathD = shape.path
            let bboxW = shape.pathBbox ? ((shape.pathBbox.right ?? 0) - (shape.pathBbox.left ?? 0)) : 0
            let bboxH = shape.pathBbox ? ((shape.pathBbox.bottom ?? 0) - (shape.pathBbox.top ?? 0)) : 0
            // Multiplica pelo layer scale SE nao ha override explicito (override
            // ja vem com dims absolutos do scaling hook).
            if (typeof overrides.bboxW === "number" && overrides.bboxW > 0) {
              bboxW = overrides.bboxW
            } else if (shapeKind) {
              bboxW = bboxW * layerScaleX
            }
            if (typeof overrides.bboxH === "number" && overrides.bboxH > 0) {
              bboxH = overrides.bboxH
            } else if (shapeKind) {
              bboxH = bboxH * layerScaleY
            }
            const effCornerR = typeof overrides.cornerRadius === "number"
              ? overrides.cornerRadius
              : (typeof (shape as any).cornerRadius === "number" ? (shape as any).cornerRadius : 0)
            if (shapeKind && bboxW > 0 && bboxH > 0) {
              const { buildShapePath } = await import("@/lib/shapePaths")
              pathD = buildShapePath(shapeKind, bboxW, bboxH, effCornerR)
            }
            const p = new Path(pathD, {
              left: layer.posX ?? shape.pathBbox?.left ?? 0,
              top: layer.posY ?? shape.pathBbox?.top ?? 0,
              fill: fillProp,
              stroke: strokeProp,
              strokeWidth: strokeW,
              strokeUniform: true,
              fillRule: shape.fillRule ?? "nonzero",
              // Path parametric ja tem dims absolutos (path D baked com bboxW*scaleX).
              // Path nao-parametric mantem scale do layer pra escalar coords cru.
              scaleX: shapeKind ? 1 : layerScaleX,
              scaleY: shapeKind ? 1 : layerScaleY,
              angle: layer.rotation ?? 0,
              opacity: typeof layer.opacity === "number" ? layer.opacity : 1,
              globalCompositeOperation: layer.blendMode ?? "source-over",
            })
            ;(p as any).__assetId = asset.id
            ;(p as any).__assetLabel = asset.label
            ;(p as any).__isShape = true
            // Propaga metadata parametric — branch SHAPE do PSD export le pra
            // emitir vogk (Live Shape no PS).
            if (shapeKind) {
              ;(p as any).__shapeKind = shapeKind
              ;(p as any).__cornerRadius = effCornerR
              ;(p as any).__pathBbox = { left: 0, top: 0, right: bboxW, bottom: bboxH }
            }
            if (Array.isArray(layer.groupPath) && layer.groupPath.length > 0) {
              ;(p as any).__groupPath = layer.groupPath
            }
            // PSD layer effects (drop shadow, layer style stroke, outer glow,
            // color overlay, gradient overlay, bevel, satin) — round-trip
            // preservado via __psdEffects. Antes a branch SHAPE NAO propagava
            // esse campo do layer pro Fabric.Path → export PSD lia obj
            // .__psdEffects=undefined → effects sumiam. Mesma logica TEXT
            // (linha 490) + IMAGE (linha 585). User reportou 2026-05-22.
            if (layerEffects) (p as any).__psdEffects = layerEffects
            // Mask metadata: __maskData preservado pra export PSD escrever
            // raster/vector/clipping no layer. Sem isso, mask criada no
            // editor sumia no export PSD/PNG. Mesmo pattern TEXT/IMAGE
            // (linhas 464, 559) — antes faltava no SHAPE.
            if (layer.mask) (p as any).__maskData = layer.mask
            fc.add(p)
          }
        } catch (e) { console.warn("[shape-export] falha:", asset.label, e) }
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
  // cache: "no-store" eh CRITICO. Sem ele, o navegador serve respostas
  // cacheadas de GETs anteriores. Resultado: o user edita uma peca no editor,
  // exporta — e o export usa a versao VELHA (cache). Bug "exporta layout
  // antigo" mesmo com a peca editada no banco.
  const pres = await fetch(`/api/pieces/${pieceId}`, { cache: "no-store" })
  const piece = await pres.json()
  const cres = await fetch(`/api/campaigns/${piece.campaignId}`, { cache: "no-store" })
  const camp = await cres.json()
  return { piece, assets: Array.isArray(camp.assets) ? camp.assets.map(normalizeAsset) : [] }
}

async function renderToCanvas(pieceLite: { id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }): Promise<{ canvas: HTMLCanvasElement; dpi: number }> {
  // Sempre busca peça + assets do servidor (sync) caso tenha id
  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    if (pieceLite.id.startsWith("kv-")) {
      const campaignId = pieceLite.id.slice(3)
      const r = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (r.ok) {
        const camp = await r.json()
        if (Array.isArray(camp.assets)) {
          assets = camp.assets.map(normalizeAsset)
        }
      }
    } else if (pieceLite.__virtualStepOriginalId) {
      // Peca virtual de step: busca SO os assets da campanha. Mantem o
      // piece.data como veio em pieceLite (com layers do step especifico).
      // Sem isso, o data do banco (com TODOS os steps) sobrescreveria os
      // layers do step e o export sairia errado/vazio.
      const r = await fetch(`/api/pieces/${pieceLite.id}`, { cache: "no-store" })
      if (r.ok) {
        const p = await r.json()
        const cres = await fetch(`/api/campaigns/${p.campaignId}`, { cache: "no-store" })
        if (cres.ok) {
          const camp = await cres.json()
          if (Array.isArray(camp.assets)) assets = camp.assets.map(normalizeAsset)
        }
      }
      // NAO sobrescreve piece — fica como pieceLite (com data do step certo).
    } else {
      const fetched = await fetchPieceWithAssets(pieceLite.id)
      piece = fetched.piece
      assets = fetched.assets
    }
  }
  const fc = await buildPieceCanvas(piece, assets)
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? pieceLite.width
  const H = data?.height ?? pieceLite.height
  // DPI vem do data.dpi (salvo no momento da geracao a partir do MediaFormat).
  // Fallback 72 (tela) se nao definido.
  const dpi = Math.round(Number(data?.dpi)) || 72

  const out = document.createElement("canvas")
  out.width = W; out.height = H
  const ctx = out.getContext("2d", { alpha: false } as any)! as CanvasRenderingContext2D
  // BG-7: renderiza TODOS os BG layers (solid/gradient/image) antes dos
  // asset layers do fc. Fallback automatico pra bgColor legacy se sem bgLayers.
  await renderBgLayersOntoCanvas(ctx, bgLayersFromData(data), W, H)
  ctx.drawImage(fc.getElement() as HTMLCanvasElement, 0, 0)
  fc.dispose()
  return { canvas: out, dpi }
}

/**
 * Injeta um chunk pHYs no PNG com a resolucao em pixels-per-meter.
 * Photoshop e visualizadores leem isso pra mostrar o DPI correto.
 *  Padrao do pHYs: 9 bytes de dados + 4 bytes CRC.
 *  ppX (4 bytes) | ppY (4 bytes) | unit (1 byte, 1 = meter)
 *  ppm = round(dpi / 0.0254) (1 inch = 0.0254 m)
 */
function injectPngDpi(pngBytes: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  // Sinatura PNG (8 bytes) + IHDR (que tem length 13 bytes + type + data + crc).
  // O IHDR comeca em offset 8. Tamanho total IHDR: 4 (length) + 4 (type) + 13 (data) + 4 (crc) = 25 bytes.
  // Quero inserir o pHYs LOGO APOS o IHDR. Offset de insercao = 8 + 25 = 33.
  const insertAt = 33

  // Monta o chunk pHYs:
  //   length (4 bytes BE) = 9
  //   type (4 bytes ASCII) = "pHYs"
  //   data (9 bytes) = ppX(4) + ppY(4) + unit(1)
  //   crc (4 bytes BE) = CRC32 de (type + data)
  const chunkData = new Uint8Array(9)
  const dv = new DataView(chunkData.buffer)
  dv.setUint32(0, ppm, false)
  dv.setUint32(4, ppm, false)
  chunkData[8] = 1 // unit = meter

  const typeAndData = new Uint8Array(4 + 9)
  typeAndData[0] = 0x70 // 'p'
  typeAndData[1] = 0x48 // 'H'
  typeAndData[2] = 0x59 // 'Y'
  typeAndData[3] = 0x73 // 's'
  typeAndData.set(chunkData, 4)

  const crc = crc32(typeAndData)

  const chunk = new Uint8Array(4 + 4 + 9 + 4)
  const cdv = new DataView(chunk.buffer)
  cdv.setUint32(0, 9, false)         // length
  chunk.set(typeAndData, 4)          // type + data
  cdv.setUint32(4 + 4 + 9, crc, false) // crc

  // Cola: [PNG bytes ate insertAt] + [pHYs chunk] + [PNG bytes apos insertAt]
  const out = new Uint8Array(pngBytes.length + chunk.length)
  out.set(pngBytes.subarray(0, insertAt), 0)
  out.set(chunk, insertAt)
  out.set(pngBytes.subarray(insertAt), insertAt + chunk.length)
  return out
}

/** CRC32 (polynomio PNG/zlib). Usado pra chunk pHYs. */
const _crc32Table = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = (_crc32Table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Injeta DPI no header APP0/JFIF do JPG. O Canvas API gera JPG com JFIF
 * default em 72 dpi — vamos sobrescrever pro DPI da peca.
 *
 * Estrutura JPG: SOI(FFD8) + APP0 (FFE0 ... JFIF\0 ... density)
 * O APP0 esta sempre logo apos SOI nos JPGs do Canvas. Tamanho: 18 bytes total.
 * Offset do density unit dentro do APP0:
 *   - 0: marker (FFE0)
 *   - 2: length (2 bytes)
 *   - 4: "JFIF\0" (5 bytes)
 *   - 9: version major (1 byte)
 *   - 10: version minor (1 byte)
 *   - 11: density units (1 byte) - 1=DPI, 2=DPcm
 *   - 12: x density (2 bytes BE)
 *   - 14: y density (2 bytes BE)
 */
function injectJpgDpi(jpgBytes: Uint8Array, dpi: number): Uint8Array {
  const out = new Uint8Array(jpgBytes)
  // Procura APP0 logo apos SOI (offset 2-3 deve ser 0xFFE0)
  if (out[0] !== 0xFF || out[1] !== 0xD8) return out
  if (out[2] !== 0xFF || out[3] !== 0xE0) return out
  // Verifica "JFIF\0" em offset 6-10
  if (out[6] !== 0x4A || out[7] !== 0x46 || out[8] !== 0x49 || out[9] !== 0x46 || out[10] !== 0x00) return out
  out[13] = 1                    // density units = DPI
  out[14] = (dpi >> 8) & 0xff    // x density high
  out[15] = dpi & 0xff           // x density low
  out[16] = (dpi >> 8) & 0xff    // y density high
  out[17] = dpi & 0xff           // y density low
  return out
}

export async function exportPNGBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const { canvas, dpi } = await renderToCanvas(piece)
  const rawBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob PNG falhou")), "image/png")
  })
  // Injeta DPI no chunk pHYs do PNG. Canvas API nao define DPI por padrao.
  const bytes = new Uint8Array(await rawBlob.arrayBuffer())
  const withDpi = injectPngDpi(bytes, dpi)
  return new Blob([withDpi.buffer as ArrayBuffer], { type: "image/png" })
}

export async function exportJPGBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const { canvas, dpi } = await renderToCanvas(piece)
  const rawBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob JPG falhou")), "image/jpeg", 0.92)
  })
  // Sobrescreve density no header JFIF do JPG. Canvas API usa 72 dpi por padrao.
  const bytes = new Uint8Array(await rawBlob.arrayBuffer())
  const withDpi = injectJpgDpi(bytes, dpi)
  return new Blob([withDpi.buffer as ArrayBuffer], { type: "image/jpeg" })
}

export async function exportPDFBlob(piece: { id?: string; name: string; data: any; width: number; height: number }): Promise<Blob> {
  const { canvas: c, dpi } = await renderToCanvas(piece)
  const jpegDataUrl = c.toDataURL("image/jpeg", 0.92)
  const jpegBase64 = jpegDataUrl.split(",")[1]
  const jpegBytes = atob(jpegBase64)
  const jpegBuf = new Uint8Array(jpegBytes.length)
  for (let i = 0; i < jpegBytes.length; i++) jpegBuf[i] = jpegBytes.charCodeAt(i)

  // PDF MediaBox e' em PONTOS (1 inch = 72 pt). Pra que o PDF abra com o
  // tamanho fisico correto, converte W/H (px) pra pt: pt = px * 72 / dpi.
  // Se dpi=300 e img=3000x3000 px, o PDF fica 720x720 pt (= 10 inch = 25.4 cm),
  // que e o tamanho fisico real do desenho.
  const Wpx = c.width, Hpx = c.height
  const Wpt = Math.round((Wpx * 72) / dpi * 1000) / 1000
  const Hpt = Math.round((Hpx * 72) / dpi * 1000) / 1000
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
  // MediaBox em PONTOS (1/72 inch). PDF mostra o documento no tamanho fisico
  // correto baseado no dpi da peca. Imagem fica nos pixels originais (Wpx/Hpx),
  // mas escalada pra Wpt/Hpt pontos via matriz 'cm'.
  startObj(3); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Wpt} ${Hpt}] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>`); endObj()
  startObj(4)
  push(`<< /Type /XObject /Subtype /Image /Width ${Wpx} /Height ${Hpx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBuf.length} >>\nstream\n`)
  push(jpegBuf)
  push("\nendstream")
  endObj()
  // Matriz 'cm' escala a imagem (1x1 unit no espaco do XObject) pra Wpt x Hpt no MediaBox.
  const content = `q\n${Wpt} 0 0 ${Hpt} 0 0 cm\n/Im0 Do\nQ\n`
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
  // Google Fonts comuns no ZZOSY — convencao padrao `{FamilyNoSpaces}-Regular`
  // / `{FamilyNoSpaces}-Bold`. Esses sao os nomes que PS usa quando a fonte
  // esta instalada localmente (via Google Fonts desktop ou similar).
  "Caveat":          { regular: "Caveat-Regular",          bold: "Caveat-Bold" },
  "Pacifico":        { regular: "Pacifico-Regular" },
  "Dancing Script":  { regular: "DancingScript-Regular",   bold: "DancingScript-Bold" },
  "Kalam":           { regular: "Kalam-Regular",           bold: "Kalam-Bold" },
  "Roboto":          { regular: "Roboto-Regular",          bold: "Roboto-Bold" },
  "Open Sans":       { regular: "OpenSans-Regular",        bold: "OpenSans-Bold" },
  "Inter":           { regular: "Inter-Regular",           bold: "Inter-Bold" },
  "Lato":            { regular: "Lato-Regular",            bold: "Lato-Bold" },
  "Montserrat":      { regular: "Montserrat-Regular",      bold: "Montserrat-Bold" },
  "Poppins":         { regular: "Poppins-Regular",         bold: "Poppins-Bold" },
  "Nunito":          { regular: "Nunito-Regular",          bold: "Nunito-Bold" },
  "Manrope":         { regular: "Manrope-Regular",         bold: "Manrope-Bold" },
  "Work Sans":       { regular: "WorkSans-Regular",        bold: "WorkSans-Bold" },
  "DM Sans":         { regular: "DMSans-Regular",          bold: "DMSans-Bold" },
  "Exo 2":           { regular: "Exo2-Regular",            bold: "Exo2-Bold" },
  "Playfair Display":{ regular: "PlayfairDisplay-Regular", bold: "PlayfairDisplay-Bold" },
  "Merriweather":    { regular: "Merriweather-Regular",    bold: "Merriweather-Bold" },
  "Source Sans 3":   { regular: "SourceSans3-Regular",     bold: "SourceSans3-Bold" },
  "Source Serif 4":  { regular: "SourceSerif4-Regular",    bold: "SourceSerif4-Bold" },
  "Oswald":          { regular: "Oswald-Regular",          bold: "Oswald-Bold" },
  "Bebas Neue":      { regular: "BebasNeue-Regular" },
  "Anton":           { regular: "Anton-Regular" },
  "Archivo Black":   { regular: "ArchivoBlack-Regular" },
  "Abril Fatface":   { regular: "AbrilFatface-Regular" },
  "JetBrains Mono":  { regular: "JetBrainsMono-Regular",   bold: "JetBrainsMono-Bold" },
  "Fira Code":       { regular: "FiraCode-Regular",        bold: "FiraCode-Bold" },
  "IBM Plex Mono":   { regular: "IBMPlexMono-Regular",     bold: "IBMPlexMono-Bold" },
  "Roboto Mono":     { regular: "RobotoMono-Regular",      bold: "RobotoMono-Bold" },
}

function toPSFont(family: string, isBold: boolean): { name: string; fauxBold: boolean } {
  // 1. Tenta buscar postscriptName real via Local Font Access API (carregado quando
  //    a fonte foi aplicada no editor). Funciona pra QUALQUER fonte instalada no
  //    sistema do usuario — Exo 2, Sicredi Sans, etc — sem precisar mapa hardcoded.
  try {
    const ps = getPostScriptName(family)
    if (ps) return { name: ps, fauxBold: false }
  } catch { /* ignore */ }

  // 2. Mapa de fontes conhecidas (sistema + Google Fonts comuns).
  const f = PS_FONTS[family]
  if (f) {
    if (isBold && f.bold) return { name: f.bold, fauxBold: false }
    if (isBold && !f.bold) return { name: f.regular, fauxBold: true }
    return { name: f.regular, fauxBold: false }
  }

  // 3. Fallback genérico pra Google Fonts ou famílias não-mapeadas: usa a
  //    convenção comum `{FamilyNoSpaces}-Regular` / `{FamilyNoSpaces}-Bold`.
  //    PS vai procurar por esse PostScript name; se a fonte estiver instalada
  //    localmente vai casar; se nao, PS substitui pelo default (Myriad Pro).
  //    Antes esse fallback retornava `family` cru (com espaços), que PS nem
  //    sequer reconhecia como PostScript name e ja caia direto no Myriad Pro.
  const compact = family.replace(/\s+/g, "")
  return { name: `${compact}-${isBold ? "Bold" : "Regular"}`, fauxBold: false }
}

// Converte charSpacing do Fabric (1/1000 em — mesmo valor que letter-spacing CSS em em*1000?)
// pra tracking do Photoshop (1/1000 em). Fabric usa 1/1000 em diretamente:
// charSpacing 1000 = 1em de espaço extra. Photoshop tracking idem. Sem conversão.
function fabricCharSpacingToPsTracking(cs: number | undefined): number {
  if (cs === undefined || cs === null) return 0
  return Math.round(cs)
}

function buildStyleRuns(textbox: any, fullText: string, scale: number = 1): any[] {
  // IMPORTANTE: textbox.styles eh keyed pelo TEXTO CRU (obj.text), nao pelo
  // texto wrappeado pelo Fabric. Mas fullText aqui pode ser wrapped (com \n
  // adicionais inseridos pelo wrap). Iterando fullText com (lineNum, col) leria
  // styles[lineNumWrapped][colWrapped] que nao existem — fallback pro default
  // do textbox e cor/fonte per-char some.
  // Solucao: pra cada char nao-\n do fullText, pegamos o estilo do char
  // CORRESPONDENTE no rawText (mantendo um cursor rawIdx). \n adicionais do
  // wrap simplesmente repetem o estilo anterior (nao avancam rawIdx).
  const rawText: string = textbox.text ?? ""
  const styles = textbox.styles ?? {}

  function styleAtRawIndex(globalIdx: number): any {
    let line = 0, col = 0
    for (let i = 0; i < globalIdx && i < rawText.length; i++) {
      if (rawText[i] === "\n") { line++; col = 0 } else col++
    }
    return styles[line]?.[col] ?? null
  }

  const runs: any[] = []
  let prevStyleKey = ""
  let runStyle: any = null
  let runLength = 0
  let rawIdx = 0

  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i]
    let cs: any = null
    if (ch !== "\n") {
      // Char comum: avanca rawIdx e usa estilo do char correspondente
      cs = styleAtRawIndex(rawIdx)
      rawIdx++
    } else if (rawText[rawIdx] === "\n") {
      // \n real do rawText: avanca e usa estilo do \n
      cs = styleAtRawIndex(rawIdx)
      rawIdx++
    } else {
      // \n adicional inserido pelo auto-wrap do Fabric. Esse \n SUBSTITUI um
      // espaco no rawText (Fabric quebra entre palavras). Pra manter sincronia,
      // consumimos o espaco correspondente do rawText e usamos o estilo dele.
      // Se rawText[rawIdx] nao for um espaco (raro), so mantem estilo anterior.
      if (rawText[rawIdx] === " ") {
        cs = styleAtRawIndex(rawIdx)
        rawIdx++
      }
    }
    // Se cs ainda eh null (= \n adicional do wrap), mantem estilo anterior.
    const fill = cs?.fill ?? textbox.fill ?? "#000000"
    const fontSize = (cs?.fontSize ?? textbox.fontSize ?? 48) * scale
    const fontFamily = cs?.fontFamily ?? textbox.fontFamily ?? "Arial"
    const fontWeight = cs?.fontWeight ?? textbox.fontWeight ?? "normal"
    // Per-char italic: antes so o defaultStyle saia com fauxItalic; chars
    // marcados como italico individualmente perdiam o estilo no PSD. Reader
    // ja le `fauxItalic` per-run em mapCharStylePartial.
    const fontStyle = cs?.fontStyle ?? (textbox as any).fontStyle ?? "normal"
    // Baseline shift per-char: Fabric deltaY (positive=down) → PSD baselineShift
    // (positive=up). Sinal invertido. Sem isso, chars elevados via subscript/
    // superscript no editor voltariam invertidos no PSD.
    const deltaY = typeof cs?.deltaY === "number" ? cs.deltaY : 0
    const baselineShift = deltaY !== 0 ? -deltaY / scale : 0
    const styleKey = `${fill}|${fontSize}|${fontFamily}|${fontWeight}|${fontStyle}|${baselineShift}`
    if (styleKey !== prevStyleKey) {
      if (runLength > 0 && runStyle) runs.push({ length: runLength, style: runStyle })
      const isBold = (fontWeight === "bold" || fontWeight === 700)
      const ps = toPSFont(fontFamily, isBold)
      const isItalic = fontStyle === "italic"
      // Leading em px: usa leadingPt explicito da peca/matriz se setado,
      // senao deriva de lineHeight*fontSize. Sem isso, Photoshop usa leading
      // default da fonte (que pode ser muito diferente do que o user ve).
      const objLeadingPt = (textbox as any).leadingPt
      const lineH = textbox.lineHeight ?? 1.0
      const leading = Math.round(
        (objLeadingPt !== undefined && objLeadingPt !== null)
          ? objLeadingPt * scale
          : fontSize * lineH
      )
      const tracking = fabricCharSpacingToPsTracking(textbox.charSpacing)
      runStyle = {
        font: { name: ps.name },
        fontSize: Math.round(fontSize),
        fillColor: parseColor(fill),
        fauxBold: ps.fauxBold,
        fauxItalic: isItalic,
        autoLeading: false,
        leading,
        tracking,
        ...(baselineShift !== 0 ? { baselineShift } : {}),
        autoKerning: true,
      }
      prevStyleKey = styleKey
      runLength = 1
    } else {
      runLength++
    }
  }
  if (runLength > 0 && runStyle) runs.push({ length: runLength, style: runStyle })
  return runs
}

// Wrapper que mantem a mesma logica de fetch piece+assets que o legacy.
// Sem ela, cada caller precisaria duplicar o "se id=kv-* busca da campanha,
// senao busca da peca" — vital pro KV pseudo-piece e steps virtuais.
async function exportPSDBlobV2Wrapper(pieceLite: { id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }): Promise<Blob> {
  const { exportPiecePsdV2 } = await import("@/lib/psd/exportPiecePsd")
  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    if (pieceLite.id.startsWith("kv-")) {
      const campaignId = pieceLite.id.slice(3)
      const r = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (r.ok) {
        const camp = await r.json()
        if (Array.isArray(camp.assets)) assets = camp.assets.map(normalizeAsset)
      }
    } else if (pieceLite.__virtualStepOriginalId) {
      const r = await fetch(`/api/pieces/${pieceLite.id}`, { cache: "no-store" })
      if (r.ok) {
        const p = await r.json()
        const cres = await fetch(`/api/campaigns/${p.campaignId}`, { cache: "no-store" })
        if (cres.ok) {
          const camp = await cres.json()
          if (Array.isArray(camp.assets)) assets = camp.assets.map(normalizeAsset)
        }
      }
    } else {
      const fetched = await fetchPieceWithAssets(pieceLite.id)
      piece = fetched.piece
      assets = fetched.assets
    }
  }
  const result = await exportPiecePsdV2({ piece, assets })
  if (result.warnings.length > 0) {
    console.log(`[psd-export-v2] ${result.warnings.length} warnings, ${(result.byteLength / 1024).toFixed(1)}KB PSD gerado`)
    for (const w of result.warnings.slice(0, 5)) console.warn(`  [${w.kind}] ${w.layerName}: ${w.message}`)
  }
  return result.blob
}

export async function exportPSDBlob(pieceLite: { id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }): Promise<Blob> {
  // Fase 8: opt-in pro export v2 (fromEditor + writer da nova arquitetura PSD).
  // Default ainda eh legacy ate dogfooding completo. Forca v2 via:
  //   localStorage["zzosy:psdExport"] = "v2"
  // Quando v2 estabilizar, vira default e o codigo legacy abaixo eh removido.
  const useV2 = typeof localStorage !== "undefined" && localStorage.getItem("zzosy:psdExport") === "v2"
  if (useV2) {
    try {
      return await exportPSDBlobV2Wrapper(pieceLite)
    } catch (e: any) {
      console.warn("[psd-export-v2] falhou, caindo no legacy:", e?.message ?? e)
      // Cai no caminho legacy abaixo
    }
  }

  let piece: any = pieceLite
  let assets: Asset[] = []
  if (pieceLite.id) {
    // Pseudo-piece "kv-{campaignId}" eh exportacao do Key Vision direto do editor
    // (nao corresponde a uma piece no banco). Busca apenas os assets da campanha.
    if (pieceLite.id.startsWith("kv-")) {
      const campaignId = pieceLite.id.slice(3)
      const r = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" })
      if (r.ok) {
        const camp = await r.json()
        if (Array.isArray(camp.assets)) {
          assets = camp.assets.map(normalizeAsset)
        }
      }
      // piece ja eh o pieceLite com data preenchido (vem do editor)
    } else if (pieceLite.__virtualStepOriginalId) {
      // Peca virtual de step: busca SO os assets. Mantem data como veio.
      const r = await fetch(`/api/pieces/${pieceLite.id}`, { cache: "no-store" })
      if (r.ok) {
        const p = await r.json()
        const cres = await fetch(`/api/campaigns/${p.campaignId}`, { cache: "no-store" })
        if (cres.ok) {
          const camp = await cres.json()
          if (Array.isArray(camp.assets)) assets = camp.assets.map(normalizeAsset)
        }
      }
    } else {
      const fetched = await fetchPieceWithAssets(pieceLite.id)
      piece = fetched.piece
      assets = fetched.assets
    }
  }
  const fc = await buildPieceCanvas(piece, assets)
  const data = typeof piece.data === "string" ? JSON.parse(piece.data) : piece.data
  const W = data?.width ?? pieceLite.width
  const H = data?.height ?? pieceLite.height
  // DPI da peca (salvo no momento da geracao a partir do MediaFormat). Default 72.
  const dpi = Math.round(Number(data?.dpi)) || 72

  const objects = fc.getObjects()
  const agpsd = await import("ag-psd") as any

  const psdLayers: any[] = []

  // === SMART OBJECT INFRA ===
  // Mapa pra lookup rapido do asset original pelo __assetId do Fabric object
  const assetById = new Map<string, Asset>()
  for (const a of assets) assetById.set(a.id, a)

  // linkedFiles vai pro psd.linkedFiles. Cada SVG embeddado aparece aqui uma vez (cache por assetId)
  // pra que o mesmo SVG usado em multiplas pecas/layers nao duplique conteudo.
  const linkedFiles: any[] = []
  const linkedByAssetId = new Map<string, string>() // assetId -> linkedFile.id (GUID)

  // GUID v4 simples (suficiente pro PSD; nao precisa ser cripto-forte)
  function makeGuid(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === "x" ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  // Embedda um arquivo "linkado" (Smart Object) no PSD, retornando GUID + dimensoes.
  // Prioridades:
  // 1. Se o asset tem smartObject (preservado de um import), usa os bytes ORIGINAIS
  //    e o GUID ORIGINAL — round-trip sem perda. Photoshop reconhece como o mesmo SO.
  // 2. Se nao tem mas tem imageUrl com .svg, baixa o SVG do servidor e cria SO novo
  //    com GUID v4 gerado.
  // 3. Caso contrario retorna null (asset rasteriza normal, sem virar SO).
  const linkedDimsByAssetId = new Map<string, { w: number; h: number }>()
  async function ensureLinkedSmartObject(asset: Asset): Promise<{ guid: string; w: number; h: number } | null> {
    const cached = linkedByAssetId.get(asset.id)
    if (cached) {
      const dims = linkedDimsByAssetId.get(asset.id)
      if (dims) return { guid: cached, w: dims.w, h: dims.h }
    }

    // CAMINHO 1: smart object preservado de import — usa bytes originais
    if (asset.smartObject) {
      try {
        const so = asset.smartObject
        const res = await fetch(so.filePath)
        if (!res.ok) throw new Error(`fetch smart object falhou: ${res.status}`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        // Dimensoes: prioridade ao que foi salvo no DB; senao tenta extrair de SVG
        let w = so.width ?? 0
        let h = so.height ?? 0
        if ((!w || !h) && so.mime === "image/svg+xml") {
          try {
            const txt = new TextDecoder().decode(bytes)
            const vb = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
            if (vb) {
              const parts = vb.split(/[\s,]+/).map(Number)
              if (parts.length === 4 && parts.every(Number.isFinite)) {
                w = w || parts[2]; h = h || parts[3]
              }
            }
          } catch { /* ignora */ }
        }
        if (!w || !h) { w = 512; h = 512 } // fallback safe
        linkedFiles.push({
          id: so.guid, // GUID ORIGINAL — preserva identidade do SO
          name: so.originalName,
          data: bytes,
        })
        linkedByAssetId.set(asset.id, so.guid)
        linkedDimsByAssetId.set(asset.id, { w, h })
        console.log("[PSD-SMART:preserved]", { asset: asset.label, guid: so.guid, mime: so.mime, w, h })
        return { guid: so.guid, w, h }
      } catch (e) {
        console.warn("[PSD] falha lendo smart object preservado, caira no fallback SVG:", asset.id, e)
        // cai no caminho 2 abaixo
      }
    }

    // CAMINHO 2: SVG comum via imageUrl
    if (!asset.imageUrl) return null
    if (!/\.svg(\?|$)/i.test(asset.imageUrl)) return null
    try {
      const res = await fetch(asset.imageUrl)
      if (!res.ok) return null
      const svgText = await res.text()
      let w = 0, h = 0
      const viewBox = svgText.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
      if (viewBox) {
        const parts = viewBox.split(/[\s,]+/).map(Number)
        if (parts.length === 4 && parts.every(Number.isFinite)) {
          w = parts[2]; h = parts[3]
        }
      }
      if (!w || !h) {
        const wAttr = parseFloat(svgText.match(/<svg[^>]*\swidth\s*=\s*["']([^"']+)["']/i)?.[1] ?? "")
        const hAttr = parseFloat(svgText.match(/<svg[^>]*\sheight\s*=\s*["']([^"']+)["']/i)?.[1] ?? "")
        if (Number.isFinite(wAttr) && wAttr > 0) w = wAttr
        if (Number.isFinite(hAttr) && hAttr > 0) h = hAttr
      }
      if (!w || !h) {
        console.warn("[PSD] SVG sem dimensoes detectaveis, fallback 512x512:", asset.id)
        w = 512; h = 512
      }
      const svgBytes = new TextEncoder().encode(svgText)
      const guid = makeGuid()
      const fname = `${(asset.label || "asset").replace(/[^\w.-]+/g, "_")}.svg`
      linkedFiles.push({ id: guid, name: fname, data: svgBytes })
      linkedByAssetId.set(asset.id, guid)
      linkedDimsByAssetId.set(asset.id, { w, h })
      return { guid, w, h }
    } catch (e) {
      console.warn("[PSD] falha embeddando SVG do asset:", asset.id, e)
      return null
    }
  }

  // BACKGROUND: cada bgLayer vira uma LAYER NATIVA do Photoshop em vez de
  // ser rasterizado num canvas único.
  //  - kind "solid"   → Solid Color Fill Layer (vectorFill type="color")
  //                     editavel no PS: duplo clique no thumb troca a cor.
  //  - kind "gradient"→ Gradient Fill Layer (vectorFill type="solid" com
  //                     colorStops) editavel no PS.
  //  - kind "image"   → fallback raster (Pattern Fill ainda nao mapeado).
  // Ordem: BG[0] no fundo → primeiro pushed; assets vem em seguida no topo.
  // Convencao ag-psd writer: ordem do push() = ordem visual (primeiro=fundo).
  const hexToPsdColor = hexToAgPsdRgbShared
  const bgLayersArr: any[] = bgLayersFromData(data)
  for (let i = 0; i < bgLayersArr.length; i++) {
    const bl = bgLayersArr[i]
    if (!bl || bl.hidden) continue
    const layerName = i === 0 ? "Background" : `Background ${i + 1}`
    // Opacity SEMPRE setada nos bg layers (mesmo 1.0 → 255) — diferente de
    // object layers onde fabricOpacityToPsd retorna undefined em opacity=1.
    // Bg layers sao Fill Layers (solid/gradient/pattern) e ag-psd precisa
    // do opacity byte explicito pra elas saiarem corretamente no PS.
    const opacityByte = Math.max(0, Math.min(255, Math.round((typeof bl.opacity === "number" ? bl.opacity : 1) * 255)))
    // BlendMode do bg layer (bgLayers tem `blendMode` no schema, em canvas
    // globalCompositeOperation format). Propaga via helper central pra
    // PSD nativo. undefined em "source-over" (default).
    const bgBlend = fabricBlendToPsd(bl.blendMode)
    if (bl.kind === "solid") {
      psdLayers.push({
        name: layerName,
        top: 0, left: 0, bottom: H, right: W,
        opacity: opacityByte,
        ...(bgBlend ? { blendMode: bgBlend } : {}),
        vectorFill: { type: "color", color: hexToPsdColor(bl.color) },
      })
    } else if (bl.kind === "gradient") {
      // Converte angle ZZOSY (0=L→R, 90=T→B) → PSD (0=cima, sentido horario)
      // Formula inversa do extractPsdBgLayer: psd = (zzosy + 180) mod 360
      const angleZ = typeof bl.angle === "number" ? bl.angle : 90
      const anglePsd = ((angleZ + 180) % 360 + 360) % 360
      const psStyle = bl.gradientType === "radial" ? "radial" : "linear"
      psdLayers.push({
        name: layerName,
        top: 0, left: 0, bottom: H, right: W,
        opacity: opacityByte,
        ...(bgBlend ? { blendMode: bgBlend } : {}),
        vectorFill: {
          type: "solid",
          name: "Custom",
          smoothness: 4096,
          colorStops: (bl.stops ?? []).map((s: any) => ({
            color: hexToPsdColor(s.color),
            location: Math.max(0, Math.min(1, s.offset ?? 0)),
            midpoint: 50,
          })),
          opacityStops: [
            { opacity: 100, location: 0, midpoint: 50 },
            { opacity: 100, location: 1, midpoint: 50 },
          ],
          style: psStyle,
          angle: anglePsd,
        },
      })
    } else if (bl.kind === "image") {
      // Raster fallback (V2: mapear pra Pattern Fill Layer nativo do PS)
      const bgCanvas = document.createElement("canvas")
      bgCanvas.width = W; bgCanvas.height = H
      const ctx = bgCanvas.getContext("2d")!
      await renderBgLayersOntoCanvas(ctx, [bl], W, H)
      psdLayers.push({
        name: layerName,
        top: 0, left: 0, bottom: H, right: W,
        opacity: opacityByte,
        ...(bgBlend ? { blendMode: bgBlend } : {}),
        canvas: bgCanvas,
      })
    }
  }

  for (const obj of objects) {
    if ((obj as any).__isBg) continue
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
    // Opacity/blendMode do Fabric → PSD nativo (round-trip completo).
    // Centralizados em `lib/psd/psdHelpers`. Defaults omitidos (undefined).
    const psdLayerOpacity = fabricOpacityToPsd(obj.opacity)
    const psdLayerBlend = fabricBlendToPsd(obj.globalCompositeOperation)
    // PSD layer effects round-trip completo. Converte schema ZZOSY → ag-psd.
    // Inclui: dropShadow, innerShadow, outerGlow, innerGlow, stroke,
    //         colorOverlay (solidFill), gradientOverlay, bevel, satin,
    //         patternOverlay (metadados).
    const psdLayerEffects = (() => {
      const fx = (obj as any).__psdEffects
      if (!fx) return undefined
      const out: any = {}
      // Inverso da extração: PSD angle (0=direita, +sentido horário) a partir
      // dos offsets (sombra cai oposta à luz). Defensivo se distance=0.
      const angleFromOffsets = (dx: number, dy: number, fallback: number) => {
        const d = Math.hypot(dx, dy)
        return d > 0 ? (Math.atan2(dy, -dx) * 180 / Math.PI) : fallback
      }
      // ag-psd UnitsValue helper — distance/size/etc precisam vir como
      // {value, units} object. Centralizado em `lib/psd/psdHelpers.psdPx`.
      const px = psdPx
      if (fx.dropShadow) {
        const d = fx.dropShadow
        const dx = d.offsetX ?? 0, dy = d.offsetY ?? 0
        out.dropShadow = [{
          enabled: true,
          color: hexToPsdColor(d.color ?? "#000000"),
          opacity: d.opacity ?? 0.75,
          angle: angleFromOffsets(dx, dy, 120),
          distance: px(Math.round(Math.hypot(dx, dy))),
          size: px(d.blur ?? 5),
          blendMode: normalizeBlendModeForAgPsd(d.blendMode, "multiply"),
          useGlobalLight: false,
        }]
      }
      if (fx.innerShadow) {
        const i = fx.innerShadow
        const dx = i.offsetX ?? 0, dy = i.offsetY ?? 0
        out.innerShadow = [{
          enabled: true,
          color: hexToPsdColor(i.color ?? "#000000"),
          opacity: i.opacity ?? 0.75,
          angle: angleFromOffsets(dx, dy, 120),
          distance: px(Math.round(Math.hypot(dx, dy))),
          size: px(i.blur ?? 5),
          choke: px(i.choke ?? 0),
          blendMode: normalizeBlendModeForAgPsd(i.blendMode, "multiply"),
          useGlobalLight: false,
        }]
      }
      if (fx.outerGlow) {
        out.outerGlow = {
          enabled: true,
          color: hexToPsdColor(fx.outerGlow.color ?? "#ffffff"),
          opacity: fx.outerGlow.opacity ?? 0.5,
          size: px(fx.outerGlow.blur ?? 5),
          choke: px(fx.outerGlow.choke ?? 0),
          blendMode: normalizeBlendModeForAgPsd(fx.outerGlow.blendMode, "screen"),
        }
      }
      if (fx.innerGlow) {
        out.innerGlow = {
          enabled: true,
          color: hexToPsdColor(fx.innerGlow.color ?? "#ffffff"),
          opacity: fx.innerGlow.opacity ?? 0.5,
          size: px(fx.innerGlow.blur ?? 5),
          choke: px(fx.innerGlow.choke ?? 0),
          source: fx.innerGlow.source ?? "edge",
          blendMode: normalizeBlendModeForAgPsd(fx.innerGlow.blendMode, "screen"),
        }
      }
      if (fx.stroke) {
        out.stroke = [{
          enabled: true,
          position: fx.stroke.position ?? "outside",
          fillColor: { color: hexToPsdColor(fx.stroke.color ?? "#000000") },
          size: px(fx.stroke.width ?? 1),
          opacity: fx.stroke.opacity ?? 1,
          blendMode: normalizeBlendModeForAgPsd(fx.stroke.blendMode, "normal"),
        }]
      }
      if (fx.colorOverlay) {
        out.solidFill = [{
          enabled: true,
          color: hexToPsdColor(fx.colorOverlay.color ?? "#000000"),
          opacity: fx.colorOverlay.opacity ?? 1,
          blendMode: normalizeBlendModeForAgPsd(fx.colorOverlay.blendMode, "normal"),
        }]
      }
      if (fx.gradientOverlay && Array.isArray(fx.gradientOverlay.stops)) {
        const go = fx.gradientOverlay
        out.gradientOverlay = [{
          enabled: true,
          opacity: go.opacity ?? 1,
          blendMode: normalizeBlendModeForAgPsd(go.blendMode, "normal"),
          type: go.type ?? "linear",
          angle: go.angle ?? 90,
          scale: go.scale ?? 100,
          reverse: go.reverse === true,
          align: go.align !== false,
          gradient: {
            name: "Custom",
            type: "solid" as const,
            smoothness: 4096,
            colorStops: go.stops.map((s: any) => ({
              color: hexToPsdColor(s.color ?? "#000000"),
              location: s.offset ?? 0,
              midpoint: 50,
            })),
            opacityStops: (Array.isArray(go.opacityStops) && go.opacityStops.length > 0
              ? go.opacityStops
              : [{ opacity: 1, offset: 0 }, { opacity: 1, offset: 1 }]
            ).map((s: any) => ({
              opacity: (s.opacity ?? 1) * 100,
              location: s.offset ?? 0,
              midpoint: 50,
            })),
          },
        }]
      }
      if (fx.bevel) {
        const b = fx.bevel
        out.bevel = {
          enabled: true,
          style: b.style ?? "inner bevel",
          direction: b.direction ?? "up",
          size: px(b.size ?? 5),
          angle: b.angle ?? 120,
          altitude: b.altitude ?? 30,
          highlightColor: hexToPsdColor(b.highlightColor ?? "#ffffff"),
          highlightOpacity: b.highlightOpacity ?? 0.75,
          highlightBlendMode: normalizeBlendModeForAgPsd(b.highlightBlendMode, "screen"),
          shadowColor: hexToPsdColor(b.shadowColor ?? "#000000"),
          shadowOpacity: b.shadowOpacity ?? 0.75,
          shadowBlendMode: normalizeBlendModeForAgPsd(b.shadowBlendMode, "multiply"),
          strength: b.strength ?? 100,
          soften: px(b.soften ?? 0),
          useGlobalLight: false,
        }
      }
      if (fx.satin) {
        out.satin = {
          enabled: true,
          color: hexToPsdColor(fx.satin.color ?? "#000000"),
          opacity: fx.satin.opacity ?? 0.5,
          angle: fx.satin.angle ?? 19,
          distance: px(fx.satin.distance ?? 11),
          size: px(fx.satin.size ?? 14),
          invert: fx.satin.invert === true,
          blendMode: normalizeBlendModeForAgPsd(fx.satin.blendMode, "multiply"),
        }
      }
      // patternOverlay omitido — não preservamos pattern bytes (precisaria mapeio
      // dedicado). Round-trip parcial: designer re-aplica no Photoshop.
      return Object.keys(out).length > 0 ? out : undefined
    })()

    if (obj.type === "textbox" || obj.type === "i-text" || obj.type === "text") {
      try {
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
      const isItalic = (obj as any).fontStyle === "italic"
      const ps = toPSFont(obj.fontFamily ?? "Arial", isBold)
      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const lctx = layerCanvas.getContext("2d")! // alpha:true (transparente)
      try {
        const rendered = obj.toCanvasElement({ multiplier: 1 })
        lctx.drawImage(rendered, 0, 0, w, h)
      } catch (e) { console.warn("rasterize text fail:", name, e) }
      // Alinhamento real do textbox (Photoshop nao suporta "justify" no
      // paragraphStyle, fallback pra left). Hoje hardcoded "left" — bug.
      const psJust: "left" | "center" | "right" =
        obj.textAlign === "center" ? "center" :
        obj.textAlign === "right" ? "right" :
        "left"
      // Leading do default style (mesma logica que em buildStyleRuns).
      const defLeadingPt = (obj as any).leadingPt
      const defLineH = obj.lineHeight ?? 1.0
      const defLeading = Math.round(
        (defLeadingPt !== undefined && defLeadingPt !== null)
          ? defLeadingPt * sY
          : fontSize * defLineH
      )
      const defTracking = fabricCharSpacingToPsTracking(obj.charSpacing)
      // nameSource preservado do PSD original quando importado (ex: 'lyr ' =
      // nome manual). Sem __psdNameSource, default 'srct' = PS auto-renomeia
      // o layer ao editar o texto (padrao Adobe). Ver project_psd_lnsr_namesource.
      const textNameSource = (obj as any).__psdNameSource ?? "srct"
      psdLayers.push({
        name,
        nameSource: textNameSource,
        top, left, bottom, right,
        canvas: layerCanvas,
        ...commonAgPsdLayerFields(obj, psdLayerOpacity, psdLayerBlend, psdLayerEffects),
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
            fauxItalic: isItalic,
            // Sem esses campos, Photoshop usa leading metric default da fonte
            // e tracking 0 — texto sai com entrelinha grande e sem char spacing.
            autoLeading: false,
            leading: defLeading,
            tracking: defTracking,
            autoKerning: true,
          },
          styleRuns,
          paragraphStyle: { justification: psJust },
        },
      })
      } catch (errText) {
        // CRITICO: se algo na branch text deu throw, o console.log [PSD-TEXT-EXPORT] nao roda
        // e o layer nao eh adicionado ao PSD. Antes esse erro era engolido silenciosamente.
        // Agora logamos pra debug.
        console.error("[PSD-TEXT-CRASH]", {
          name: (obj as any).__assetLabel ?? "?",
          text: (obj as any).text?.substring?.(0, 60),
          error: errText,
          stack: (errText as any)?.stack,
        })
      }
    } else if ((obj as any).__isShape === true || obj.type === "path" || obj.type === "Path") {
      // === SHAPE: exporta como Shape Layer NATIVO do PS ===
      try {
        const assetIdSh = (obj as any).__assetId as string | undefined
        const assetSh = assetIdSh ? assetById.get(assetIdSh) : undefined
        const shape = parseShapeContent(assetSh?.content)
        // Pra shapes parametric: REBUILD o path SVG a partir do estado vivo
        // (obj.__pathBbox + obj.__cornerRadius) — os dims ja sao absolutos
        // pos-bake do scale em buildPieceCanvas. Sem isso, o export usaria
        // o path cru do asset.content (400px) e ignoraria a scale aplicada
        // pelo user (e.g., shape resizado a 2x → PSD saia 2x menor).
        const shapeKindEarly = (obj as any).__shapeKind as ("rectangle"|"roundedRect"|"ellipse"|undefined)
        const objBbox = (obj as any).__pathBbox
        let pathSvg: string = shape?.path ?? ""
        let pathBboxLeft = shape?.pathBbox?.left ?? left
        let pathBboxTop = shape?.pathBbox?.top ?? top
        if (shapeKindEarly && objBbox) {
          const bbW = (objBbox.right ?? 0) - (objBbox.left ?? 0)
          const bbH = (objBbox.bottom ?? 0) - (objBbox.top ?? 0)
          const cornerR = (obj as any).__cornerRadius ?? 0
          if (bbW > 0 && bbH > 0) {
            const { buildShapePath } = await import("@/lib/shapePaths")
            pathSvg = buildShapePath(shapeKindEarly, bbW, bbH, cornerR)
            pathBboxLeft = 0
            pathBboxTop = 0
          }
        }
        const objAngle = obj.angle ?? 0
        const objScaleX = obj.scaleX ?? 1
        const objScaleY = obj.scaleY ?? 1
        const knots = Math.abs(objAngle) < 0.01
          ? svgPathToAgPsdKnots(pathSvg, pathBboxLeft, pathBboxTop, ox, oy, objScaleX, objScaleY)
          : null
        if (knots && knots.length > 0) {
          // Estado VIVO do Fabric.Path (com edicoes do user via painel).
          const fillStr: string = typeof obj.fill === "string" ? obj.fill : ""
          const strokeStr: string = typeof obj.stroke === "string" ? obj.stroke : ""
          const strokeW: number = obj.strokeWidth ?? 0
          const hasFill = !!fillStr
          const hasStroke = !!strokeStr && strokeW > 0

          // Limpa effects.stroke legacy de psdLayerEffects — agora usamos
          // vectorStroke NATIVO (Shape Layer real do PS) em vez de Layer Style.
          // User pediu explicitamente em 2026-05-22: "esta indo sem stroke
          // (indo como effects) e nao e isso". PS rendera nativamente via
          // vectorStroke + Properties Panel Shape.
          //
          // ag-psd v18: vectorFill + vectorStroke juntos sao escritos pelos
          // handlers vscg (combined descriptor) + vstk (stroke style). SoCo
          // eh skipped quando vectorStroke presente, mas vscg cobre o fill.
          // Pre-condicao critica: vectorStroke.fillEnabled=true — sem isso
          // PS ignora o vectorFill e renderiza so o stroke.
          let effectsForLayer: any = psdLayerEffects ? { ...psdLayerEffects } : undefined
          // Se tinha legacy effects.stroke do PSD import, remove pra nao
          // double-stroke com nosso vectorStroke novo.
          if (effectsForLayer?.stroke) {
            delete effectsForLayer.stroke
            if (Object.keys(effectsForLayer).length === 0) effectsForLayer = undefined
          }
          console.log("[shape-export]", name, {
            fill: fillStr, stroke: strokeStr, strokeW,
            hasFill, hasStroke,
          })

          const psdLayer: any = {
            name,
            top, left, bottom, right,
            ...commonAgPsdLayerFields(obj, psdLayerOpacity, psdLayerBlend, effectsForLayer),
            // "combine" = path puro (sem boolean ops). "subtract" subtrai do
            // composite e deixaria o shape invisivel.
            vectorMask: {
              paths: [{ operation: "combine", knots, open: false }],
            },
          }
          if (hasFill) {
            psdLayer.vectorFill = { type: "color", color: hexToAgPsdRgb(fillStr) }
          }
          // VECTOR STROKE NATIVO — Shape Layer real, editavel via Properties
          // Panel no PS (Stroke color + width + alignment). fillEnabled=hasFill
          // CRITICO: sem isso PS ignora o vectorFill e renderiza so contorno.
          if (hasStroke) {
            psdLayer.vectorStroke = {
              strokeEnabled: true,
              fillEnabled: hasFill,
              lineWidth: { value: strokeW, units: "Pixels" as const },
              lineDashOffset: { value: 0, units: "Pixels" as const },
              lineCapType: "butt" as const,
              lineJoinType: "miter" as const,
              lineAlignment: "center" as const,
              miterLimit: 100,
              strokeAdjust: false,
              scaleLock: false,
              blendMode: "normal" as const,
              opacity: extractAlpha(strokeStr),
              content: { type: "color" as const, color: hexToAgPsdRgb(strokeStr) },
              resolution: 72,
            }
          }
          // VECTOR ORIGINATION (vogk) — informa ao PS que este eh um Live Shape
          // parametric (Rectangle/Rounded Rectangle/Ellipse) em vez de path
          // generico. PS mostra os handles especiais (raio do canto, etc) e
          // preserva cornerRadius absoluto em scale. Sem isso, PS importa
          // como "Path" e perde a parametricidade.
          //
          // keyOriginType: 1=Rect, 2=RoundedRect, 4=Line, 5=Ellipse.
          // BBox em coords ABSOLUTAS do canvas (left/top/right/bottom da peca),
          // nao relativas ao path. Compativel com como o reader (psd/reader.ts
          // tryReadVogkPath) le esses campos.
          const shapeKind = (obj as any).__shapeKind as ("rectangle"|"roundedRect"|"ellipse"|undefined)
          const shapeBbox = (obj as any).__pathBbox
          if (shapeKind && shapeBbox) {
            // Coords absolutas: layer left/top sao o offset do path (0,0) no canvas.
            const absLeft = left
            const absTop = top
            const absRight = left + ((shapeBbox.right ?? 0) - (shapeBbox.left ?? 0))
            const absBottom = top + ((shapeBbox.bottom ?? 0) - (shapeBbox.top ?? 0))
            const keyType = shapeKind === "rectangle" ? 1
              : shapeKind === "roundedRect" ? 2
              : shapeKind === "ellipse" ? 5
              : 0
            if (keyType > 0) {
              // ag-psd unitsValue() REQUIRES `{value, units}` object — nao
              // aceita numero cru. Centralizado em `lib/psd/psdHelpers.psdPx`.
              const px = psdPx
              const item: any = {
                keyOriginType: keyType,
                keyOriginResolution: 72,
                keyOriginShapeBoundingBox: {
                  top: px(absTop), left: px(absLeft),
                  bottom: px(absBottom), right: px(absRight),
                },
              }
              if (keyType === 2) {
                // Rounded rect: 4 radii (mesmo valor em todos os cantos —
                // independente per-canto fica pra futuro).
                const r = (obj as any).__cornerRadius ?? 0
                item.keyOriginRRectRadii = {
                  topLeft: px(r), topRight: px(r), bottomLeft: px(r), bottomRight: px(r),
                }
              }
              psdLayer.vectorOrigination = { keyDescriptorList: [item] }
            }
          }
          // NOTA: NAO emitir vectorStroke aqui — quebra o vectorFill (SoCo guard).
          // Stroke vai via effects.stroke[] acima.
          psdLayers.push(psdLayer)
          continue
        }
        // Fallback: rasteriza (rotacao ou path bichado).
        console.warn("[shape-export] fallback raster (rotation/parse fail):", name)
      } catch (e) {
        console.warn("[shape-export] vector falhou, fallback raster:", name, e)
      }
      // Fall-through pro caminho de imagem rasterizada (else abaixo).
    }
    if (!(obj.type === "textbox" || obj.type === "i-text" || obj.type === "text")) {
      // === Imagem: detecta se eh Smart Object embeddavel ===
      // Eh SO se:
      //  (a) Fabric obj marcado como __isSmartObject (set no import preservando
      //      origem PSD) — failsafe: prevalece mesmo se asset.smartObject sumiu
      //      do DB por algum reload bug.
      //  (b) asset preserva smart object de import (caminho normal).
      //  (c) eh SVG via imageUrl (auto-embed pra SVGs adicionados ao asset).
      const assetId = (obj as any).__assetId as string | undefined
      const asset = assetId ? assetById.get(assetId) : undefined
      const isMarkedSmartObject = (obj as any).__isSmartObject === true
      const isSmartObjectCandidate = isMarkedSmartObject || (!!asset && (
        !!asset.smartObject ||
        (!!asset.imageUrl && /\.svg(\?|$)/i.test(asset.imageUrl))
      ))
      if (isMarkedSmartObject && !asset?.smartObject) {
        console.warn("[PSD-SMART:fallback] obj marcado __isSmartObject mas asset.smartObject ausente — tentando reconstruir via __smartObject* fields:", {
          name, guid: (obj as any).__smartObjectGuid, filePath: (obj as any).__smartObjectFilePath,
        })
      }

      // Sempre rasteriza pra usar como preview (Photoshop precisa do canvas mesmo
      // pra smart objects — eh o que ele mostra antes do double-click "abrir conteudo").
      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const lctx = layerCanvas.getContext("2d")! // alpha:true (transparente)
      try {
        const img = obj.toCanvasElement({ multiplier: 1 })
        lctx.drawImage(img, 0, 0, w, h)
      } catch (e) { console.warn("rasterize fail:", name, e) }

      if (isSmartObjectCandidate) {
        // SMART OBJECT EMBEDDED: vai como Smart Object no PSD.
        // Failsafe: se asset.smartObject sumiu mas Fabric obj tem __isSmartObject
        // com filePath, sintetiza um asset.smartObject temporario com base nas
        // __smartObject* fields preservadas. Cobre o caso "Smart Object virou
        // image raster apos reload" reportado pelo user em 2026-05-22.
        const so = asset?.smartObject ?? (isMarkedSmartObject && typeof (obj as any).__smartObjectFilePath === "string" ? {
          id: "synth",
          guid: (obj as any).__smartObjectGuid ?? makeGuid(),
          filePath: (obj as any).__smartObjectFilePath,
          mime: (obj as any).__smartObjectMime ?? "application/octet-stream",
          originalName: (obj as any).__smartObjectOriginalName ?? "smart-object",
          width: null,
          height: null,
        } : null)
        const syntheticAsset: Asset | null = asset ?? (so ? {
          id: (obj as any).__assetId ?? "synth",
          type: "IMAGE", label: name, value: null, imageUrl: null, content: null,
          smartObject: so,
        } : null)
        const linked = syntheticAsset ? await ensureLinkedSmartObject(syntheticAsset) : null
        if (linked) {
          // Os 4 cantos do retangulo onde a imagem esta posicionada (em pixels do PSD).
          const transform = [
            left, top,
            right, top,
            right, bottom,
            left, bottom,
          ]
          psdLayers.push({
            name,
            top, left, bottom, right,
            canvas: layerCanvas,
            ...commonAgPsdLayerFields(obj, psdLayerOpacity, psdLayerBlend, psdLayerEffects),
            placedLayer: {
              id: linked.guid,
              type: "raster",
              width: linked.w,   // ag-psd exige
              height: linked.h,  // ag-psd exige
              transform,
            },
          })
          console.log("[PSD-SMART]", {
            name,
            guid: linked.guid,
            svgW: linked.w, svgH: linked.h,
            psdBbox: { left, top, right, bottom, w, h },
            transform,
            objFabric: { left: obj.left, top: obj.top, scaleX: obj.scaleX, scaleY: obj.scaleY, w: obj.width, h: obj.height },
          })
          continue
        }
      }

      // Fallback: imagem raster comum (PNG/JPG ou SVG que nao deu pra embeddar)
      psdLayers.push({
        name, top, left, bottom, right, canvas: layerCanvas,
        ...commonAgPsdLayerFields(obj, psdLayerOpacity, psdLayerBlend, psdLayerEffects),
      })
    }
  }

  // === PROPAGA __hidden / __locked DO FABRIC PRO PSD ===
  // ag-psd suporta:
  //   hidden: true            -> camada oculta (igual olho fechado)
  //   transparencyProtected: true -> "Lock transparent pixels" do PS (mais
  //     proximo do nosso lock simples; ag-psd nao tem all-locks num campo)
  // Iteracao em paralelo: psdLayers[0] eh Background, psdLayers[1..] = objects[i].
  {
    let psdLayerIdx = 1
    for (const obj of objects) {
      if ((obj as any).__isBg) continue
      const psdLayer: any = psdLayers[psdLayerIdx]
      if (!psdLayer) { psdLayerIdx++; continue }
      if ((obj as any).__hidden === true) psdLayer.hidden = true
      if ((obj as any).__locked === true) psdLayer.transparencyProtected = true
      psdLayerIdx++
    }
  }

  // === APLICA MASCARAS (raster / vector / clipping) NOS LAYERS DO PSD ===
  // Percorre os objects do canvas (em mesma ordem dos psdLayers) e injeta a
  // mascara salva em __maskData no psdLayer correspondente. Background nao
  // tem mascara entao comeca em index 1 dos psdLayers (index 0 = background).
  {
    const { maskToAgPsd, normalizeVectorMaskCoords } = await import("@/lib/maskToAgPsd")
    let psdLayerIdx = 1 // pula o background
    for (const obj of objects) {
      if ((obj as any).__isBg) continue
      const maskData = (obj as any).__maskData
      const psdLayer = psdLayers[psdLayerIdx]
      const maskAlreadyBaked = (obj as any).__maskAlreadyBaked === true
      if (maskData && psdLayer) {
        const agpsdMask = await maskToAgPsd(maskData)
        // Raster mask: se o canvas do layer ja tem a mask bakeada (caso comum
        // — buildPieceCanvas faz isso pra que o composite/preview saia correto),
        // pular essa mask aqui evita DUPLA aplicacao no Photoshop. Sintoma:
        // PSD aberto cortava a interseccao da mask consigo mesma — quase nada
        // visivel. Vector/clipping nao sao bakeados, entao continuam passando.
        if (agpsdMask.mask && !maskAlreadyBaked) psdLayer.mask = agpsdMask.mask
        if (agpsdMask.vectorMask) psdLayer.vectorMask = normalizeVectorMaskCoords(agpsdMask.vectorMask, W, H)
        if (agpsdMask.clipping) psdLayer.clipping = true
      }
      psdLayerIdx++
    }
  }

  // Composite (preview): BG-7 renderiza bgLayers completo antes do fc
  const compositeCanvas = document.createElement("canvas")
  compositeCanvas.width = W
  compositeCanvas.height = H
  const cctx = compositeCanvas.getContext("2d", { alpha: false } as any)! as CanvasRenderingContext2D
  await renderBgLayersOntoCanvas(cctx, bgLayersFromData(data), W, H)
  cctx.drawImage(fc.getElement(), 0, 0)

  const thumbCanvas = document.createElement("canvas")
  const thumbScale = Math.min(256 / W, 256 / H)
  thumbCanvas.width = Math.round(W * thumbScale)
  thumbCanvas.height = Math.round(H * thumbScale)
  const tctx = thumbCanvas.getContext("2d", { alpha: false } as any)! as CanvasRenderingContext2D
  tctx.fillStyle = "#fff"
  tctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height)
  tctx.drawImage(compositeCanvas, 0, 0, thumbCanvas.width, thumbCanvas.height)

  // Reconstrói a hierarquia de folders do Photoshop a partir do __groupPath
  // anotado em cada psdLayer. Walking bottom→top (ordem do psdLayers), abre
  // novos folders quando o path estende o atual, fecha quando diverge. Layers
  // sem groupPath vão pra raiz. Folders ag-psd: { name, opened:true, children }.
  // EDGE CASE: se layers de um mesmo grupo ficarem não-contíguos no z-stack
  // (user moveu manualmente após import), o grupo é "re-aberto" — gera 2
  // folders com mesmo nome no PSD. Aceitável (designer merge manual no PS).
  function nestByGroupPath(flat: any[]): any[] {
    const root: any = { children: [] }
    let currentPath: string[] = []
    const stack: any[] = [root]
    for (const layer of flat) {
      const lp: string[] = Array.isArray(layer.__groupPath) ? layer.__groupPath : []
      let common = 0
      while (common < currentPath.length && common < lp.length && currentPath[common] === lp[common]) common++
      while (currentPath.length > common) {
        stack.pop()
        currentPath.pop()
      }
      while (currentPath.length < lp.length) {
        const newGroup: any = { name: lp[currentPath.length], opened: true, children: [] }
        stack[stack.length - 1].children.push(newGroup)
        stack.push(newGroup)
        currentPath.push(lp[currentPath.length])
      }
      const { __groupPath, ...clean } = layer
      stack[stack.length - 1].children.push(clean)
    }
    return root.children
  }
  const nestedChildren = nestByGroupPath(psdLayers)

  const psd: any = {
    width: W, height: H,
    canvas: compositeCanvas,
    children: nestedChildren,
    imageResources: {
      thumbnail: thumbCanvas,
      // resolutionInfo grava o DPI no PSD. Photoshop le isso ao abrir o arquivo
      // e mostra Image Size > Resolution com o valor correto.
      // displayUnit / widthUnit: PscMt = mm. Mais comum no Photoshop seria
      // PscCm/PscIn — ag-psd aceita ambos. Usamos PscCm pra metric.
      resolutionInfo: {
        horizontalResolution: dpi,
        horizontalResolutionUnit: "PPI",
        widthUnit: "Centimeters",
        verticalResolution: dpi,
        verticalResolutionUnit: "PPI",
        heightUnit: "Centimeters",
      },
    },
    // Smart objects embeddados: cada SVG vira um linkedFile referenciado pelos placedLayers.
    // ag-psd serializa esses bytes dentro do PSD; Photoshop reconhece como SO.
    linkedFiles: linkedFiles.length > 0 ? linkedFiles : undefined,
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

/**
 * Expande pecas com multiplos steps em "pecas virtuais" — uma por step.
 * Cada step vira uma peca independente do export com:
 *   - name: "{original}_Step1", "{original}_Step2", etc.
 *   - data.layers: os layers daquele step
 *   - data.bgColor: o bg daquele step (steps podem ter bg diferente)
 *   - mesma width/height da peca original
 *
 * Pecas com 1 step soh (ou sem campo 'steps'): passam direto sem modificacao.
 */
function expandSteps(
  pieces: Array<{ id?: string; name: string; data: any; width: number; height: number }>
): Array<{ id?: string; name: string; data: any; width: number; height: number; __virtualStepOriginalId?: string }> {
  const out: any[] = []
  for (const p of pieces) {
    const d = typeof p.data === "string" ? JSON.parse(p.data) : p.data
    const allSteps: Array<{ layers: any[]; bgColor?: string }> = Array.isArray(d?.steps) ? d.steps : []
    if (allSteps.length <= 1) {
      // Peca legada / 1 step soh: passa direto.
      out.push(p)
      continue
    }
    // Multi-step: gera N pecas virtuais.
    // CRITICO: usa o ID ORIGINAL pra renderToCanvas conseguir buscar os assets
    // da campanha via fetchPieceWithAssets. Mas marca a peca como virtual
    // (__virtualStepOriginalId) pra o renderToCanvas saber que NAO deve
    // sobrescrever piece.data com o data do banco (que tem todos os steps),
    // e sim usar o data ja preparado aqui (com layers do step especifico).
    allSteps.forEach((step, i) => {
      out.push({
        id: p.id, // mesmo id pra renderToCanvas buscar assets do banco
        __virtualStepOriginalId: p.id, // marca como virtual
        // Mantem o name com sufixo _Step{N} pra logs/progress visivel ao user,
        // mas buildFileName usa __stepIndex pra posicionar Step{N} no FINAL
        // do filename (e nao no meio).
        name: `${p.name}_Step${i + 1}`,
        __stepIndex: i,
        width: p.width,
        height: p.height,
        data: {
          ...d,
          layers: step.layers,
          bgColor: step.bgColor ?? d.bgColor,
          // remove o campo steps pra nao confundir o resto do pipeline
          steps: undefined,
          activeStepIndex: undefined,
        },
      })
    })
  }
  return out
}

export async function exportPieces(
  pieces: Array<{ id?: string; name: string; data: any; width: number; height: number }>,
  formats: ExportFormat[],
  onProgress?: (msg: string) => void,
  campaignName?: string,
  /** Tab vazia aberta SYNC no click do user — preserva gesture pra disparar download
   *  mesmo apos toda a chain async do export. Ver downloadBlob (Plano B). */
  targetWindow?: Window | null,
): Promise<void> {
  // Expande pecas multi-step ANTES de iniciar o export. Cada step vira uma
  // peca virtual com nome _StepN. O resto do pipeline trata como peca normal.
  pieces = expandSteps(pieces)
  const total = pieces.length * formats.length
  if (total === 0) { try { targetWindow?.close() } catch {} ; return }

  if (total === 1) {
    const piece = pieces[0]
    const fmt = formats[0]
    onProgress?.(`Gerando ${piece.name} (${fmt})`)
    const blob = await buildBlob(piece, fmt)
    await downloadBlob(blob, `${buildFileName(campaignName, piece)}.${EXT_MAP[fmt]}`, targetWindow)
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
  await downloadBlob(zipBlob, zipName, targetWindow)
}

export async function exportPiece(
  piece: { id?: string; name: string; data: any; width: number; height: number },
  format: ExportFormat,
  targetWindow?: Window | null,
) {
  return exportPieces([piece], [format], undefined, undefined, targetWindow)
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
  /** Arquivos extras a incluir no zip. Cada um vai pra pasta especificada em folder. */
  extraFiles?: Array<{ folder: string; name: string; blob: Blob }>,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default
  const zip = new JSZip()
  // Expande pecas multi-step (carrossel etc): cada step vira uma peca virtual
  // com nome _StepN no zip de entrega.
  pieces = expandSteps(pieces) as any
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
      } catch (e: any) {
        // Loga stack inteiro pra identificar a origem real (catch generico
        // sozinho perde info do throw original). Sem isso o user ve so
        // "Cannot read properties of undefined (reading '1')" sem saber
        // qual layer/asset causou.
        console.error("Falha exportar", piece.name, fmt, {
          message: e?.message,
          stack: e?.stack,
          pieceId: (piece as any).id,
          pieceData: typeof piece.data === "string" ? "<string>" : Object.keys(piece.data ?? {}),
        })
      }
    }
  }

  // Adiciona arquivos extras (ex: apresentacao em Deck/) se fornecidos
  if (extraFiles && extraFiles.length > 0) {
    for (const f of extraFiles) {
      onProgress?.(`Adicionando ${f.folder}/${f.name}...`)
      const buf = await f.blob.arrayBuffer()
      zip.file(`${f.folder}/${f.name}`, buf)
    }
  }

  onProgress?.(`Empacotando zip...`)
  return await zip.generateAsync({ type: "blob" })
}
