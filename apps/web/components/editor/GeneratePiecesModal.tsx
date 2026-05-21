"use client"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/Button"

// Escala um SVG path d-string pra acompanhar resize. Aplica scale+offset em
// pares (x,y) das coordenadas. Cobre os comandos absolutos gerados pelo
// PsdImporter (M, L, C, Z) e os relativos (m, l, c) por simetria — relativos
// recebem so scale, sem offset (sao deltas, nao posicoes).
function scaleSvgPath(path: string, scale: number, offsetX: number, offsetY: number): string {
  if (!path) return path
  // Tokeniza: cada token e um comando (letra) ou um numero (com sinal/decimal).
  const tokens = path.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []
  if (tokens.length === 0) return path
  const out: string[] = []
  let cmd = ""
  let i = 0
  const isCmd = (t: string) => /^[A-Za-z]$/.test(t)
  while (i < tokens.length) {
    const t = tokens[i]
    if (isCmd(t)) { cmd = t; out.push(t); i++; continue }
    // Number — interpreta conforme o comando atual
    const num = parseFloat(t)
    const lower = cmd.toLowerCase()
    const relative = cmd === lower // letra minuscula = relativo
    let coords: number[]
    if (lower === "m" || lower === "l" || lower === "t") {
      // pares (x, y)
      coords = [num, parseFloat(tokens[i + 1] ?? "0")]
      i += 2
    } else if (lower === "h") {
      coords = [num]; i += 1
    } else if (lower === "v") {
      coords = [num]; i += 1
    } else if (lower === "c") {
      // tres pares (x1,y1, x2,y2, x,y)
      coords = [
        num, parseFloat(tokens[i+1] ?? "0"),
        parseFloat(tokens[i+2] ?? "0"), parseFloat(tokens[i+3] ?? "0"),
        parseFloat(tokens[i+4] ?? "0"), parseFloat(tokens[i+5] ?? "0"),
      ]
      i += 6
    } else if (lower === "s" || lower === "q") {
      coords = [
        num, parseFloat(tokens[i+1] ?? "0"),
        parseFloat(tokens[i+2] ?? "0"), parseFloat(tokens[i+3] ?? "0"),
      ]
      i += 4
    } else if (lower === "a") {
      // rx ry rot largeArc sweep x y — so escala rx/ry e x/y; rot/flags intactos
      coords = [
        num, parseFloat(tokens[i+1] ?? "0"),
        parseFloat(tokens[i+2] ?? "0"),
        parseFloat(tokens[i+3] ?? "0"),
        parseFloat(tokens[i+4] ?? "0"),
        parseFloat(tokens[i+5] ?? "0"), parseFloat(tokens[i+6] ?? "0"),
      ]
      // rx, ry escalados; rot intacto; largeArc/sweep intactos (0|1); x,y escalados
      coords[0] *= scale; coords[1] *= scale
      coords[5] = coords[5] * scale + (relative ? 0 : offsetX)
      coords[6] = coords[6] * scale + (relative ? 0 : offsetY)
      out.push(coords.map(n => n.toFixed(2)).join(" "))
      i += 7
      continue
    } else {
      // Comando desconhecido — passa numero direto
      out.push(t); i += 1; continue
    }
    // Escala coords (alternando x/y; H so x; V so y)
    if (lower === "h") {
      coords[0] = coords[0] * scale + (relative ? 0 : offsetX)
    } else if (lower === "v") {
      coords[0] = coords[0] * scale + (relative ? 0 : offsetY)
    } else {
      for (let k = 0; k < coords.length; k++) {
        const isX = k % 2 === 0
        coords[k] = coords[k] * scale + (relative ? 0 : (isX ? offsetX : offsetY))
      }
    }
    out.push(coords.map(n => n.toFixed(2)).join(" "))
  }
  return out.join(" ").replace(/\s+([MmLlHhVvCcSsQqTtAaZz])\s+/g, " $1 ").trim()
}

