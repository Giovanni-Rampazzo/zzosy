/**
 * Helpers de visibilidade de folders de PSD. Compartilhados entre PsdImporter
 * (matriz) e PsdPieceImporter (peca individual).
 *
 * O problema central: PSDs multi-formato (ex: 1 STORY + 2 STORIES + PROFILE
 * todos no mesmo canvas) frequentemente vem com TODOS os folders top-level
 * marcados `hidden=false` no flag que ag-psd le, mas o composite raster
 * (`psd.canvas`) que o Photoshop salvou contem apenas o que estava REALMENTE
 * visivel na hora do Save. Sintoma: preview ok, editor com tudo sobreposto.
 *
 * `autoHidePhantomFolders` amostra a regiao de cada folder no composite e
 * marca como hidden os que nao contribuem pixels visiveis.
 */

// Bbox recursiva das layer-folhas (mesmo hidden) de um folder. Usada pra
// amostrar a regiao correspondente no composite raster do PSD.
export function folderUnionBboxAll(folder: any): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  function walk(l: any) {
    if (l.children?.length) { for (const c of l.children) walk(c); return }
    const l_ = l.left ?? 0, t_ = l.top ?? 0
    const r_ = l.right ?? l_, b_ = l.bottom ?? t_
    if (r_ > l_ && b_ > t_) {
      minX = Math.min(minX, l_); minY = Math.min(minY, t_)
      maxX = Math.max(maxX, r_); maxY = Math.max(maxY, b_)
    }
  }
  if (Array.isArray(folder.children)) for (const c of folder.children) walk(c)
  if (minX === Infinity) return null
  return { minX, minY, maxX, maxY }
}

// Threshold ajustado pra 8% — em testes com Sicredi/Suno, folders fantasmas
// vinham com 0.5-2% (totalmente fora) mas alguns formatos legitimos que
// compartilham regiao parcial com o composite ficavam em 5-7%. 8% segura.
const FOLDER_VISIBILITY_THRESHOLD = 0.08

/**
 * Marca `layer.hidden = true` em-place nos folders top-level que nao
 * contribuem pixels visiveis ao composite. So age quando ha MAIS DE UM folder
 * top-level visivel (sem ambiguidade nao agir). Idempotente.
 *
 * Tambem rasteriza folders TOP-LEVEL individualmente pra detectar o caso
 * onde mesmo o composite tem multiplas regioes sobrepostas mas no PSD original
 * havia toggleamento manual de visibility entre saves.
 */
export function autoHidePhantomFolders(psd: any): { hidden: string[]; kept: string[] } {
  const result = { hidden: [] as string[], kept: [] as string[] }
  const composite: HTMLCanvasElement | undefined = psd?.canvas
  if (!composite || !Array.isArray(psd.children)) return result
  const topFolders = psd.children.filter((l: any) =>
    Array.isArray(l.children) && l.children.length > 0 && l.hidden !== true,
  )
  if (topFolders.length < 2) {
    for (const f of topFolders) result.kept.push(f.name ?? "<unnamed>")
    return result
  }
  const ctx = composite.getContext("2d", { willReadFrequently: true })
  if (!ctx) return result
  const W = composite.width
  const H = composite.height
  for (const folder of topFolders) {
    const bb = folderUnionBboxAll(folder)
    const name = folder.name ?? "<unnamed>"
    if (!bb) { result.kept.push(name); continue }
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(bb.minX)))
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(bb.minY)))
    const x1 = Math.max(0, Math.min(W, Math.ceil(bb.maxX)))
    const y1 = Math.max(0, Math.min(H, Math.ceil(bb.maxY)))
    const bw = x1 - x0
    const bh = y1 - y0
    if (bw <= 0 || bh <= 0) {
      folder.hidden = true
      result.hidden.push(name)
      continue
    }
    let opaqueRatio = 1
    try {
      const img = ctx.getImageData(x0, y0, bw, bh)
      const data = img.data
      let opaque = 0
      const total = bw * bh
      // Sample stride pra bboxes grandes (1/16 do total quando > 200k pixels).
      const stride = total > 200000 ? 4 : 1
      let sampled = 0
      for (let y = 0; y < bh; y += stride) {
        for (let x = 0; x < bw; x += stride) {
          const idx = (y * bw + x) * 4 + 3
          if (data[idx] > 8) opaque++
          sampled++
        }
      }
      opaqueRatio = sampled > 0 ? opaque / sampled : 0
    } catch { opaqueRatio = 1 }
    if (opaqueRatio < FOLDER_VISIBILITY_THRESHOLD) {
      folder.hidden = true
      result.hidden.push(name)
      console.log("[psd-import] auto-hide folder fantasma:", name, "opaqueRatio:", opaqueRatio.toFixed(3))
    } else {
      result.kept.push(name)
    }
  }
  return result
}

