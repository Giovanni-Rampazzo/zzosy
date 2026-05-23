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
 * Inverso quando applyLeadingPtToFabric foi usado: lineHeight foi setado como
 * leadingPt/ascender, então leadingPt = lineHeight × ascender.
 * Usado no SAVE pra recuperar o leadingPt original.
 */
export function fabricLineHeightToLeadingPtAscender(
  lineHeight: number, fontSize: number, fontFamily?: string,
  fontWeight?: string | number, fontStyle?: string,
): number {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return 0
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return 0
  const asc = measureAscender(fontSize, fontFamily, fontWeight, fontStyle) ?? fontSize
  return lineHeight * asc
}

/** Cache de ascender por chave (size+family+weight+style) — evita recalcular
 *  cada call (medir TextMetrics tem custo nao-trivial). */
const _ascenderCache = new Map<string, number>()

/** Mede o ascender REAL da fonte via Canvas TextMetrics. Retorna em pixels
 *  (mesma unidade do fontSize passado). Retorna null se nao tiver document
 *  (SSR/Node) ou se a fonte nao tiver metrics disponiveis. */
export function measureAscender(
  fontSize: number, fontFamily?: string,
  fontWeight?: string | number, fontStyle?: string,
): number | null {
  if (typeof document === "undefined") return null
  if (!Number.isFinite(fontSize) || fontSize <= 0) return null
  const family = fontFamily || "Arial"
  const weight = fontWeight ?? "normal"
  const style = fontStyle || "normal"
  const key = `${fontSize}|${family}|${weight}|${style}`
  const cached = _ascenderCache.get(key)
  if (cached !== undefined) return cached
  try {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.font = `${style} ${weight} ${fontSize}px "${family}"`
    // Mede uma string com ascender E descender (M alto, g desce) pra forcar
    // o browser a expor fontBoundingBoxAscent (que eh o hhea.ascent, igual ao
    // que PS usa). actualBoundingBoxAscent varia por string — fontBoundingBox
    // eh fixo pela fonte.
    const m = ctx.measureText("Mg")
    const fontAsc = (m as any).fontBoundingBoxAscent
    if (Number.isFinite(fontAsc) && fontAsc > 0) {
      _ascenderCache.set(key, fontAsc)
      return fontAsc
    }
    // Fallback: actualBoundingBoxAscent (menos preciso)
    const actAsc = (m as any).actualBoundingBoxAscent
    if (Number.isFinite(actAsc) && actAsc > 0) {
      _ascenderCache.set(key, actAsc)
      return actAsc
    }
  } catch { /* ignora */ }
  return null
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
    // Matematica (PS standard):
    //   - distancia baseline-to-baseline = leadingPt
    //   - Y do baseline da linha 0 = top + ascender_real_da_fonte
    //   - Y do baseline da linha i = top + i×leadingPt + ascender
    //
    // Fabric (pre-fix):
    //   - getHeightOfLineImpl(i) = maxFontSize × _fontSizeMult
    //   - getHeightOfLine(i) = getHeightOfLineImpl(i) × lineHeight
    //   - baseline_0 = top + getHeightOfLineImpl(0)
    //   - baseline_i = top + sum(getHeightOfLine(0..i-1)) + getHeightOfLineImpl(i)
    //
    // Pra match: override getHeightOfLineImpl pra retornar ascender REAL
    // (TextMetrics.actualBoundingBoxAscent). Daí lineHeight = leadingPt/ascender.
    //   - baseline_0 = top + ascender ✓
    //   - getHeightOfLine(i) = ascender × (leadingPt/ascender) = leadingPt ✓
    //   - baseline_i = top + i×leadingPt + ascender ✓
    const ascender = measureAscender(fs, obj.fontFamily, obj.fontWeight, obj.fontStyle) ?? fs

    try {
      Object.defineProperty(obj, "_fontSizeMult", {
        value: 1.0,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    } catch {
      obj._fontSizeMult = 1.0
    }
    // Override no metodo da instance: retorna ascender por linha
    obj.getHeightOfLineImpl = function(lineIndex: number): number {
      if (!this.__lineHeights) this.__lineHeights = []
      const cached = this.__lineHeights[lineIndex]
      if (cached) return cached
      let maxFs = this.fontSize
      const line = this._textLines?.[lineIndex]
      if (Array.isArray(line) && typeof this.getHeightOfChar === "function") {
        for (let j = 0, len = line.length; j < len; j++) {
          const h = this.getHeightOfChar(lineIndex, j)
          if (h > maxFs) maxFs = h
        }
      }
      const asc = measureAscender(maxFs, this.fontFamily, this.fontWeight, this.fontStyle) ?? maxFs
      this.__lineHeights[lineIndex] = asc
      return asc
    }
    // lineHeight = leadingPt / ascender  →  getHeightOfLine = leadingPt
    obj.set("lineHeight", leadingPt / ascender)
    // 3. initDimensions invalida cache __lineHeights e recalcula.
    if (typeof obj.initDimensions === "function") obj.initDimensions()
    // 4. Diagnostico: loga valores reais pra detectar gaps. Apenas em dev.
    if (typeof window !== "undefined" && (window as any).__zzosyLeadingDebug !== false) {
      try {
        const impl = typeof obj.getHeightOfLineImpl === "function" ? obj.getHeightOfLineImpl(0) : null
        const full = typeof obj.getHeightOfLine === "function" ? obj.getHeightOfLine(0) : null
        // eslint-disable-next-line no-console
        console.log("[leading-apply]", {
          label: obj.__assetLabel ?? "?",
          fs, leadingPt,
          _fontSizeMult: obj._fontSizeMult,
          lineHeight: obj.lineHeight,
          getHeightOfLineImpl_0: impl,
          getHeightOfLine_0: full,
          match: full !== null ? Math.abs(full - leadingPt) < 0.01 : null,
        })
      } catch { /* ignora */ }
    }
  } catch {
    obj.set("lineHeight", leadingPtToFabricLineHeight(leadingPt, fs))
  }
}
