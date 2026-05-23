/**
 * fabricLineHeight — conversao entre leadingPt (Adobe/PSD, absoluto em
 * pontos baseline-to-baseline) e Fabric Textbox.lineHeight (multiplier).
 *
 * ABORDAGEM (2026-05-23, sem gambiarras):
 *
 * Fabric calcula distancia entre baselines (em _renderTextCommon line 19651):
 *   baselineN = top + sum(getHeightOfLine(0..N-1)) + getHeightOfLineImpl(N)
 *   distancia(baselineN → baselineN+1) = getHeightOfLine(N)
 *   getHeightOfLine(i) = getHeightOfLineImpl(i) × this.lineHeight
 *   getHeightOfLineImpl(i) = maxFontSize(i) × this._fontSizeMult
 *
 * Pra match exato com Photoshop (leadingPt = distancia baseline-to-baseline):
 *   leadingPt = fontSize × _fontSizeMult × lineHeight
 *   ⇒ lineHeight = leadingPt / (fontSize × _fontSizeMult)
 *
 * PROBLEMA: `_fontSizeMult` eh hardcoded 1.13 mas Fabric internamente pode
 * ajustar (per-line maxHeight quando ha font mixto, etc). Em vez de assumir
 * a constante, MEDIMOS em runtime: setamos lineHeight=1, lemos
 * getHeightOfLine(0), descobrimos o factor REAL.
 *
 * Funcoes:
 *   - leadingPtToFabricLineHeight(leadingPt, fontSize): fast path com 1.13.
 *     Use quando ainda nao tem o obj Fabric construido (load inicial).
 *   - applyLeadingPtToFabric(obj, leadingPt): MEDE o factor real no obj e
 *     aplica lineHeight matematicamente correto. Use no editor depois que
 *     obj.initDimensions() ja foi chamada.
 */

/** Multiplier default do Fabric Textbox (`_fontSizeMult` em node_modules/fabric).
 *  Usado no fast path; quando possivel, prefira applyLeadingPtToFabric() que
 *  mede em runtime e funciona mesmo se Fabric mudar a constante. */
export const FABRIC_FONT_SIZE_MULT = 1.13

/** Fast path: lineHeight = leadingPt / (fontSize × 1.13). Use quando obj
 *  Fabric ainda nao existe (load inicial, exports). Resultado eh aproximado
 *  — se Fabric tem fator diferente do default, fica off por ~1%. */
export function leadingPtToFabricLineHeight(leadingPt: number, fontSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 1.0
  if (!Number.isFinite(leadingPt) || leadingPt <= 0) return 1.0
  return leadingPt / (fontSize * FABRIC_FONT_SIZE_MULT)
}

/** Inverso: Fabric Textbox.lineHeight (multiplier) → leadingPt (PSD pontos). */
export function fabricLineHeightToLeadingPt(lineHeight: number, fontSize: number): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 0
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0
  return lineHeight * fontSize * FABRIC_FONT_SIZE_MULT
}

/**
 * Aplica leadingPt num Fabric Textbox medindo o factor REAL em runtime
 * (em vez de assumir constante 1.13). Garante match EXATO com Photoshop
 * baseline-to-baseline.
 *
 * Algoritmo:
 *  1. Salva lineHeight atual
 *  2. Set lineHeight=1, recalcula → mede getHeightOfLine(0) = factor real × fs
 *  3. Set lineHeight = leadingPt / refHeight (matematicamente exato)
 *
 * Usa try/catch porque Fabric pode lancar quando textbox nao tem texto.
 * Fallback: usa leadingPtToFabricLineHeight (fast path).
 */
export function applyLeadingPtToFabric(obj: any, leadingPt: number): void {
  if (!obj) return
  const fs = obj.fontSize
  if (!Number.isFinite(fs) || fs <= 0) return
  if (!Number.isFinite(leadingPt) || leadingPt <= 0) return
  try {
    // Salva e seta lineHeight=1 pra medir factor real.
    if (typeof obj.getHeightOfLine !== "function") {
      obj.set("lineHeight", leadingPtToFabricLineHeight(leadingPt, fs))
      return
    }
    obj.set("lineHeight", 1)
    if (typeof obj.initDimensions === "function") obj.initDimensions()
    // getHeightOfLine(0) com lineHeight=1 retorna getHeightOfLineImpl(0)
    // = maxFontSize × _fontSizeMult (factor real do Fabric naquela linha).
    const refHeight = obj.getHeightOfLine(0)
    if (!Number.isFinite(refHeight) || refHeight <= 0) {
      obj.set("lineHeight", leadingPtToFabricLineHeight(leadingPt, fs))
      return
    }
    // lineHeight tal que: refHeight × lineHeight = leadingPt
    obj.set("lineHeight", leadingPt / refHeight)
    if (typeof obj.initDimensions === "function") obj.initDimensions()
  } catch {
    // Fallback fast path.
    obj.set("lineHeight", leadingPtToFabricLineHeight(leadingPt, fs))
  }
}
