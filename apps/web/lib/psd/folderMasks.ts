/**
 * folderMasks — propaga mask de folders pros children (Adobe-fiel).
 *
 * Em Photoshop, folder pode ter mask propria. O composite final renderiza
 * o folder inteiro APENAS onde a mask de folder eh opaca. Equivalente:
 * intersecao da silhueta do folder com cada child do folder.
 *
 * Nosso modelo nao tem "folder composite layer" (Fabric.js nao tem grupo
 * que aplica mask coletivo). Solucao: propagamos a folder mask pra DENTRO
 * de cada child como inheritedMask, e intersectamos com a mask propria
 * (se houver) ao renderizar.
 *
 * Roda APOS resolveAllClippingChains, pra que clipping ja esteja resolved
 * em raster antes de intersectar com inheritedMask.
 */
import type { PsdDocument, PsdLayer, PsdGroupLayer, PsdMaskData, PsdRasterMask, PsdImageData } from "./types"

/**
 * Itera o documento propagando masks de folders pra cada layer filha.
 * Modifica `doc` in-place.
 *
 * Para cada folder com mask:
 *   1. Recursivamente desce em children
 *   2. Se child ja tem mask, intersecta (Adobe: AND de silhuetas)
 *   3. Se child nao tem mask, herda a do folder
 *
 * Nested folders empilham masks (intersecao cumulativa).
 *
 * IMPORTANTE: opera apenas em raster masks. Vector masks de folder serao
 * rasterizadas se precisar intersectar com raster — Fase 4.
 */
export async function propagateFolderMasks(doc: PsdDocument): Promise<{ propagated: number }> {
  let propagated = 0

  async function walk(layers: PsdLayer[], inheritedMask: PsdRasterMask | null) {
    for (const l of layers) {
      let nextInherited = inheritedMask

      if (l.type === "group") {
        // Folder com mask vira inherited pros children
        if (l.mask?.kind === "raster") {
          nextInherited = inheritedMask
            ? await intersectRasterMasks(inheritedMask, l.mask) ?? inheritedMask
            : l.mask
        }
        await walk(l.children, nextInherited)
        continue
      }

      // Layer-folha — aplica inheritedMask se houver
      if (inheritedMask) {
        if (!l.mask) {
          l.mask = inheritedMask
          propagated++
        } else if (l.mask.kind === "raster") {
          // Mask propria + folder mask → intersecta
          const merged = await intersectRasterMasks(l.mask, inheritedMask)
          if (merged) {
            l.mask = merged
            propagated++
          }
        }
        // Se l.mask.kind === "vector" ou "clipping" — deixa intacto. Vector
        // intersection com raster eh complexo (Fase 4); clipping ja foi
        // resolved em raster pela Fase 3.
      }
    }
  }

  await walk(doc.layers, null)
  return { propagated }
}

/**
 * Intersecta duas raster masks em-canvas (Adobe: AND multiplicativo).
 * Cria um novo PsdRasterMask cujo bbox cobre a UNIAO dos bboxes originais,
 * com pixels = min(a, b) — visivel APENAS onde ambas sao opacas.
 *
 * Sem isso, mask "vence" outra arbitrariamente.
 */
async function intersectRasterMasks(a: PsdRasterMask, b: PsdRasterMask): Promise<PsdRasterMask | null> {
  if (typeof document === "undefined") return null

  // bbox final = uniao
  const left = Math.min(a.bbox.left, b.bbox.left)
  const top = Math.min(a.bbox.top, b.bbox.top)
  const right = Math.max(a.bbox.right, b.bbox.right)
  const bottom = Math.max(a.bbox.bottom, b.bbox.bottom)
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) return null

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  // Render mask A no canvas, depois aplica B via globalCompositeOperation
  // "multiply" — visivel onde ambas sao opacas (intersecao multiplicativa).
  const aImg = await imageDataToImage(a.imageData)
  const bImg = await imageDataToImage(b.imageData)
  if (!aImg || !bImg) return null

  // Fill com defaultColor de A (fora do bbox de A)
  ctx.fillStyle = a.defaultColor === 255 ? "#ffffff" : "#000000"
  ctx.fillRect(0, 0, width, height)
  // Drawa A na sua posicao relativa
  ctx.drawImage(aImg, a.bbox.left - left, a.bbox.top - top, a.bbox.right - a.bbox.left, a.bbox.bottom - a.bbox.top)
  // Drawa B com multiply — intersecta
  ctx.globalCompositeOperation = "multiply"
  ctx.drawImage(bImg, b.bbox.left - left, b.bbox.top - top, b.bbox.right - b.bbox.left, b.bbox.bottom - b.bbox.top)
  ctx.globalCompositeOperation = "source-over"

  return {
    kind: "raster",
    imageData: {
      data: canvas.toDataURL("image/png"),
      width,
      height,
      format: "dataUrl",
    },
    bbox: { left, top, right, bottom },
    // Combined defaultColor: AND das duas (0 se qualquer for 0)
    defaultColor: (a.defaultColor === 0 || b.defaultColor === 0) ? 0 : 255,
    disabled: a.disabled || b.disabled,
    invert: false, // intersecao ja resolvida; nao herda invert
  }
}

function imageDataToImage(img: PsdImageData): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === "undefined" || img.format !== "dataUrl" || typeof img.data !== "string") {
      resolve(null); return
    }
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => resolve(null)
    el.src = img.data as string
  })
}
