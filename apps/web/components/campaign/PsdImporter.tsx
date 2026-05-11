"use client"
import { useState } from "react"

interface Props {
  campaignId: string
  onImported: () => void
}

function colorToHex(color: any): string {
  if (!color) return "#000000"
  const rr = color.r > 1 ? Math.round(color.r) : Math.round(color.r * 255)
  const gg = color.g > 1 ? Math.round(color.g) : Math.round(color.g * 255)
  const bb = color.b > 1 ? Math.round(color.b) : Math.round(color.b * 255)
  return "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")
}

function collectAllLayers(layers: any[]): any[] {
  const result: any[] = []
  for (const layer of layers) {
    if (layer.children?.length) result.push(...collectAllLayers(layer.children))
    else result.push(layer)
  }
  return result
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png")
  })
}

export function PsdImporter({ campaignId, onImported }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [progress, setProgress] = useState("")

  async function handleFile(file: File) {
    if (loading) return // guard de re-entrada
    setLoading(true)
    setError("")
    setProgress("Lendo PSD...")
    try {
      const agPsd = await import("ag-psd")
      const { readPsd } = agPsd
      if (agPsd.initializeCanvas) {
        agPsd.initializeCanvas(
          (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c },
          (c: any) => (c as HTMLCanvasElement).getContext("2d")
        )
      }

      const buffer = await file.arrayBuffer()
      // skipCompositeImageData: false — precisamos do canvas composto pra gerar
      // o thumbnail da matriz no card de entrada. Custa um pouco mais de memoria
      // (composite do PSD) mas evita preview vazio apos o import.
      const psd = readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: false, skipThumbnail: true })

      setProgress("Extraindo layers...")
      const allLayers = collectAllLayers(psd.children ?? [])
      const assets: any[] = []
      const imageBlobs: Blob[] = []
      let zIndex = 0

      // Smart Objects: extrai linkedFiles do PSD (bytes originais embeddados)
      // e mapeia GUID -> indice. Layers com placedLayer apontam pro GUID, e
      // ai linkamos o asset ao SO correspondente.
      const linkedFiles = (psd as any).linkedFiles ?? []
      const linkedBlobs: Blob[] = []
      const linkedMeta: Array<{ guid: string; mime: string; originalName: string; sizeBytes: number; width?: number; height?: number }> = []
      const guidToIndex = new Map<string, number>()
      for (const lf of linkedFiles) {
        const guid = lf.id
        if (!guid) continue
        const data: Uint8Array | undefined = lf.data
        if (!data) continue
        const name: string = lf.name ?? `linked-${guid}`
        // Deduz mime pela extensao do nome (ag-psd nao expoe mime diretamente)
        const ext = (name.split(".").pop() ?? "").toLowerCase()
        const mime =
          ext === "svg" ? "image/svg+xml" :
          ext === "ai"  ? "application/postscript" :
          ext === "pdf" ? "application/pdf" :
          ext === "psd" ? "image/vnd.adobe.photoshop" :
          ext === "png" ? "image/png" :
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
          "application/octet-stream"
        // Pra SVG da pra extrair viewBox; pros outros formatos deixa undefined
        let width: number | undefined, height: number | undefined
        if (mime === "image/svg+xml") {
          try {
            const txt = new TextDecoder().decode(data)
            const vb = txt.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
            if (vb) {
              const parts = vb.split(/[\s,]+/).map(Number)
              if (parts.length === 4 && parts.every(Number.isFinite)) {
                width = parts[2]; height = parts[3]
              }
            }
          } catch { /* ignora */ }
        }
        const idx = linkedBlobs.length
        // Constroi Blob a partir dos bytes — Buffer pra blob
        // OBS: Uint8Array satisfaz BlobPart, mas TS as vezes reclama em modos strict
        linkedBlobs.push(new Blob([data as any], { type: mime }))
        linkedMeta.push({ guid, mime, originalName: name, sizeBytes: data.byteLength, width, height })
        guidToIndex.set(guid, idx)
      }

      for (const layer of allLayers) {
        const name = (layer.name ?? "").trim()
        if (!name || name === "Background") { zIndex++; continue }

        const left = layer.left ?? 0
        const top = layer.top ?? 0
        const width = Math.max((layer.right ?? left + 200) - left, 10)
        const height = Math.max((layer.bottom ?? top + 50) - top, 10)

        // === EXTRAI MASCARA (raster, vector, clipping) ===
        // ag-psd expoe: layer.mask (raster) com canvas+left+top+right+bottom,
        // layer.vectorMask com paths, e layer.clipping=true pra clipping mask.
        // Salvamos no formato LayerMask pra reproduzir no editor e re-exportar.
        let assetMask: any = null
        // Raster mask: layer.mask.canvas tem o grayscale (preto = transparente).
        if (layer.mask?.canvas) {
          try {
            const mLeft = layer.mask.left ?? 0
            const mTop = layer.mask.top ?? 0
            const mRight = layer.mask.right ?? (mLeft + (layer.mask.canvas as HTMLCanvasElement).width)
            const mBottom = layer.mask.bottom ?? (mTop + (layer.mask.canvas as HTMLCanvasElement).height)
            const mWidth = mRight - mLeft
            const mHeight = mBottom - mTop
            const dataUrl = (layer.mask.canvas as HTMLCanvasElement).toDataURL("image/png")
            assetMask = {
              type: "raster" as const,
              enabled: !layer.mask.disabled,
              raster: { dataUrl, posX: mLeft, posY: mTop, width: mWidth, height: mHeight },
            }
          } catch (e) { console.warn("[psd-mask] falha lendo raster mask de", name, e) }
        }
        // Vector mask: layer.vectorMask tem paths (objetos com knots/curves).
        // Por enquanto extraimos o bounding box como retangulo. Suporte completo
        // a paths arbitrarios sera adicionado depois.
        if (!assetMask && (layer as any).vectorMask?.paths?.length) {
          try {
            const vm = (layer as any).vectorMask
            // Compute bounding box dos paths
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (const p of vm.paths) {
              const knots = p.knots ?? []
              for (const k of knots) {
                const pt = k.anchor ?? k.points?.[0] ?? null
                if (pt && Array.isArray(pt) && pt.length >= 2) {
                  // ag-psd retorna coords como fracoes 0..1 do canvas
                  const x = pt[0] * psd.width
                  const y = pt[1] * psd.height
                  if (x < minX) minX = x
                  if (y < minY) minY = y
                  if (x > maxX) maxX = x
                  if (y > maxY) maxY = y
                }
              }
            }
            if (isFinite(minX) && isFinite(minY)) {
              const vWidth = Math.max(maxX - minX, 1)
              const vHeight = Math.max(maxY - minY, 1)
              // SVG path retangular pra bounding box (path completo virá em V2)
              const pathStr = `M ${minX} ${minY} L ${minX + vWidth} ${minY} L ${minX + vWidth} ${minY + vHeight} L ${minX} ${minY + vHeight} Z`
              assetMask = {
                type: "vector" as const,
                enabled: !vm.disabled,
                vector: { path: pathStr, posX: minX, posY: minY, width: vWidth, height: vHeight },
              }
            }
          } catch (e) { console.warn("[psd-mask] falha lendo vector mask de", name, e) }
        }
        // Clipping mask: layer.clipping === true significa "este layer recorta
        // o layer abaixo". Nao tem dados proprios, so a flag.
        if (!assetMask && (layer as any).clipping === true) {
          assetMask = {
            type: "clipping" as const,
            enabled: true,
            clipping: true,
          }
        }

        if (layer.text) {
          const td = layer.text
          const rawText = String(td.text ?? name).split("\r\n").join("\n").split("\r").join("\n")
          const defStyle = td.style ?? {}
          const defFontName = defStyle.font?.name ?? "Arial"
          const defFontSize = defStyle.fontSize ?? 48
          const defColor = defStyle.fillColor ? colorToHex(defStyle.fillColor) : "#000000"
          const defWeight = (defStyle.fauxBold || defFontName.toLowerCase().includes("bold")) ? "bold" : "normal"

          let spans: any[] = []
          const runs = td.styleRuns ?? []
          if (runs.length > 0) {
            let cursor = 0
            for (const run of runs) {
              const len = run.length ?? 0
              const segment = rawText.substring(cursor, cursor + len)
              if (!segment) { cursor += len; continue }
              const rs = run.style ?? {}
              const fontName = rs.font?.name ?? defFontName
              const fontSize = rs.fontSize ?? defFontSize
              const color = rs.fillColor ? colorToHex(rs.fillColor) : defColor
              const fontWeight = (rs.fauxBold || fontName.toLowerCase().includes("bold")) ? "bold" : defWeight
              spans.push({ text: segment, style: { color, fontSize: Math.round(fontSize), fontWeight, fontFamily: fontName } })
              cursor += len
            }
            if (cursor < rawText.length) {
              spans.push({ text: rawText.substring(cursor), style: { color: defColor, fontSize: Math.round(defFontSize), fontWeight: defWeight, fontFamily: defFontName } })
            }
          } else {
            spans = [{ text: rawText, style: { color: defColor, fontSize: Math.round(defFontSize), fontWeight: defWeight, fontFamily: defFontName } }]
          }

          const bbox = td.boundingBox
          const textWidth = bbox ? Math.round(bbox.right - bbox.left) : Math.max(width, 200)
          const textHeight = bbox ? Math.round(bbox.bottom - bbox.top) : height

          // Monta lastOverride: BOX (width/height) + CHARACTER (cor, fonte, etc).
          // Se ha multiplos spans, gera styles per-caractere pra preservar formatacao
          // original do PSD ate ao ultimo caractere.
          const lastOverride: any = {
            width: textWidth,
            height: textHeight,
            fontFamily: defFontName,
            fontSize: Math.round(defFontSize),
            fontWeight: defWeight,
            fill: defColor,
            charSpacing: 0,
            lineHeight: 1.16,
            textAlign: "left",
          }
          if (spans.length > 1) {
            const styles: any = { 0: {} }
            let charIdx = 0
            for (const span of spans) {
              const txt = span.text
              for (let i = 0; i < txt.length; i++) {
                if (txt[i] === "\n") { charIdx++; continue }
                styles[0][String(charIdx)] = {
                  fill: span.style.color,
                  fontSize: span.style.fontSize,
                  fontFamily: span.style.fontFamily,
                  fontWeight: span.style.fontWeight,
                }
                charIdx++
              }
            }
            lastOverride.styles = styles
          }

          assets.push({
            label: name, type: "TEXT",
            content: spans,
            posX: left, posY: top, width: textWidth, height: textHeight, zIndex,
            lastOverride,
            mask: assetMask,
          })
        } else if (layer.canvas) {
          try {
            const blob = await canvasToBlob(layer.canvas as HTMLCanvasElement)
            const imageIndex = imageBlobs.length
            imageBlobs.push(blob)
            // Smart Object: se layer tem placedLayer.id, linkamos ao linkedFile
            // correspondente pra preservar o original. O preview raster (canvas)
            // continua usado como imageUrl pro editor renderizar.
            const placed: any = (layer as any).placedLayer
            const linkedIndex = placed?.id ? guidToIndex.get(placed.id) : undefined
            assets.push({
              label: name, type: "IMAGE",
              imageIndex,
              linkedIndex,           // index no linkedBlobs (se for smart object)
              posX: left, posY: top, width, height, zIndex,
              mask: assetMask,
            })
          } catch (e) {
            console.warn("Falha ao extrair imagem do layer", name, e)
          }
        }
        zIndex++
      }

      if (assets.length === 0) {
        setError("Nenhum layer extraido do PSD")
        return
      }

      // Threshold: se o PSD for maior que 50MB, NAO envia o arquivo original
      // no mesmo request (estouraria limite de FormData do Next/Node, dando
      // 'Failed to parse body as FormData'). Os assets+imagens decompostas
      // sao pequenas e sobem normal. Upload do master PSD original vai ser
      // implementado em chunked upload posteriormente.
      const PSD_INLINE_LIMIT = 50 * 1024 * 1024 // 50MB
      const skipMasterPsd = file.size > PSD_INLINE_LIMIT

      setProgress(`Enviando ${assets.length} assets, ${imageBlobs.length} imagens, ${linkedBlobs.length} smart objects...${skipMasterPsd ? " (PSD master sera uploadado em seguida)" : ""}`)

      const fd = new FormData()
      if (!skipMasterPsd) {
        fd.append("psd", file)
      } else {
        // Avisa o backend que o PSD master sera uploadado depois (via chunked).
        // Por enquanto so registramos o nome original.
        fd.append("psdName", file.name)
        fd.append("psdSize", String(file.size))
        fd.append("skipMaster", "1")
      }
      fd.append("assets", JSON.stringify(assets))
      fd.append("canvasWidth", String(psd.width))
      fd.append("canvasHeight", String(psd.height))
      fd.append("bgColor", "#ffffff")
      imageBlobs.forEach((b, i) => fd.append("images", b, `layer-${i}.png`))
      // Smart objects: bytes + metadados (mesmo index na lista do backend)
      fd.append("linkedMeta", JSON.stringify(linkedMeta))
      linkedBlobs.forEach((b, i) => {
        const meta = linkedMeta[i]
        fd.append("linked", b, meta.originalName ?? `linked-${i}`)
      })

      const res = await fetch(`/api/campaigns/${campaignId}/import-psd`, { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Falha ao importar")

      // Gera e envia o thumbnail da matriz a partir do composite do PSD.
      // Sem isso, o card 'Key Vision (Matriz)' fica vazio depois do import
      // (so com fallback do tamanho em texto). Faz best-effort: falha aqui nao
      // bloqueia o import.
      try {
        if (psd.canvas) {
          setProgress("Gerando preview...")
          const TARGET = 480 // mesmo target que o editor usa pro KV thumb
          const sw = (psd.canvas as HTMLCanvasElement).width
          const sh = (psd.canvas as HTMLCanvasElement).height
          const scale = Math.min(TARGET / sw, TARGET / sh, 1)
          const tw = Math.max(1, Math.round(sw * scale))
          const th = Math.max(1, Math.round(sh * scale))
          const thumbCanvas = document.createElement("canvas")
          thumbCanvas.width = tw
          thumbCanvas.height = th
          const ctx = thumbCanvas.getContext("2d")
          if (ctx) {
            ctx.fillStyle = "#ffffff"
            ctx.fillRect(0, 0, tw, th)
            ctx.drawImage(psd.canvas as HTMLCanvasElement, 0, 0, tw, th)
            const thumbBlob: Blob | null = await new Promise(resolve => {
              thumbCanvas.toBlob(b => resolve(b), "image/jpeg", 0.85)
            })
            if (thumbBlob) {
              const tfd = new FormData()
              tfd.append("thumbnail", thumbBlob, "kv-thumb.jpg")
              await fetch(`/api/campaigns/${campaignId}/key-vision/thumbnail`, { method: "POST", body: tfd })
            }
          }
        }
      } catch (thumbErr) {
        console.warn("KV thumb post-import upload failed:", thumbErr)
      }

      onImported()
    } catch (e: any) {
      console.error("PSD import error:", e)
      setError("Erro: " + (e?.message ?? "desconhecido"))
    } finally {
      setLoading(false)
      setProgress("")
    }
  }

  // Padrão: <label> envolvendo <input> SEM disabled no input.
  // O `loading` controla só o visual (cursor/opacity) e o guard interno em handleFile.
  // Isso evita que o input fique travado caso loading fique preso em true por algum bug.
  return (
    <>
      <label
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "#F5C400", border: "none", color: "#111111",
          padding: "10px 24px", borderRadius: 6, fontSize: 16, fontWeight: 600,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.6 : 1,
          userSelect: "none",
          height: "fit-content",
          transition: "background 0.15s",
        }}
        onMouseEnter={e => { if (!loading) (e.currentTarget as HTMLLabelElement).style.background = "#e0b000" }}
        onMouseLeave={e => { (e.currentTarget as HTMLLabelElement).style.background = "#F5C400" }}>
        {loading ? (progress || "Processando...") : "Importar PSD"}
        <input
          type="file"
          accept=".psd"
          style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0 }} tabIndex={-1}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }}
        />
      </label>
      {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>{error}</div>}
    </>
  )
}
