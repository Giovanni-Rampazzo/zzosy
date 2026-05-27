/**
 * FONTE UNICA DE VERDADE pros estilos de fields/inputs no editor ZZOSY.
 *
 * User pediu varias vezes "padding tem que ser o mesmo em TUDO" e "controlado
 * por um unico arquivo". Antes vivia espalhado em ~5 sites no KeyVisionEditor
 * com pequenas variacoes (gridTemplateColumns "1fr 92px" vs "1fr 80px", gap 6
 * vs 8, paddingRight 22 vs 4, etc).
 *
 * Mudar qualquer dimensao aqui = propaga pra editor inteiro. Anti-padrao
 * duplicacao no editor eliminado.
 *
 * Onde usar:
 *  - `inpS`: input/select padrao do dark editor (BG #111, border #2a2a2a)
 *  - `numInpS`: number input com text-align right + paddingRight pra acomodar
 *    spinner buttons do navegador
 *  - `secS`: label uppercase pequena das secoes (CAMADA, FONTE, COR, etc)
 *  - `numFieldGrid`: grid container `1fr 92px` pra layout "field principal +
 *    number small". Inclui gap 6 + alignItems center.
 *  - `numFieldRight`: container flex pra agrupar number input + label "%/px"
 */

import type { CSSProperties } from "react"

/** Input/select escuro base do editor. BG #111, border #2a2a2a, white text.
 *  padding vertical 5 → 3 (2026-05-26 user pediu radical menor). */
export const inpS: CSSProperties = {
  width: "100%",
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: 4,
  outline: "none",
}

/** Number input variant — text-align LEFT pra numero curto ('100', '20') ficar
 *  a esquerda do input, e spinner buttons do navegador aparecerem a direita
 *  com espaco natural. Mesmo padrao do ColorSwatchPicker (Preenchimento/Stroke).
 *
 *  Antes era textAlign right + paddingRight 22, mas o user reportou 2026-05-22
 *  que "Camada" tinha numero/setas colados e diferentes de "Preenchimento" —
 *  inconsistencia visual entre as secoes do Properties Panel. Agora todos os
 *  number inputs (Camada/Stroke width/Raio do canto/etc) tem visual identico. */
export const numInpS: CSSProperties = {
  ...inpS,
  textAlign: "left",
  paddingLeft: 4,
  paddingRight: 4,
  width: "100%",
}

/** Label uppercase pequena das secoes do Properties Panel.
 *  marginBottom 6 → 3 (2026-05-26 user pediu padding radical menor). */
export const secS: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#666",
  textTransform: "uppercase" as const,
  letterSpacing: 0.6,
  marginBottom: 3,
}

/** Grid container padrao pra layout "field principal + number small a direita".
 *  1fr cabe o controle principal (select, slider, swatch). 92px coluna fixa
 *  pro number + label "%/px". gap 6 + alignItems center pra alinhar verticalmente. */
export const numFieldGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 92px",
  gap: 6,
  alignItems: "center",
}

/** Container flex do lado direito do numFieldGrid — agrupa number input
 *  + label "%/px". gap 8 alinha com o ColorSwatchPicker (Preenchimento/Stroke)
 *  pra label "%" ficar afastado do spinner do input, nao colado. */
export const numFieldRight: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
}

/** Label "%/px" do numFieldRight. Pequena, cinza. Sem marginLeft adicional —
 *  gap do container ja afasta do input. fontSize 11 alinhado com ColorSwatchPicker. */
export const numFieldUnit: CSSProperties = {
  fontSize: 11,
  color: "#666",
}
