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
 *  4. CLAMP TRACKING NEGATIVO quando fonte cai em fallback (Arial). Sem isso,
 *     texto PSD com tracking negativo (-50 etc) projetado pra fonte Sicredi
 *     ficava com letras colando ao cair em fallback Arial (metricas diferentes).
 *     Editor popula `markFontFallback(family)` quando detecta missing variant;
 *     patch ignora charSpacing<0 nesse caso. Quando fonte real carrega, editor
 *     chama `clearFontFallback(family)` e forca re-render.
 *
 * Import este arquivo UMA VEZ no top do KeyVisionEditor (ja roda no module init).
 *
 * Status: patches sao idempotentes (flag __zzosyPerCharCharSpacingPatched).
 * Compatibilidade: Fabric v6.9.1. Re-validar em upgrades.
 */
import * as fabric from "fabric"

// Registry global de familias em fallback. Editor popula via markFontFallback
// apos font-detection identificar familia ausente; patches abaixo leem
// pra decidir se clampam tracking negativo.
const FALLBACK_FAMILIES = new Set<string>()

/** Editor chama apos font-detection identificar familia ausente. */
export function markFontFallback(family: string): void {
  if (typeof family === "string" && family.trim()) FALLBACK_FAMILIES.add(family.trim())
}

/** Editor chama quando fonte real carregou (e.g. apos fonts.ready resolver). */
export function clearFontFallback(family: string): void {
  if (typeof family === "string") FALLBACK_FAMILIES.delete(family.trim())
}

/** Verifica se familia esta marcada como fallback. */
export function isFontInFallback(family: string | undefined | null): boolean {
  if (typeof family !== "string" || !family) return false
  return FALLBACK_FAMILIES.has(family.trim())
}

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
    let family: string | undefined = this.fontFamily
    if (typeof lineIndex === "number" && typeof charIndex === "number") {
      const charStyle = this.styles?.[lineIndex]?.[charIndex]
      if (charStyle && typeof charStyle.charSpacing === "number") {
        cs = charStyle.charSpacing
      }
      if (charStyle && typeof charStyle.fontSize === "number") {
        fontSize = charStyle.fontSize
      }
      if (charStyle && typeof charStyle.fontFamily === "string") {
        family = charStyle.fontFamily
      }
    }
    // Clamp tracking NEGATIVO em familias fallback. Tracking positivo passa
    // normal (mesmo em fallback, espacamento extra nao gera "colado"). Sem isso
    // texto PSD com tracking -50/-100 ficava ilegivel ao cair em Arial.
    if (cs < 0 && isFontInFallback(family)) {
      cs = 0
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
   * Override getHeightOfLine pra adicionar `__paragraphSpaceAfter` (em px)
   * apos linhas que TERMINAM um paragrafo no texto raw. PSD usa spaceAfter
   * pra criar gaps entre paragrafos; Fabric nao suporta nativamente.
   *
   * Comportamento:
   *  - textbox.__paragraphSpaceAfter = N pixels (extra) → adiciona a cada linha
   *    de paragrafo final EXCETO a ultima linha global (sem gap apos final).
   *  - Cache invalido quando textbox.text muda (key = text.length+content).
   *  - Sem __paragraphSpaceAfter ou =0 → comportamento normal (no-op).
   */
  const origGetHeightOfLine = Text.prototype.getHeightOfLine
  Text.prototype.getHeightOfLine = function (lineIndex: number) {
    const base = origGetHeightOfLine.call(this, lineIndex)
    const extra: number = (this as any).__paragraphSpaceAfter ?? 0
    if (!extra || extra <= 0) return base
    const lines = this._textLines as string[] | undefined
    if (!lines || lines.length === 0) return base
    // Ultima linha global: nao adiciona gap (paragrafo final fecha a textbox)
    if (lineIndex >= lines.length - 1) return base
    // Cache de paragraph-ending lines. Invalida quando texto muda.
    const text = this.text ?? ""
    const cacheKey = `${text.length}|${lines.length}|${lines[0]?.length ?? 0}`
    let cache = this.__paragraphEndCache as { key: string; set: Set<number> } | undefined
    if (!cache || cache.key !== cacheKey) {
      const set = new Set<number>()
      let pos = 0
      for (let i = 0; i < lines.length; i++) {
        pos += lines[i].length
        if (text[pos] === "\n") {
          set.add(i)
          pos++
        }
      }
      cache = { key: cacheKey, set }
      this.__paragraphEndCache = cache
    }
    return cache.set.has(lineIndex) ? base + extra : base
  }

  /**
   * Override _renderChars: se ha QUALQUER per-char charSpacing nessa linha,
   * desabilita o `shortCut` de render do Fabric (que pula char-by-char loop
   * quando charSpacing object-level === 0). Truque: setar this.charSpacing
   * temporariamente pra um valor pequeno-mas-nao-zero que desliga o shortCut.
   * Per-char styles dominam visualmente via patches acima.
   *
   * 2026-05-25: valor era 1e-9 (mat. negligível mas próximo a underflow
   * f.p.). Tentativa de fix pro chromatic-aberration em previews/thumbs:
   * trocado por 0.001 (ainda invisivel: 0.001 * fontSize/1000 = 1e-4 px,
   * sub-pixel garantido). Suspeita: alguma comparacao downstream do Fabric
   * tratava 1e-9 como zero (ou rounded), produzindo render inconsistente
   * entre passes (shadow/fill/stroke) e gerando ghosting.
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
    // Hack: charSpacing temporariamente non-zero (sub-pixel) pra Fabric
    // pular shortCut e renderizar char-by-char (cada char usa nossa
    // _getWidthOfCharSpacing patched que le per-char).
    const saved = this.charSpacing
    this.charSpacing = 0.001
    try {
      return orig_renderChars.call(this, method, ctx, line, left, top, lineIndex)
    } finally {
      this.charSpacing = saved
    }
  }
}

export {}
