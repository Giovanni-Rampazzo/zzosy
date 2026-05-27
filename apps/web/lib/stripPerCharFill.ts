// Helper anti-falhas: se overrides.fill esta setado (= layer color decidida
// pelo user), remove fill + fillBrandIdx de TODOS os styles per-char.
// Sem isso, per-char fills antigos (geralmente do PSD original, importado
// com cor preta default) ganham precedencia sobre o overrides.fill no
// renderer e o texto fica com cor errada.
//
// Bug recorrente: user muda cor pra branco na matriz, peca gerada continua
// preta porque asset.lastOverride.styles tem per-char colors do PSD nao
// strippados, e generate peca copia esses styles.
//
// Aplicado em 3 sites (defense in depth):
//  - lib/stripPerCharFill (este arquivo) — fonte unica
//  - GeneratePiecesModal — strip ao gerar peca a partir da matriz
//  - regenerateThumbs.buildThumbnailFromPieceData — strip antes de Fabric
//  - exportPiece.buildPieceCanvas — strip antes de renderizar pra export
//
// Regra ZZOSY (CLAUDE.md 2.8 precedencia):
//   charFills[i] > overrides.fill > asset.content[span].style.color
//
// Mas a regra implicita: charFills (per-char) so deve existir quando o user
// ATIVAMENTE setou (selecionou chars + escolheu cor). Se overrides.fill foi
// setado SEM seleção (= todo o texto), os per-char foram strippados na hora
// no editor. Esta funcao garante que esse strip eh aplicado tambem em estado
// LEGADO (gerado antes do fix, importado do PSD, etc).

export interface OverridesLike {
  fill?: string
  fillBrandIdx?: number | null
  styles?: Record<string, Record<string, any>> | null | undefined
  // Outros campos preservados intactos.
  [k: string]: any
}

/**
 * Retorna copia das overrides com per-char fill/fillBrandIdx removidos quando
 * overrides.fill esta setado. Se overrides.fill nao esta setado, retorna
 * overrides como veio (sem mexer — user pode ter so per-char fills sem
 * layer fill, padrao valido).
 */
export function stripPerCharFillWhenLayerSet<T extends OverridesLike>(overrides: T): T {
  if (!overrides) return overrides
  // Sem layer fill setado: nada a strippar — per-char eh a unica fonte.
  if (typeof overrides.fill !== "string" && typeof overrides.fillBrandIdx !== "number") return overrides
  if (!overrides.styles || typeof overrides.styles !== "object") return overrides

  // Detecta se HA algum per-char fill pra strippar — evita clonar
  // desnecessariamente quando ja esta limpo.
  let hasPerCharFill = false
  outer: for (const lineKey of Object.keys(overrides.styles)) {
    const line = overrides.styles[lineKey]
    if (!line || typeof line !== "object") continue
    for (const colKey of Object.keys(line)) {
      const cs = line[colKey]
      if (!cs || typeof cs !== "object") continue
      if ("fill" in cs || "fillBrandIdx" in cs) { hasPerCharFill = true; break outer }
    }
  }
  if (!hasPerCharFill) return overrides

  // Clone shallow + clone styles deep o suficiente pra mutar sem affetar
  // original. Outras props (fontSize per-char) preservadas.
  const newStyles: Record<string, Record<string, any>> = {}
  for (const lineKey of Object.keys(overrides.styles)) {
    const line = overrides.styles[lineKey]
    if (!line || typeof line !== "object") continue
    const newLine: Record<string, any> = {}
    for (const colKey of Object.keys(line)) {
      const cs = line[colKey]
      if (!cs || typeof cs !== "object") continue
      // Copia tudo menos fill/fillBrandIdx
      const { fill: _f, fillBrandIdx: _fb, ...rest } = cs as any
      if (Object.keys(rest).length > 0) newLine[colKey] = rest
    }
    if (Object.keys(newLine).length > 0) newStyles[lineKey] = newLine
  }

  return {
    ...overrides,
    styles: Object.keys(newStyles).length > 0 ? newStyles : undefined,
  }
}
