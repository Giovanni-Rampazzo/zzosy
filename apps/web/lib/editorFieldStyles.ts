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

/** Input/select escuro base do editor. BG #111, border #2a2a2a, white text. */
export const inpS: CSSProperties = {
  width: "100%",
  background: "#111",
  border: "1px solid #2a2a2a",
  color: "white",
  fontSize: 12,
  padding: "5px 8px",
  borderRadius: 4,
  outline: "none",
}

/** Number input variant — text-align right + paddingRight pra spinners
 *  nativos do browser nao colidirem com o numero exibido. */
export const numInpS: CSSProperties = {
  ...inpS,
  textAlign: "right",
  paddingRight: 22,
  width: "100%",
}

/** Label uppercase pequena das secoes do Properties Panel. */
export const secS: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#666",
  textTransform: "uppercase" as const,
  letterSpacing: 0.6,
  marginBottom: 6,
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
 *  + label "%/px". gap 2 deixa o label perto mas com respiro. */
export const numFieldRight: CSSProperties = {
  display: "flex",
  gap: 2,
  alignItems: "center",
}

/** Label "%/px" do numFieldRight. Pequena, cinza, marginLeft pra respiro. */
export const numFieldUnit: CSSProperties = {
  fontSize: 10,
  color: "#666",
  marginLeft: 2,
}
