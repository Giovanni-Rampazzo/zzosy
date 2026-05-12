"use client"
/**
 * PsdPieceImporter — importa um ou mais arquivos PSD como PEÇAS de uma
 * campanha existente. Distinto do PsdImporter (que popula a MATRIZ/KV).
 *
 * Fluxo:
 *  1. User seleciona N PSDs (file input multiple)
 *  2. Pra cada PSD:
 *     a. Le e extrai layers (canvas raster, textos com styles)
 *     b. Tenta MATCH NORMALIZADO de cada layer.name com os campaign.assets
 *     c. Layers com match: ganham __assetId, viram layers "linkados" (igual peca gerada)
 *     d. Layers sem match: viram layers "embedded" (conteudo cru gravado no pieceData)
 *     e. Cria piece no backend com width/height do PSD + data JSON com os layers
 *     f. Upload thumb composite do PSD como preview inicial
 *  3. Callback onImported pra page recarregar a lista
 *
 * O editor sabe lidar com ambos os tipos (__assetId valido OU __embedded=true).
 */
import { useState } from "react"
import { Button } from "@/components/ui/Button"
import { normalizeName } from "@/lib/normalize"

interface Asset {
  id: string
  label: string | null
  type: string
  imageUrl?: string | null
}

interface Props {
  campaignId: string
  campaignAssets: Asset[]
  onImported: () => void
}

function canvasToBlob(canvas: HTMLCanvasElement, mime = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), mime)
  })
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

