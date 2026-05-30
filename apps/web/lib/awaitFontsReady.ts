/**
 * Aguarda document.fonts.ready + forca re-render do canvas Fabric ANTES
 * de qualquer serializacao (toDataURL/toBlob/toSVG).
 *
 * Por que: mesmo apos ensurePsdFontsReady + forceLoadFontFaces resolverem,
 * fonts.ready pode ainda estar "loading" (race: a promise do font load
 * resolveu mas o browser nao terminou de aplicar o @font-face no canvas
 * backing yet). Sem este guard, toDataURL captura o canvas RENDERIZADO
 * com fonte fallback — composite/thumb/export sai errado.
 *
 * Pattern: `forceLoadFontFaces` faz o trabalho pesado (sheet wait + load).
 * `awaitFontsReadyAndRender` eh cinto-suspensorio final: pega fonts em
 * flight ainda nao finalizadas + dispara 1 render frame antes do read.
 *
 * Sweep 2026-05-30 (user pediu): aplicado em todos os call sites Fabric
 * que serializam o canvas pra blob/url/svg (export PSD/PNG/JPG/PDF/SVG/IDML,
 * thumbs de step/regen, brand cascade, edit-vector save).
 */
import type { Canvas, StaticCanvas } from "fabric"

export async function awaitFontsReadyAndRender(fc: Canvas | StaticCanvas | null | undefined): Promise<void> {
  if (typeof document === "undefined") return
  try { await (document as any).fonts?.ready } catch { /* nao bloqueia se navegador sem fonts API */ }
  if (!fc) return
  try { fc.requestRenderAll?.() } catch {}
  // Aguarda 1 frame pra requestRenderAll efetivamente pintar o backing
  // canvas antes do toDataURL/toBlob/toSVG ler bytes.
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve())
    } else {
      setTimeout(resolve, 16)
    }
  })
}
