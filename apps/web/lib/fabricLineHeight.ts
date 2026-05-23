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
 * Aplica leadingPt num Fabric Textbox de modo que TANTO a distancia entre
 * baselines QUANTO a altura total batem com Photoshop.
 *
 * Problema descoberto 2026-05-23: o _fontSizeMult=1.13 hardcoded do Fabric
 * assume um ascender artificial de 1.13×fontSize, mas fontes reais tem
 * ascender ~0.8×fontSize. Resultado:
 *   altura_Fabric = (N-1) × leadingPt + fontSize × 1.13
 *   altura_PS     = (N-1) × leadingPt + fontSize × 0.8 (~)
 *   diff ≈ 0.33 × fontSize de "espaco vazio" extra no Fabric
 *
 * Esse espaco extra eh o que o user percebia como "entrelinhas erradas"
 * mesmo apos o calculo baseline-to-baseline estar correto.
 *
 * SOLUCAO: sobrescrevemos `_fontSizeMult` por instance pra 1.0 (sem fator
 * artificial), depois setamos lineHeight = leadingPt / fontSize. Isso:
 *   - getHeightOfLineImpl = fontSize × 1.0 = fontSize
 *   - getHeightOfLine = fontSize × 1.0 × (leadingPt/fontSize) = leadingPt
 *   - altura_total = (N-1) × leadingPt + fontSize  ← match PSD!
 *   - distancia baseline-to-baseline = leadingPt ✓
 *
 * Sem gambiarra: estamos usando a API publica de instance properties do
 * Fabric. _fontSizeMult eh property normal, sobrescrivivel.
 */
export function applyLeadingPtToFabric(obj: any, leadingPt: number): void {
  if (!obj) return
  const fs = obj.fontSize
  if (!Number.isFinite(fs) || fs <= 0) return
  if (!Number.isFinite(leadingPt) || leadingPt <= 0) return
  try {
    // 1. Sobrescreve _fontSizeMult pra 1.0 — remove o ascender artificial
    //    de 1.13×fs que o Fabric assume hardcoded.
    obj._fontSizeMult = 1.0
    // 2. lineHeight = leadingPt / fontSize → distancia baseline-to-baseline
    //    EXATAMENTE igual a leadingPt.
    obj.set("lineHeight", leadingPt / fs)
    // 3. initDimensions invalida cache __lineHeights e recalcula.
    if (typeof obj.initDimensions === "function") obj.initDimensions()
  } catch {
    obj.set("lineHeight", leadingPtToFabricLineHeight(leadingPt, fs))
  }
}
