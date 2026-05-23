/**
 * fabricLineHeight — conversao bidirecional entre leadingPt (Adobe/PSD,
 * absoluto em pontos) e Fabric Textbox.lineHeight (multiplier).
 *
 * Por que existe esse helper:
 *
 *   Fabric Textbox tem um multiplier INTERNO ESCONDIDO chamado `_fontSizeMult`
 *   (default 1.13) usado em getHeightOfLineImpl:
 *       lineHeight_visual = fontSize × _fontSizeMult × this.lineHeight
 *
 *   Isso significa que `lineHeight=1.0` NAO renderiza a linha com altura igual
 *   a fontSize — renderiza com 1.13 × fontSize (13% MAIOR). Bug visivel quando
 *   PSD tem leading tight (=fontSize): user importa, ve no preview ag-psd
 *   compacto, mas no editor cada linha sai 13% mais alta.
 *
 *   Pra Fabric renderizar exatamente `leadingPt` de altura entre baselines:
 *       lineHeight = leadingPt / (fontSize × _fontSizeMult)
 *
 *   Ex: PSD fontSize=40, leading=40 → lineHeight = 40 / (40 × 1.13) = 0.885
 *   Editor renderiza: 40 × 1.13 × 0.885 = 40.0 ✓ (bate com PSD)
 *
 *   Antes esse fator era ignorado e o codigo usava `leadingPt / fontSize`
 *   direto → editor sempre 13% mais espacoso que o PSD original. User
 *   reportou 2026-05-22 com print side-by-side.
 */

/** Multiplier interno do Fabric Textbox (`_fontSizeMult` no node_modules/fabric).
 *  Se Fabric atualizar e mudar esse valor, ajustar aqui. */
export const FABRIC_FONT_SIZE_MULT = 1.13

/** Converte leadingPt (PSD absoluto, pontos) → Fabric Textbox.lineHeight (multiplier). */
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