export function PsdPieceImporter({ campaignId, campaignAssets, onImported }: Props) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  // Map normalizado pra match rapido: normalized(label) -> Asset
  const assetIndex = new Map<string, Asset>()
  for (const a of campaignAssets) {
    const key = normalizeName(a.label)
    if (key) assetIndex.set(key, a)
  }

  async function importOne(file: File, index: number, total: number) {
    setProgress(`(${index + 1}/${total}) Lendo ${file.name}…`)
    const agPsd = await import("ag-psd")
    const { readPsd } = agPsd
    if ((agPsd as any).initializeCanvas) {
      (agPsd as any).initializeCanvas(
        (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c },
        (c: any) => (c as HTMLCanvasElement).getContext("2d")
      )
    }
    const buffer = await file.arrayBuffer()
    const psd = readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: false, skipThumbnail: true })

    const pieceW = psd.width
    const pieceH = psd.height
    const allLayers = collectAllLayers(psd.children ?? [])

    setProgress(`(${index + 1}/${total}) Extraindo ${allLayers.length} layers…`)

    const dataLayers: any[] = []
    let linked = 0
    let embedded = 0
    let zIndex = 0

    for (const layer of allLayers) {
      const layerName = (layer.name ?? "").trim()
      if (!layerName || layerName === "Background") { zIndex++; continue }

      const left = layer.left ?? 0
      const top = layer.top ?? 0
      const width = Math.max((layer.right ?? left + 200) - left, 10)
      const height = Math.max((layer.bottom ?? top + 50) - top, 10)

      // Match normalizado contra os assets da campanha
      const matchKey = normalizeName(layerName)
      const matchedAsset = matchKey ? assetIndex.get(matchKey) : null

      if (layer.text) {
        // === TEXT LAYER ===
        const td = layer.text
        const rawText = String(td.text ?? layerName).split("\r\n").join("\n").split("\r").join("\n")
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

        // Monta styles per-char pra preservar formatacao
        const styles: any = {}
        if (spans.length > 1) {
          styles[0] = {}
          let charIdx = 0
          for (const span of spans) {
            for (let i = 0; i < span.text.length; i++) {
              if (span.text[i] === "\n") { charIdx++; continue }
              styles[0][String(charIdx)] = {
                fill: span.style.color,
                fontSize: span.style.fontSize,
                fontFamily: span.style.fontFamily,
                fontWeight: span.style.fontWeight,
              }
              charIdx++
            }
          }
        }

        const layerData: any = {
          type: "TEXT",
          posX: left, posY: top, width, height, zIndex,
          text: rawText,
          fontFamily: defFontName,
          fontSize: Math.round(defFontSize),
          fontWeight: defWeight,
          fill: defColor,
          textAlign: "left",
          styles: Object.keys(styles).length > 0 ? styles : undefined,
        }

        // LINK ou EMBEDDED. IMPORTANTE: o campo persistido eh `assetId`
        // (sem prefixo __). O `__assetId` so existe no objeto Fabric runtime
        // dentro do editor (custom prop nao serializada).
        if (matchedAsset && matchedAsset.type === "TEXT") {
          layerData.assetId = matchedAsset.id
          linked++
        } else {
          layerData.__embedded = true
          embedded++
        }
        dataLayers.push(layerData)

      } else if (layer.canvas) {
        // === IMAGE LAYER ===
        try {
          const blob = await canvasToBlob(layer.canvas as HTMLCanvasElement, "image/png")
          // Converte blob pra dataUrl pra gravar inline no piece.data (layers embedded
          // nao tem asset associado entao precisam carregar o pixel info junto)
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader()
            r.onload = () => resolve(r.result as string)
            r.onerror = reject
            r.readAsDataURL(blob)
          })

          const layerData: any = {
            type: "IMAGE",
            posX: left, posY: top, width, height, zIndex,
          }

          if (matchedAsset && matchedAsset.type === "IMAGE") {
            // Linkado: usa imageUrl do asset (referencia)
            layerData.assetId = matchedAsset.id
            linked++
          } else {
            // Embedded: grava dataUrl direto (peso adicional mas permite peca avulsa)
            layerData.__embedded = true
            layerData.imageDataUrl = dataUrl
            embedded++
          }
          dataLayers.push(layerData)
        } catch (e) {
          console.warn("Falha ao extrair imagem do layer", layerName, e)
        }
      }
      zIndex++
    }

    if (dataLayers.length === 0) {
      throw new Error(`Nenhum layer extraido de ${file.name}`)
    }

    setProgress(`(${index + 1}/${total}) Criando peça (${linked} linkados, ${embedded} embedded)…`)

    // Cria a peca via endpoint dedicado
    const pieceRes = await fetch("/api/pieces/import-psd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId,
        name: file.name.replace(/\.psd$/i, ""),
        width: pieceW,
        height: pieceH,
        data: {
          layers: dataLayers,
          width: pieceW,
          height: pieceH,
        },
      }),
    })
    if (!pieceRes.ok) {
      const msg = await pieceRes.text().catch(() => "")
      throw new Error(`Falha ao criar peca: ${msg || pieceRes.status}`)
    }
    const piece = await pieceRes.json()

    // Upload do composite PSD como thumb inicial (browser ver o resultado renderizado
    // mesmo antes do user abrir no editor). Quando user abre no editor, o auto-regen
    // substitui pelo render Fabric real.
    if (psd.canvas) {
      try {
        const thumbBlob = await canvasToBlob(psd.canvas as HTMLCanvasElement, "image/png")
        const fd = new FormData()
        fd.append("thumbnail", thumbBlob, "thumb.png")
        await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
      } catch (e) { console.warn("[import-psd] thumb composite falhou:", e) }
    }
  }

  async function handleFiles(files: FileList | File[]) {
    if (loading) return
    const arr = Array.from(files)
    if (arr.length === 0) return
    setLoading(true)
    setError("")

    let imported = 0
    const errors: string[] = []
    for (let i = 0; i < arr.length; i++) {
      try {
        await importOne(arr[i], i, arr.length)
        imported++
      } catch (e: any) {
        console.error("[import-psd] falha em", arr[i].name, e)
        errors.push(`${arr[i].name}: ${e?.message ?? "erro"}`)
      }
    }

    setLoading(false)
    setProgress("")
    if (errors.length > 0) {
      setError(`${imported} importadas, ${errors.length} falharam: ${errors.join("; ")}`)
    }
    onImported()
  }

  return (
    <>
      <label style={{ display: "inline-flex" }}>
        <Button
          variant="secondary"
          size="md"
          loading={loading}
          title="Importar PSDs como pecas (mantem dimensoes originais, linka layers com nomes iguais aos assets)"
          // O <Button> nao expoe diretamente file picker multiple, entao usamos um input
          // file separado embaixo. O label do <Button> nao captura clique de file input.
          // Aqui o Button so dispara o click no input via ref.
          onClick={() => {
            const input = document.getElementById(`psd-piece-import-${campaignId}`) as HTMLInputElement | null
            input?.click()
          }}
        >
          {loading ? (progress || "Importando…") : "Importar PSD como peça"}
        </Button>
      </label>
      <input
        id={`psd-piece-import-${campaignId}`}
        type="file"
        accept=".psd"
        multiple
        style={{ display: "none" }}
        onChange={e => { if (e.target.files) { handleFiles(e.target.files); e.target.value = "" } }}
      />
      {error && <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>{error}</div>}
    </>
  )
}
