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
      const psd = readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: true, skipThumbnail: true })

      setProgress("Extraindo layers...")
      const allLayers = collectAllLayers(psd.children ?? [])
      const assets: any[] = []
      const imageBlobs: Blob[] = []
      let zIndex = 0

      for (const layer of allLayers) {
        const name = (layer.name ?? "").trim()
        if (!name || name === "Background") { zIndex++; continue }

        const left = layer.left ?? 0
        const top = layer.top ?? 0
        const width = Math.max((layer.right ?? left + 200) - left, 10)
        const height = Math.max((layer.bottom ?? top + 50) - top, 10)

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

          assets.push({
            label: name, type: "TEXT",
            content: spans,
            posX: left, posY: top, width: textWidth, height: textHeight, zIndex,
          })
        } else if (layer.canvas) {
          try {
            const blob = await canvasToBlob(layer.canvas as HTMLCanvasElement)
            const imageIndex = imageBlobs.length
            imageBlobs.push(blob)
            assets.push({ label: name, type: "IMAGE", imageIndex, posX: left, posY: top, width, height, zIndex })
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

      setProgress(`Enviando ${assets.length} assets e ${imageBlobs.length} imagens...`)

      const fd = new FormData()
      fd.append("psd", file)
      fd.append("assets", JSON.stringify(assets))
      fd.append("canvasWidth", String(psd.width))
      fd.append("canvasHeight", String(psd.height))
      fd.append("bgColor", "#ffffff")
      imageBlobs.forEach((b, i) => fd.append("images", b, `layer-${i}.png`))

      const res = await fetch(`/api/campaigns/${campaignId}/import-psd`, { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Falha ao importar")

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
          background: "#1a1a1a", border: "1px solid #333", color: "#aaa",
          padding: "8px 16px", borderRadius: 6, fontSize: 13,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.6 : 1,
          userSelect: "none",
          height: "fit-content",
        }}>
        {loading ? (progress || "Processando...") : "Importar PSD"}
        <input
          type="file"
          accept=".psd"
          style={{ position: "absolute", left: "-9999px", width: 0, height: 0, opacity: 0, pointerEvents: "none" }} tabIndex={-1}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = "" }}
        />
      </label>
      {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>{error}</div>}
    </>
  )
}
