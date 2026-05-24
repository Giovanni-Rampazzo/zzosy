/**
 * Monkey-patch do Fabric v6.x pra suportar charSpacing PER-CHAR.
 *
 * Fabric default usa `this.charSpacing` (object-level) em _getWidthOfCharSpacing
 * e _getGraphemeBox — ignora obj.styles[line][col].charSpacing. Resultado:
 * mesmo gravando per-char styles, render usa box-level → letter spacing
 * por trecho selecionado nao funciona (Adobe-style).
 *
 * Este patch:
 *  1. Override _getWidthOfCharSpacing(lineIndex?, charIndex?) — le per-char first.
 *  2. Override _getGraphemeBox — passa lineIndex/charIndex pra ler per-char.
 *  3. Force render char-by-char quando ha per-char CS (bypass shortCut Fabric).
 *
 * Import este arquivo UMA VEZ no top do KeyVisionEditor (ja roda no module init).
 *
 * Status: patches sao idempotentes (flag __zzosyPerCharCharSpacingPatched).
 * Compatibilidade: Fabric v6.9.1. Re-validar em upgrades.
 */
import * as fabric from "fabric"

const Text = (fabric as any).Text as any

if (Text && !Text.__zzosyPerCharCharSpacingPatched) {
  Text.__zzosyPerCharCharSpacingPatched = true

  const orig_renderChars = Text.prototype._renderChars

  /**
   * Override _getWidthOfCharSpacing pra aceitar lineIndex/charIndex opcionais.
   * Quando passados, prioriza obj.styles[line][col].charSpacing. Caso contrario,
   * fallback pra this.charSpacing (comportamento original).
   *
   * Tambem usa o fontSize PER-CHAR (style.fontSize) em vez de this.fontSize,
   * pra que chars com fontSize override tenham proporcao de spacing correta.
   */
  Text.prototype._getWidthOfCharSpacing = function (lineIndex?: number, charIndex?: number) {
    let cs: number = this.charSpacing
    let fontSize: number = this.fontSize
    if (typeof lineIndex === "number" && typeof charIndex === "number") {
      const charStyle = this.styles?.[lineIndex]?.[charIndex]
      if (charStyle && typeof charStyle.charSpacing === "number") {
        cs = charStyle.charSpacing
      }
      if (charStyle && typeof charStyle.fontSize === "number") {
        fontSize = charStyle.fontSize
      }
    }
    if (cs !== 0) {
      return (fontSize * cs) / 1000
    }
    return 0
  }

  /**
   * Override _getGraphemeBox pra passar lineIndex/charIndex ao
   * _getWidthOfCharSpacing — sem isso, leitura per-char nao acontece.
   * Tambem detecta per-char CS pra incluir width mesmo se this.charSpacing===0.
   */
  Text.prototype._getGraphemeBox = function (
    grapheme: string,
    lineIndex: number,
    charIndex: number,
    prevGrapheme: string | undefined,
    skipLeft: boolean
  ) {
    const style = this.getCompleteStyleDeclaration(lineIndex, charIndex)
    const prevStyle = prevGrapheme ? this.getCompleteStyleDeclaration(lineIndex, charIndex - 1) : {}
    const info = this._measureChar(grapheme, style, prevGrapheme, prevStyle)
    let kernedWidth: number = info.kernedWidth
    let width: number = info.width

    // Detecta se PRECISA aplicar charSpacing (object-level OU per-char).
    const perCharCs = this.styles?.[lineIndex]?.[charIndex]?.charSpacing
    const hasCs = (typeof perCharCs === "number" && perCharCs !== 0) || this.charSpacing !== 0
    if (hasCs) {
      const cs = this._getWidthOfCharSpacing(lineIndex, charIndex)
      width += cs
      kernedWidth += cs
    }

    const box: any = {
      width,
      left: 0,
      height: style.fontSize,
      kernedWidth,
      deltaY: style.deltaY,
    }
    if (charIndex > 0 && !skipLeft) {
      const previousBox = this.__charBounds[lineIndex][charIndex - 1]
      box.left = previousBox.left + previousBox.width + info.kernedWidth - info.width
    }
    return box
  }

  /**
   * Override _renderChars: se ha QUALQUER per-char charSpacing nessa linha,
   * desabilita o `shortCut` de render do Fabric (que pula char-by-char loop
   * quando charSpacing object-level === 0). Truque: setar this.charSpacing
   * temporariamente pra um valor negligible-mas-nao-zero (1e-9) que desliga
   * o shortCut sem afetar visual. Per-char styles ainda dominam via patches
   * acima.
   */
  Text.prototype._renderChars = function (
    method: any,
    ctx: any,
    line: any,
    left: number,
    top: number,
    lineIndex: number
  ) {
    const lineStyles = this.styles?.[lineIndex]
    let hasPerCharCs = false
    if (lineStyles && typeof lineStyles === "object") {
      for (const k of Object.keys(lineStyles)) {
        const cs = lineStyles[k]?.charSpacing
        if (typeof cs === "number" && cs !== 0) {
          hasPerCharCs = true
          break
        }
      }
    }
    if (!hasPerCharCs || this.charSpacing !== 0) {
      return orig_renderChars.call(this, method, ctx, line, left, top, lineIndex)
    }
    // Hack: charSpacing temporariamente nao-zero (negligible) pra Fabric
    // pular shortCut e renderizar char-by-char (cada char usa nossa
    // _getWidthOfCharSpacing patched que le per-char).
    const saved = this.charSpacing
    this.charSpacing = 1e-9
    try {
      return orig_renderChars.call(this, method, ctx, line, left, top, lineIndex)
    } finally {
      this.charSpacing = saved
    }
  }
}

export {}
