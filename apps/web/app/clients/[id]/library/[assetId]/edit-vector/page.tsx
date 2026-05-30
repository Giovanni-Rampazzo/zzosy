"use client"
/**
 * Sub-editor vetorial pra SMART_OBJECT importado de .ai/.pdf.
 *
 * Fluxo:
 *  1. Carrega asset.smartObject.filePath (bytes originais do .ai/.pdf)
 *  2. pdfjs v3 (browser) → SVGGraphics → SVG string
 *  3. fabric.loadSVGFromString → paths editaveis no Canvas
 *  4. Toolbar simples: fill color, stroke color, delete, save
 *  5. Save: canvas.toDataURL("image/png") → POST como composite atualizado
 *     no asset.imageUrl (original .ai intacto pra re-edicao)
 *
 * V1 (esta entrega): paths editaveis. Texto entra como shape (sem char-level).
 * V2 (proximo turno): texto editavel via getTextContent + Fabric.Textbox overlay.
 *
 * License note: pdfjs-dist v3.11 (Apache 2.0). v4 removeu SVGGraphics;
 * alternativas server-side (mupdf) sao AGPL. v3 browser-side resolve.
 */
import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import * as fabric from "fabric"
import TopNav from "@/components/TopNav"
import { Button } from "@/components/ui/Button"

// pdfjs v3.11.174 carregado via CDN no client. Razao: o pacote NPM so tem
// build UMD (sem .mjs), e Next 16 + Turbopack tem atrito empacotando UMD
// pro client bundle. CDN com script tag bypassa o bundler — pdfjsLib fica
// disponivel no window. cdnjs.cloudflare hosta a mesma versao 3.11.174.
const PDFJS_VERSION = "3.11.174"
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`
let _pdfjsPromise: Promise<any> | null = null
function loadPdfjsFromCDN(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("client-only"))
  if ((window as any).pdfjsLib) return Promise.resolve((window as any).pdfjsLib)
  if (_pdfjsPromise) return _pdfjsPromise
  _pdfjsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = `${PDFJS_BASE}/pdf.min.js`
    script.onload = () => {
      const lib = (window as any).pdfjsLib
      if (!lib) { reject(new Error("pdfjsLib nao foi exposto no window")); return }
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`
      resolve(lib)
    }
    script.onerror = () => reject(new Error("Falha ao carregar pdf.js do CDN"))
    document.head.appendChild(script)
  })
  return _pdfjsPromise
}

type Asset = {
  id: string
  name: string
  type: string
  imageUrl: string | null
  smartObject?: { filePath: string; mime: string; width: number | null; height: number | null } | null
}

