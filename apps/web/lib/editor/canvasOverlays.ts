// Helpers de canvas/overlay (mask compose + bleed overlays) — extraidos de
// KeyVisionEditor.tsx (2026-05-28). Puros, dependem de Canvas API + Fabric
// module passado como arg.

/**
 * Props customizadas (alem das nativas do Fabric) que precisam entrar em
 * TODO snapshot do undo stack. Centralizado pra evitar drift entre os 3
 * sites que chamam toObject(...) (pushHistory, brand-sync re-snap, save
 * pre-undo) — adicionar prop nova = 1 linha aqui, propaga pra todos.
 *
 * Sem isso, undo "perdia" props sutilmente: novo override adicionado em
 * applyStyle (ex: cornerRadius, __shapeKind) so vai pro snap se estiver
 * nessa lista.
 */
export const HISTORY_PROPS_TO_INCLUDE = [
  "__assetId", "__assetLabel", "__isBg", "__isImage", "__maskData",
  "__clippingMask", "__embedded", "imageDataUrl", "__hidden", "__locked",
  "__fillBrandIdx", "__psdEffects", "__psdNameSource", "__groupPath",
  "__isSmartObject", "__smartObjectGuid", "__smartObjectMime",
  "__smartObjectFilePath", "__smartObjectOriginalName",
  "styles", "leadingPt", "lineHeight", "charSpacing",
  "__psdShapeType", "__psdBoxBounds",
  "__paragraphSpaceAfter", "__psdParagraphSpaceAfter",
  "__isShape", "__shapeKind", "__cornerRadius", "__pathBbox",
  // stroke position visual hack: __strokePosition = inside|center|outside
  // (user pref) + __naturalStrokeWidth = valor cru antes do hack dobrar.
  "__strokePosition", "__naturalStrokeWidth",
]

/**
 * Pre-compoe uma raster mask DENTRO de uma imagem fonte. Fabric v6 renderiza
 * Image clipPath como silhueta solida (fill=black) — ignora alpha do PNG da
 * mask. A unica forma de obter alpha-mask real eh aplicar a mascara no
 * BITMAP antes de criar a FabricImage.
 *
 * @param sourceImg HTMLImageElement com a imagem do asset (ja carregada)
 * @param maskRaster { dataUrl, posX, posY, width, height } — em canvas coords
 * @param assetPosX/Y posicao do asset no canvas (pra calcular offset relativo)
 * @param assetW/H dimensoes naturais do asset
 * @param inverted se true, inverte o alpha (mascara mostra o oposto)
 * @param scaleX/scaleY scale do layer no canvas. maskRaster esta em CANVAS-SPACE
 *        e a imagem natural em IMAGE-NATURAL-SPACE; ratio=1/scale converte.
 * @returns HTMLCanvasElement com o asset mascarado, ou null em caso de erro
 */
export async function composeRasterMaskIntoImage(
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
  canvas.width = assetW
  canvas.height = assetH
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  ctx.drawImage(sourceImg, 0, 0, assetW, assetH)

  // 'destination-in': keeps destination (asset) where mask is opaque.
  // 'destination-out' (inverted): removes destination where mask is opaque.
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

/**
 * Cria 4 retangulos overlay que mascaram TUDO fora da peca dentro do
 * canvas visivel. A peca (cw x ch) renderiza centralizada no canvas;
 * os overlays cobrem a area cinza/escura ao redor.
 *
 * Marca cada overlay com __isBleedOverlay = true e excludeFromExport=true.
 * Filtros em refreshLayers, save, undo, etc usam essa flag pra ignorar.
 */
export function createBleedOverlays(fc: any, Rect: any, cw: number, ch: number, fullW: number, fullH: number, z: number) {
  const BLEED_FILL = "#1e1e1e"
  const worldW = fullW / z
  const worldH = fullH / z
  const offsetX = (fullW - cw * z) / 2
  const offsetY = (fullH - ch * z) / 2
  const worldLeft = -offsetX / z
  const worldTop = -offsetY / z
  const worldRight = worldLeft + worldW
  const worldBottom = worldTop + worldH

  // CRITICO: em zoom > 100% com peca > canvas DOM, offsetX vira negativo
  // → worldLeft vira positivo (peca extrapola o canvas DOM). Os overlays
  // passariam a ter width/height NEGATIVO. Pula a criacao quando overlay
  // nao se aplica.
  const overlaysConfig: Array<{ left: number; top: number; width: number; height: number }> = []
  if (worldTop < 0) {
    overlaysConfig.push({ left: worldLeft, top: worldTop, width: worldW, height: -worldTop })
  }
  if (worldBottom > ch) {
    overlaysConfig.push({ left: worldLeft, top: ch, width: worldW, height: worldBottom - ch })
  }
  if (worldLeft < 0) {
    overlaysConfig.push({ left: worldLeft, top: 0, width: -worldLeft, height: ch })
  }
  if (worldRight > cw) {
    overlaysConfig.push({ left: cw, top: 0, width: worldRight - cw, height: ch })
  }
  const overlays: any[] = []
  for (const cfg of overlaysConfig) {
    if (cfg.width <= 0 || cfg.height <= 0) continue
    const o = new Rect(cfg)
    o.set({
      fill: BLEED_FILL,
      selectable: false, evented: false, excludeFromExport: true,
      hoverCursor: "default",
    })
    ;(o as any).__isBleedOverlay = true
    fc.add(o)
    overlays.push(o)
  }
  for (const o of overlays) {
    try { (fc as any).bringObjectToFront ? (fc as any).bringObjectToFront(o) : fc.bringToFront(o) } catch {}
  }
  ;(fc as any).__bleedOverlays = overlays
  return overlays
}
