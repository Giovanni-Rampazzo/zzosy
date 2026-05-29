/**
 * Helpers pra re-sincronizar refs de brand colors no editor.
 *
 * Extraido de KeyVisionEditor.tsx em 2026-05-29 (audit #5 — god component).
 * Sao funcoes puras (sem hooks/state); recebem dependencias como parametro.
 * Centralizar aqui:
 *   - facilita teste (input puro -> output puro)
 *   - reduz size de KeyVisionEditor.tsx
 *   - prepara terreno pra useBrandSync hook completo
 */
import type { BgLayerData } from "@/lib/editor/types"

export interface BrandColor {
  hex: string
  name?: string | null
}

/**
 * Re-sincroniza fill dos Textboxes que carregam __fillBrandIdx contra
 * brandColors atual. Retorna true se algum fill mudou (caller deve renderAll).
 */
export function syncBrandRefsInTextObjects(fc: any, brandColors: BrandColor[]): boolean {
  if (!fc) return false
  let changed = false
  for (const o of fc.getObjects()) {
    const bIdx = (o as any).__fillBrandIdx
    if (typeof bIdx !== "number") continue
    const live = brandColors[bIdx]
    if (!live || typeof live.hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) continue
    if (typeof o.fill === "string" && live.hex.toLowerCase() !== o.fill.toLowerCase()) {
      o.set("fill", live.hex)
      changed = true
    }
  }
  return changed
}

/**
 * Re-sincroniza cores SOLID dos bgLayers contra brandColors atual.
 * Muta `bgLayers` array (caller passa a ref atual).
 * Retorna true se alguma layer foi modificada (caller deve syncBgLayerToRect
 * + isDirty + setIsDirty).
 */
export function syncBrandRefsInBgLayers(bgLayers: BgLayerData[], brandColors: BrandColor[]): boolean {
  let changed = false
  for (let i = 0; i < bgLayers.length; i++) {
    const l = bgLayers[i]
    if (l.kind !== "solid" || typeof l.colorBrandIdx !== "number") continue
    const live = brandColors[l.colorBrandIdx]
    if (!live || typeof live.hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(live.hex)) continue
    if (live.hex.toLowerCase() !== l.color.toLowerCase()) {
      bgLayers[i] = { ...l, color: live.hex }
      changed = true
    }
  }
  return changed
}