export default function EditVectorPage() {
  const params = useParams<{ id: string; assetId: string }>()
  const clientId = params.id
  const assetId = params.assetId
  const router = useRouter()
  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")
  const [phaseMsg, setPhaseMsg] = useState<string>("Carregando asset...")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selFill, setSelFill] = useState<string>("#000000")
  const [selCount, setSelCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        // 1. Load asset metadata (single GET route inclui smartObject)
        setPhaseMsg("Carregando asset...")
        const aRes = await fetch(`/api/clients/${clientId}/library/assets/${assetId}`)
        if (!aRes.ok) throw new Error("Asset nao encontrado")
        const a: Asset = await aRes.json()
        if (cancelled) return
        setAsset(a)

        if (a.type !== "SMART_OBJECT" || !a.smartObject?.filePath) {
          throw new Error("Asset nao tem arquivo vetorial (precisa ser SMART_OBJECT importado de .ai/.pdf)")
        }
        const isAi = a.smartObject.mime === "application/postscript"
        const isPdf = a.smartObject.mime === "application/pdf"
        if (!isAi && !isPdf) {
          throw new Error(`Mime nao suportado: ${a.smartObject.mime}`)
        }

        // 2. Fetch bytes do .ai/.pdf
        setPhaseMsg("Baixando arquivo original...")
        const fileRes = await fetch(a.smartObject.filePath)
        if (!fileRes.ok) throw new Error("Falha ao baixar arquivo original")
        const buf = await fileRes.arrayBuffer()
        if (cancelled) return

        // 3. Load pdfjs v3 via CDN (UMD direto no window — evita atrito
        // UMD-em-ESM do bundle client do Next 16/Turbopack quando importa
        // pdfjs-dist em await import()). Workersrc real (nao string vazia)
        // + disableWorker como cinto-suspensorio.
        setPhaseMsg("Convertendo pra SVG...")
        const pdfjs = await loadPdfjsFromCDN()
        const doc = await pdfjs.getDocument({
          data: new Uint8Array(buf),
          disableWorker: true,
          useSystemFonts: true,
          stopAtErrors: false,
        }).promise
        if (cancelled) return

        const page = await doc.getPage(1)
        const viewport = page.getViewport({ scale: 1 })
        const opList = await page.getOperatorList()
        const svgGfx = new pdfjs.SVGGraphics(page.commonObjs, page.objs, true)
        const svgElement = await svgGfx.getSVG(opList, viewport) as SVGElement
        const svgString = new XMLSerializer().serializeToString(svgElement)
        if (cancelled) return

        // 4. Init Fabric canvas
        setPhaseMsg("Carregando no editor...")
        if (!canvasElRef.current) throw new Error("Canvas nao inicializado")
        const width = Math.ceil(viewport.width)
        const height = Math.ceil(viewport.height)
        const canvas = new fabric.Canvas(canvasElRef.current, {
          width,
          height,
          backgroundColor: "white",
          preserveObjectStacking: true,
        })
        fabricRef.current = canvas

        // 5. Load SVG into Fabric (v6/v7 API: loadSVGFromString eh async, retorna {objects})
        const parsed = await fabric.loadSVGFromString(svgString)
        const objs = (parsed.objects.filter(Boolean) as unknown) as fabric.FabricObject[]
        for (const obj of objs) {
          canvas.add(obj)
        }
        canvas.renderAll()

        // 6. Wire selection events
        canvas.on("selection:created", e => {
          const sel = e.selected ?? []
          setSelCount(sel.length)
          const firstFill = sel[0] ? (sel[0].get("fill") as string) : ""
          if (firstFill && typeof firstFill === "string") setSelFill(firstFill)
        })
        canvas.on("selection:updated", e => {
          const sel = e.selected ?? canvas.getActiveObjects()
          setSelCount(sel.length)
          const firstFill = sel[0] ? (sel[0].get("fill") as string) : ""
          if (firstFill && typeof firstFill === "string") setSelFill(firstFill)
        })
        canvas.on("selection:cleared", () => setSelCount(0))

        if (cancelled) {
          canvas.dispose()
          return
        }
        setPhase("ready")
      } catch (e: any) {
        if (cancelled) return
        console.error("[edit-vector]", e)
        setError(e?.message ?? "Erro desconhecido")
        setPhase("error")
      }
    }

    init()
    return () => {
      cancelled = true
      try { fabricRef.current?.dispose() } catch {}
      fabricRef.current = null
    }
  }, [clientId, assetId])

  function applyFillToSelection(color: string) {
    setSelFill(color)
    const canvas = fabricRef.current
    if (!canvas) return
    const active = canvas.getActiveObjects()
    active.forEach(o => o.set({ fill: color }))
    canvas.renderAll()
  }

  function deleteSelected() {
    const canvas = fabricRef.current
    if (!canvas) return
    const active = canvas.getActiveObjects()
    active.forEach(o => canvas.remove(o))
    canvas.discardActiveObject()
    canvas.renderAll()
    setSelCount(0)
  }

  async function save() {
    const canvas = fabricRef.current
    if (!canvas) return
    setSaving(true)
    try {
      // Guard fonts antes do toDataURL (sweep 2026-05-30).
      const { awaitFontsReadyAndRender } = await import("@/lib/awaitFontsReady")
      await awaitFontsReadyAndRender(canvas)
      // Re-render composite at 2x pra fidelidade no preview do library.
      const dataUrl = canvas.toDataURL({ format: "png", multiplier: 2 })
      // dataUrl → Blob → multipart "image" pra rota existente.
      const blob = await (await fetch(dataUrl)).blob()
      const fd = new FormData()
      fd.append("image", blob, `${asset?.name ?? "composite"}.png`)
      const res = await fetch(`/api/clients/${clientId}/library/assets/${assetId}/image`, {
        method: "POST",
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        alert("Falha ao salvar: " + (err.error ?? res.status))
        return
      }
      router.push(`/clients/${clientId}/library`)
    } catch (e: any) {
      alert("Erro: " + (e?.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "var(--zz-bg-page)" }}>
      <TopNav />
      <div style={{
        maxWidth: "var(--zz-page-max-w)",
        margin: "0 auto",
        padding: "var(--zz-page-pad-y) var(--zz-page-pad-x) var(--zz-page-pad-bottom)",
      }}>
        {/* Linha NAVEGACAO (CLAUDE 1.2): Voltar isolado. */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 16 }}>
          <Button variant="primary" size="md" onClick={() => router.push(`/clients/${clientId}/library`)}>← Library</Button>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>
            {asset?.name ?? "Editar vetor"}
          </div>
        </div>

        {/* Layout 3-col ENTRADAS/canvas/SAIDAS (CLAUDE 1.10). */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 240px) 1fr minmax(200px, 240px)", gap: 14, alignItems: "start" }}>

          {/* ENTRADAS: info do asset (read-only) */}
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: "12px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 1, marginBottom: 10 }}>ORIGEM</div>
            {asset?.smartObject ? (
              <div style={{ fontSize: 12, color: "#555", display: "flex", flexDirection: "column", gap: 6 }}>
                <div><strong>Tipo:</strong> {asset.smartObject.mime === "application/postscript" ? "Illustrator (.ai)" : "PDF"}</div>
                <div><strong>Tamanho:</strong> {asset.smartObject.width}×{asset.smartObject.height}px</div>
                <Button variant="secondary" size="sm" onClick={() => asset.smartObject && window.open(asset.smartObject.filePath, "_blank")} title="Baixar arquivo original">
                  Baixar original
                </Button>
              </div>
            ) : <div style={{ fontSize: 12, color: "#888" }}>—</div>}
          </div>

          {/* CANVAS */}
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: 16, minHeight: 400 }}>
            {phase === "loading" && (
              <div style={{ minHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#888", fontSize: 13 }}>
                {phaseMsg}
              </div>
            )}
            {phase === "error" && (
              <div style={{ minHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", fontSize: 13, textAlign: "center", padding: 24 }}>
                {error}
              </div>
            )}
            <div style={{ display: phase === "ready" ? "block" : "none", overflow: "auto" }}>
              <canvas ref={canvasElRef} />
            </div>
          </div>

          {/* SAIDAS: toolbar de edicao + salvar */}
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #E0E0E0", padding: "12px 16px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#888", letterSpacing: 1, marginBottom: 10 }}>EDITAR</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 11, color: "#888" }}>
                {selCount === 0 ? "Clique num path pra editar" : `${selCount} selecionado(s)`}
              </div>
              <label style={{ fontSize: 11, color: "#555", display: "flex", flexDirection: "column", gap: 4 }}>
                Cor de preenchimento
                <input
                  type="color"
                  value={selFill}
                  disabled={selCount === 0}
                  onChange={e => applyFillToSelection(e.target.value)}
                  style={{ width: "100%", height: 32, border: "1px solid #E0E0E0", borderRadius: 6, cursor: selCount === 0 ? "not-allowed" : "pointer" }}
                />
              </label>
              <Button variant="danger" size="sm" disabled={selCount === 0} onClick={deleteSelected}>
                Apagar selecionado
              </Button>
              <div style={{ borderTop: "1px solid #F0F0F0", margin: "6px 0" }} />
              <Button variant="primary" size="md" disabled={phase !== "ready" || saving} loading={saving} onClick={save}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