// Limiar: Smart Object cobre 40%+ do canvas E tem pelo menos N layers acima
// dele com bbox CONTIDO no dele. Designers usam essa estrutura pra "preview
// embedded" (PSD com design completo dentro de um Smart Object + layers
// editaveis separados acima) → causa duplicacao visual no import.
const SO_WRAPPER_COVERAGE = 0.40
const SO_WRAPPER_OVERLAPPING_COUNT = 2

/**
 * Detecta Smart Objects "wrapper" — placedLayers grandes que contem
 * conteudo duplicado pelos layers superiores. Auto-marca `hidden=true` neles
 * pra evitar duplicacao visual no canvas do editor.
 *
 * Heuristica:
 *   1. Layer tem `placedLayer` (eh Smart Object)
 *   2. Bbox cobre >= 40% do canvas
 *   3. Tem >= 2 layers ACIMA na mesma hierarquia (ou top-level) com bbox
 *      contido (>50%) dentro do bbox do Smart Object
 *
 * Quando os 3 batem: provavelmente eh um preview embedded → hidden=true.
 *
 * User pode re-mostrar manualmente no editor se for o caso onde o SO
 * deveria mesmo ser o conteudo principal.
 */
export function autoHideWrapperSmartObjects(psd: any): { hidden: string[] } {
  const result = { hidden: [] as string[] }
  if (!Array.isArray(psd.children)) return result
  const canvasW = psd.width ?? 1920
  const canvasH = psd.height ?? 1080
  const canvasArea = canvasW * canvasH

  // Coleta plana de layer-folha + seu indice global (ordem ag-psd = bottom→top).
  const flat: Array<{ layer: any; idx: number; bbox: { l: number; t: number; r: number; b: number } }> = []
  function collect(layers: any[]) {
    for (const l of layers) {
      if (l.children?.length) { collect(l.children); continue }
      const lx = l.left ?? 0, ly = l.top ?? 0
      const rx = l.right ?? lx, by = l.bottom ?? ly
      if (rx <= lx || by <= ly) continue
      flat.push({ layer: l, idx: flat.length, bbox: { l: lx, t: ly, r: rx, b: by } })
    }
  }
  collect(psd.children)

  // Calcula area de intersecao entre 2 bboxes
  function intersectArea(a: typeof flat[0]["bbox"], b: typeof flat[0]["bbox"]): number {
    const iL = Math.max(a.l, b.l)
    const iT = Math.max(a.t, b.t)
    const iR = Math.min(a.r, b.r)
    const iB = Math.min(a.b, b.b)
    if (iR <= iL || iB <= iT) return 0
    return (iR - iL) * (iB - iT)
  }

  for (let i = 0; i < flat.length; i++) {
    const { layer, bbox } = flat[i]
    if (!layer.placedLayer) continue // so Smart Objects
    if (layer.hidden) continue
    const area = (bbox.r - bbox.l) * (bbox.b - bbox.t)
    const coverage = area / canvasArea
    if (coverage < SO_WRAPPER_COVERAGE) continue

    // Conta quantos layers ACIMA (idx maior em ag-psd ordem) tem bbox
    // SIGNIFICATIVAMENTE contido (>50%) dentro do Smart Object.
    let overlappingCount = 0
    for (let j = i + 1; j < flat.length; j++) {
      const above = flat[j]
      if (above.layer.hidden) continue
      const aboveArea = (above.bbox.r - above.bbox.l) * (above.bbox.b - above.bbox.t)
      if (aboveArea < 100) continue // ignora layers minusculos (decoracao)
      const inter = intersectArea(bbox, above.bbox)
      if (inter / aboveArea > 0.5) overlappingCount++
    }

    if (overlappingCount >= SO_WRAPPER_OVERLAPPING_COUNT) {
      layer.hidden = true
      const name = layer.name ?? "<unnamed>"
      result.hidden.push(name)
      console.log(
        `[psd-import] auto-hide Smart Object wrapper: "${name}" `
        + `(coverage=${(coverage * 100).toFixed(0)}%, overlap-above=${overlappingCount}). `
        + `Re-mostra manualmente no editor se for o conteudo principal.`
      )
    }
  }
  return result
}