// Escala a LayerMask (raster/vector/clipping) pra acompanhar o resize matriz→peca.
// raster: posX/posY/width/height em coords absolutas do canvas → aplica scale + offset.
// vector: mesma coisa pro bbox; o path em si fica no asset.imageUrl, nao precisamos
//         re-renderizar aqui — Fabric escala pelo absolutePositioned com posX/posY/width/height.
// clipping: nao tem coords (refere ao layer abaixo), passa intacto.
function scaleLayerMask(mask: any, scale: number, offsetX: number, offsetY: number): any {
  if (!mask || typeof mask !== "object") return mask
  if (mask.type === "raster" && mask.raster) {
    return {
      ...mask,
      // _schemaV: marca que a mask passou pelo scale matriz→peca. Permite
      // detectar peças antigas (sem essa flag) que ficaram com coords-matriz
      // por bug anterior. composeRasterMaskIntoImage emite warning quando
      // encontra mask sem _schemaV num contexto de scale != 1.
      _schemaV: 2,
      raster: {
        ...mask.raster,
        posX: Math.round((mask.raster.posX ?? 0) * scale + offsetX),
        posY: Math.round((mask.raster.posY ?? 0) * scale + offsetY),
        width: Math.round((mask.raster.width ?? 0) * scale),
        height: Math.round((mask.raster.height ?? 0) * scale),
      },
    }
  }
  if (mask.type === "vector" && mask.vector) {
    return {
      ...mask,
      _schemaV: 2,
      vector: {
        ...mask.vector,
        path: scaleSvgPath(mask.vector.path ?? "", scale, offsetX, offsetY),
        posX: Math.round((mask.vector.posX ?? 0) * scale + offsetX),
        posY: Math.round((mask.vector.posY ?? 0) * scale + offsetY),
        width: Math.round((mask.vector.width ?? 0) * scale),
        height: Math.round((mask.vector.height ?? 0) * scale),
      },
    }
  }
  // clipping: sem coords, passa direto
  return { ...mask, _schemaV: 2 }
}

interface MediaFormat {
  id: string
  vehicle: string
  media: string
  format: string
  width: number
  height: number
  dpi: number
  category: string
}

interface Props {
  campaignId: string
  fabricRef: React.RefObject<any>
  onClose: () => void
  onGenerated: () => void
}

// Renderiza preview de UMA peca: cria canvas no tamanho da peca e desenha os
// objetos da matriz com escala pelo MENOR LADO (preserva proporcao do layout)
async function renderPieceThumb(
  matrixCanvas: any,
  pieceW: number,
  pieceH: number,
  matrixW: number,
  matrixH: number
): Promise<Blob | null> {
  try {
    const fabric = await import("fabric")
    const StaticCanvas = (fabric as any).StaticCanvas
    const el = document.createElement("canvas")
    el.width = pieceW; el.height = pieceH

    // Pega cor real do BG do editor: hoje BG eh um OBJETO com fill (nao a propriedade
    // backgroundColor do Fabric Canvas, que fica preto por default no JPEG export).
    const matrixBgObj = matrixCanvas.getObjects().find((o: any) => o.__isBg)
    const realBgColor = matrixBgObj?.fill ?? matrixCanvas.backgroundColor ?? "#fff"

    const fc = new StaticCanvas(el, { width: pieceW, height: pieceH, enableRetinaScaling: false })

    // Escala pelo MENOR lado (uma dimensao cabe, layout preservado)
    const scale = Math.min(pieceW / matrixW, pieceH / matrixH)
    const offsetX = (pieceW - matrixW * scale) / 2
    const offsetY = (pieceH - matrixH * scale) / 2

    // Serializa matriz e carrega no canvas da peca.
    // Usa toObject (nao toJSON): em Fabric v6 Canvas.toJSON() ignora silenciosamente
    // o array de props extras — soh toObject(props) repassa pra _toObjectMethod.
    // Sem isso, __assetId/__assetLabel se perdiam na clonagem matriz->peca.
    const json = (matrixCanvas as any).toObject(["__assetId", "__assetLabel", "__isBg", "__isImage"])
    // Fabric v6 quirk: 2o arg de loadFromJSON eh REVIVER per-objeto, nao
    // callback de conclusao — passar `() => resolve()` ali resolvia a Promise
    // no PRIMEIRO objeto desserializado, e o codigo prosseguia com canvas vazio.
    // Aguarda apenas a Promise retornada pelo Fabric v6.
    await fc.loadFromJSON(json)
    await new Promise(r => setTimeout(r, 200))

    // CRITICO: setar backgroundColor DEPOIS do loadFromJSON (ele sobrescreve com o do JSON
    // que vem vazio/transparente, fazendo o JPEG export ficar preto). A cor real vem do
    // OBJETO __isBg do editor, nao da propriedade backgroundColor do Canvas.
    fc.backgroundColor = realBgColor

    // Aplica escala em todos os objetos
    for (const obj of fc.getObjects()) {
      if ((obj as any).__isBg) {
        obj.set({ left: 0, top: 0, width: pieceW, height: pieceH, scaleX: 1, scaleY: 1 })
        continue
      }
      obj.set({
        left: (obj.left ?? 0) * scale + offsetX,
        top: (obj.top ?? 0) * scale + offsetY,
        scaleX: (obj.scaleX ?? 1) * scale,
        scaleY: (obj.scaleY ?? 1) * scale,
      })
      obj.setCoords()
    }
    const bgObj = fc.getObjects().find((o: any) => o.__isBg)
    if (bgObj) fc.sendObjectToBack(bgObj)
    fc.renderAll()

    // Thumbnail HIGH-RES (1920px max maior lado, PNG pra preservar alpha).
    // JPEG flatava mascaras raster com transparencia em cor solida — apresentacao
    // perdia o look. PNG mantem alpha; ligeiramente maior que JPEG mas pra
    // screenshots de UI com texto + cor solida a diferenca eh minima.
    const thumbScale = Math.min(1920 / pieceW, 1920 / pieceH, 1)
    const dataUrl = fc.toDataURL({ format: "png", multiplier: thumbScale })
    fc.dispose()
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch (e) {
    console.warn("thumb fail:", e)
    return null
  }
}

export function GeneratePiecesModal({ campaignId, fabricRef, onClose, onGenerated }: Props) {
  const [formats, setFormats] = useState<MediaFormat[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState("")

  useEffect(() => {
    fetch("/api/medias").then(r => r.json()).then(d => { setFormats(d); setLoading(false) })
  }, [campaignId])

  function isSelected(id: string) { return selected.includes(id) }
  function toggle(id: string) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  function toggleAll(category: string) {
    const ids = formats.filter(f => (f.category || "Sem categoria") === category).map(f => f.id)
    const allSelected = ids.every(id => selected.includes(id))
    if (allSelected) setSelected(prev => prev.filter(id => !ids.includes(id)))
    else setSelected(prev => [...prev, ...ids.filter(id => !prev.includes(id))])
  }

  async function generate() {
    if (selected.length === 0) return
    setGenerating(true)

    const fc = fabricRef.current
    if (!fc) { setGenerating(false); return }

    const selectedFormats = formats.filter(f => selected.includes(f.id))
    // Coleta falhas por-formato pra reportar ao user no fim. Antes (audit
    // pre-F10) tudo era silencioso — usuario via 3 peças geradas com 1
    // preview faltando e nao sabia o porque.
    const failures: string[] = []

    // Le matriz: dimensoes + layers (do bg + objetos) com posicoes
    const bg = fc.getObjects().find((o: any) => o.__isBg)
    const matrixW = bg?.width ?? fc.getWidth() / fc.getZoom()
    const matrixH = bg?.height ?? fc.getHeight() / fc.getZoom()

    // Carregar key-vision atual do banco para pegar os layers (mais confiavel que ler do canvas)
    const campRes = await fetch(`/api/campaigns/${campaignId}`)
    const camp = await campRes.json()
    const matrixLayers = (camp.keyVision?.layers ?? []) as any[]

    // BG da matriz: propaga o ARRAY bgLayers completo (gradient/image preservados),
    // nao apenas a cor solida. Antes copiava so bg.fill que virava '[object Object]'
    // quando o BG era gradient — peca abria com fundo branco/quebrado.
    const matrixBgLayers = Array.isArray(camp.keyVision?.bgLayers) && camp.keyVision.bgLayers.length > 0
      ? camp.keyVision.bgLayers
      : null
    const matrixBgColor = typeof camp.keyVision?.bgColor === "string" ? camp.keyVision.bgColor : "#ffffff"
    const matrixBgOpacity = typeof camp.keyVision?.bgOpacity === "number" ? camp.keyVision.bgOpacity : 1

    let i = 0
    for (const f of selectedFormats) {
      i++
      setProgress(`${i}/${selectedFormats.length} — ${f.format}`)

      // Calcula posicoes adaptadas (escala pelo menor lado)
      const scale = Math.min(f.width / matrixW, f.height / matrixH)
      const offsetX = (f.width - matrixW * scale) / 2
      const offsetY = (f.height - matrixH * scale) / 2

      const pieceLayers = matrixLayers.map((l: any) => {
        // Detecta se layer e de TEXTO. Antes detectava via ov.fontSize, mas isso
        // falhava quando o user adicionava asset texto mas nao mudava style nenhum.
        // Solucao mais robusta: olhar o asset.type.
        const ov = l.overrides ?? {}
        const assetForLayer = (camp?.assets ?? []).find((a: any) => a.id === l.assetId)
        const isTextLayer = (assetForLayer?.type === "TEXT") || (typeof ov.fontSize === "number")

        const base: any = {
          assetId: l.assetId,
          posX: Math.round((l.posX ?? 0) * scale + offsetX),
          posY: Math.round((l.posY ?? 0) * scale + offsetY),
          rotation: l.rotation ?? 0,
          zIndex: l.zIndex ?? 0,
        }
        // Round-trip metadata da matriz → peca. Sem isso, a peca nascia perdendo
        // mascaras (channel mask sumia, aparecia imagem inteira), hidden/locked,
        // opacity/blendMode, effects e groupPath. Sintoma reportado pelo user:
        // 'channelmask some no editor, imagem inteira aparece'.
        if (l.mask) base.mask = scaleLayerMask(l.mask, scale, offsetX, offsetY)
        if (l.hidden === true) base.hidden = true
        if (l.locked === true) base.locked = true
        if (typeof l.opacity === "number" && l.opacity < 1) base.opacity = l.opacity
        if (typeof l.blendMode === "string" && l.blendMode !== "source-over") base.blendMode = l.blendMode
        if (l.effects && typeof l.effects === "object") base.effects = l.effects
        if (Array.isArray(l.groupPath) && l.groupPath.length > 0) base.groupPath = l.groupPath

        if (isTextLayer) {
          // TEXTO: consolida scale no fontSize/width/leadingPt e MANTEM scaleX=scaleY=1.
          // Sem isso, ao clicar no texto na peca o Fabric consolida sozinho e o tamanho
          // 'salta' — efeito ruim pro usuario. Photoshop-style: fontSize sempre representa
          // o tamanho real renderizado, scale fica em 1.
          //
          // Fallback chain pra cada campo: layer.overrides (matriz user-edited) ->
          // asset.lastOverride (template visual do asset) -> default.
          const tpl: any = (assetForLayer as any)?.lastOverride ?? {}
          const merged: any = { ...tpl, ...ov }  // ov sobrescreve tpl quando definido
          const baseFontSize = typeof merged.fontSize === "number" ? merged.fontSize : 80
          const newOverrides: any = { ...merged }
          newOverrides.fontSize = baseFontSize * scale
          if (typeof merged.leadingPt === "number") {
            newOverrides.leadingPt = merged.leadingPt * scale
          }
          // Aplica scale tambem nos styles per-char (cada char com fontSize override
          // tambem precisa escalar pra preservar proporcoes).
          if (merged.styles && typeof merged.styles === "object") {
            const newStyles: any = {}
            for (const lineKey of Object.keys(merged.styles)) {
              newStyles[lineKey] = {}
              for (const colKey of Object.keys(merged.styles[lineKey])) {
                const cs = { ...merged.styles[lineKey][colKey] }
                if (typeof cs.fontSize === "number") cs.fontSize = cs.fontSize * scale
                newStyles[lineKey][colKey] = cs
              }
            }
            newOverrides.styles = newStyles
          }
          return {
            ...base,
            scaleX: 1,
            scaleY: 1,
            width: Math.round((l.width ?? 400) * scale),
            height: Math.round((l.height ?? 100) * scale),
            overrides: newOverrides,
          }
        }

        // IMAGEM (e qualquer nao-texto): scale fica em scaleX/scaleY (raster nao consolida)
        return {
          ...base,
          scaleX: (l.scaleX ?? 1) * scale,
          scaleY: (l.scaleY ?? 1) * scale,
          width: l.width ?? 400,
          height: l.height ?? 100,
          overrides: { ...ov },
        }
      })

      // Cria a peca com NOVO formato: layers + dimensoes + bgColor + bgLayers
      const pieceData: any = {
        version: 2,  // marca novo formato
        width: f.width,
        height: f.height,
        // bgColor legacy (string) — mantido pra back-compat com pieces antigas
        bgColor: matrixBgColor,
        bgOpacity: matrixBgOpacity,
        // bgLayers (V7): preserva gradient/image/solid completos da matriz.
        // editor reconstroi os Rects de BG a partir desse array no load.
        ...(matrixBgLayers ? { bgLayers: matrixBgLayers } : {}),
        layers: pieceLayers,
        format: f.format,
        dpi: f.dpi,
        sourceWidth: matrixW,
        sourceHeight: matrixH,
      }

      const res = await fetch("/api/pieces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          name: `${f.vehicle} — ${f.format}`,
          mediaFormatId: f.id,
          data: pieceData,
          status: "STANDBY",
        }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        console.error(`[generate] POST /api/pieces falhou pra "${f.vehicle} — ${f.format}":`, res.status, txt)
        failures.push(`${f.vehicle} — ${f.format} (HTTP ${res.status})`)
        continue
      }
      const piece = await res.json()
      if (!piece?.id) {
        console.error(`[generate] resposta sem id pra "${f.vehicle} — ${f.format}":`, piece)
        failures.push(`${f.vehicle} — ${f.format} (sem id)`)
        continue
      }

      // Gera thumbnail no tamanho/proporcao da peca
      const thumb = await renderPieceThumb(fc, f.width, f.height, matrixW, matrixH)
      if (!thumb) {
        console.warn(`[generate] thumbnail falhou pra "${f.vehicle} — ${f.format}" — peça criada sem preview`)
        failures.push(`${f.vehicle} — ${f.format} (thumb null)`)
        continue
      }
      const fd = new FormData()
      fd.append("thumbnail", thumb, "thumb.jpg")
      const thRes = await fetch(`/api/pieces/${piece.id}/thumbnail`, { method: "POST", body: fd })
      if (!thRes.ok) {
        const txt = await thRes.text().catch(() => "")
        console.error(`[generate] upload thumb falhou pra "${f.vehicle} — ${f.format}":`, thRes.status, txt)
        failures.push(`${f.vehicle} — ${f.format} (upload thumb HTTP ${thRes.status})`)
      }
    }

    setGenerating(false)
    setProgress("")
    if (failures.length > 0) {
      alert(`Geração concluiu com ${failures.length} falha(s):\n\n${failures.join("\n")}\n\nVer browser console pra detalhes.`)
    }
    onGenerated()
  }

  // Agrupa formatos dinamicamente por valores unicos de category.
  // Formatos sem categoria caem em "Sem categoria".
  const categoryGroups = formats.reduce<Record<string, MediaFormat[]>>((acc, f) => {
    const k = f.category || "Sem categoria"
    if (!acc[k]) acc[k] = []
    acc[k].push(f)
    return acc
  }, {})
  const categoryNames = Object.keys(categoryGroups).sort()

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
      <div className="bg-[#1a1a1a] rounded-xl w-[560px] max-h-[80vh] flex flex-col border border-[#333333]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#333333]">
          <span className="font-bold text-white text-base">Selecionar formatos</span>
          <button onClick={onClose} className="text-[#555555] hover:text-white bg-transparent border-0 text-xl cursor-pointer">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {loading ? (
            <div className="text-center py-8 text-[#555555]">Carregando formatos...</div>
          ) : categoryNames.length === 0 ? (
            <div className="text-center py-8 text-[#555555]">Nenhum formato cadastrado.</div>
          ) : (
            <>
              {categoryNames.map((cat) => {
                const data = categoryGroups[cat]
                return (
                <div key={cat} className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#555555]">{cat}</span>
                    <button onClick={() => toggleAll(cat)} className="text-xs text-[#F5C400] bg-transparent border-0 cursor-pointer">
                      {data.every(f => selected.includes(f.id)) ? "Desmarcar todos" : "Selecionar todos"}
                    </button>
                  </div>
                  {data.map(f => (
                    <label key={f.id} className="flex items-center gap-3 py-2.5 border-b border-[#2a2a2a] cursor-pointer hover:bg-white/5 -mx-2 px-2 rounded">
                      <input type="checkbox" checked={isSelected(f.id)} onChange={() => toggle(f.id)} className="w-4 h-4 cursor-pointer" />
                      <span className="text-sm text-white flex-1">{f.vehicle} — {f.format}</span>
                      <span className="text-xs text-[#555555]">{f.width}×{f.height}</span>
                    </label>
                  ))}
                </div>
                )
              })}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#333333] flex justify-between items-center">
          <span className="text-xs text-[#555555]">{generating ? progress : `${selected.length} formato(s) selecionado(s)`}</span>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={onClose} className="text-[#888888]">Cancelar</Button>
            <Button onClick={generate} loading={generating} disabled={selected.length === 0}>
              Gerar {selected.length > 0 ? `${selected.length} ` : ""}peças
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
