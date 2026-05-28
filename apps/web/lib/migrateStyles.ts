// Migração de styles per-character ao alterar texto.
// Comportamento Word/Photoshop: estilo é colado ao caractere.
// - equal: mantém estilo
// - replace: novo caractere herda estilo do antigo na mesma posição
// - delete: estilo some
// - insert: novo caractere herda estilo do caractere ANTERIOR (T0[i-1])

// Estrutura de styles do Fabric Textbox:
//   styles[lineNumber][charIndex] = { fill, fontSize, fontWeight, fontFamily, ... }
// Convertemos para "flat" (array indexado por offset absoluto na string), aplicamos diff,
// reconvertemos para o formato Fabric.

type FabricStyles = Record<number, Record<number, any>>
type FlatStyles = Array<Record<string, any> | null>

export function flattenStyles(text: string, styles: FabricStyles | undefined): FlatStyles {
  const result: FlatStyles = new Array(text.length).fill(null)
  if (!styles) return result
  let lineNum = 0
  let colInLine = 0
  for (let absIdx = 0; absIdx < text.length; absIdx++) {
    const ch = text[absIdx]
    if (ch === "\n") {
      result[absIdx] = null
      lineNum++
      colInLine = 0
      continue
    }
    const lineStyles = styles[lineNum]
    if (lineStyles && lineStyles[colInLine]) {
      result[absIdx] = { ...lineStyles[colInLine] }
    }
    colInLine++
  }
  return result
}

export function unflattenStyles(text: string, flat: FlatStyles): FabricStyles {
  const result: FabricStyles = {}
  let lineNum = 0
  let colInLine = 0
  for (let absIdx = 0; absIdx < text.length; absIdx++) {
    const ch = text[absIdx]
    if (ch === "\n") {
      lineNum++
      colInLine = 0
      continue
    }
    const style = flat[absIdx]
    if (style && Object.keys(style).length > 0) {
      if (!result[lineNum]) result[lineNum] = {}
      result[lineNum][colInLine] = style
    }
    colInLine++
  }
  return result
}

// Algoritmo Myers diff simplificado (LCS).
// Retorna lista de operações: equal/replace/delete/insert
type DiffOp =
  | { type: "equal";   i: number; j: number }
  | { type: "replace"; i: number; j: number }
  | { type: "delete";  i: number }
  | { type: "insert";  j: number }

function diff(a: string, b: string): DiffOp[] {
  const m = a.length, n = b.length
  // Tabela LCS
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  // Backtrack pra montar operações
  const ops: DiffOp[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.unshift({ type: "equal", i: i - 1, j: j - 1 })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "insert", j: j - 1 })
      j--
    } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
      ops.unshift({ type: "delete", i: i - 1 })
      i--
    }
  }
  // Otimização: blocos contiguos de delete + blocos contiguos de insert
  // viram replaces 1:1 (Word/Photoshop "selecionar e digitar"). Versao
  // anterior so casava UM par adjacente — em replace-total (ABC->XYZ),
  // todos deletes vinham primeiro, todos inserts depois, e apenas o
  // ultimo delete pareava com o primeiro insert → X/Y/Z herdavam cor do
  // C. Bug 2026-05-28.
  const optimized: DiffOp[] = []
  let k = 0
  while (k < ops.length) {
    // Coleta bloco contiguo de deletes
    const dels: { i: number }[] = []
    while (k < ops.length && ops[k].type === "delete") {
      dels.push({ i: (ops[k] as any).i })
      k++
    }
    // Coleta bloco contiguo de inserts
    const inss: { j: number }[] = []
    while (k < ops.length && ops[k].type === "insert") {
      inss.push({ j: (ops[k] as any).j })
      k++
    }
    // Casa 1:1 enquanto tem dos dois lados
    const pairs = Math.min(dels.length, inss.length)
    for (let p = 0; p < pairs; p++) {
      optimized.push({ type: "replace", i: dels[p].i, j: inss[p].j })
    }
    // Sobras viram delete OU insert puros
    for (let p = pairs; p < dels.length; p++) {
      optimized.push({ type: "delete", i: dels[p].i })
    }
    for (let p = pairs; p < inss.length; p++) {
      optimized.push({ type: "insert", j: inss[p].j })
    }
    // equal ou outro tipo no current k
    if (k < ops.length && ops[k].type !== "delete" && ops[k].type !== "insert") {
      optimized.push(ops[k])
      k++
    }
  }
  return optimized
}

/**
 * Migra styles per-character entre texto antigo e novo.
 * Regras (Word/Photoshop-style):
 * - equal: mantém estilo do caractere
 * - replace: novo caractere herda estilo do antigo na mesma posição
 * - insert: novo caractere herda estilo do caractere ANTERIOR (T0[i-1])
 *           ou do PRÓXIMO se for início absoluto
 * - delete: estilo some
 */
export function migrateStyles(
  oldText: string,
  newText: string,
  oldStyles: FabricStyles | undefined,
): FabricStyles {
  if (!oldStyles || Object.keys(oldStyles).length === 0) return {}
  if (oldText === newText) return oldStyles

  // HEURISTICA "TEXTO NOVO" (2026-05-28): se o user APAGOU TUDO e reescreveu
  // texto MUITO DIFERENTE (sem common prefix nem suffix, e new bem maior),
  // tratar como reset — per-char antigo nao faz sentido na nova string.
  //
  // User reportou: 123456 (per-char colorido) -> Car los\nantonio.
  // Algoritmo posicional 1:1 mapeava 1->C, 2->a, 3->r, etc. e "antonio"
  // herdava cor do char 6. Resultado bizarro: primeira linha colorida,
  // segunda toda da mesma cor.
  //
  // Threshold: zero prefix + zero suffix + newText.length > 2x oldText.length
  // (ou old vazio). Cobre o caso "apagou e reescreveu novo" sem quebrar
  // o caso "ABC -> DEF" (mesmo length, prefix=0 suffix=0 mas user quer
  // positional).
  if (oldText.length > 0 && newText.length > 0) {
    let prefixLen = 0
    const minLen = Math.min(oldText.length, newText.length)
    while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) prefixLen++
    let suffixLen = 0
    while (
      suffixLen < (oldText.length - prefixLen) &&
      suffixLen < (newText.length - prefixLen) &&
      oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]
    ) suffixLen++
    const noCommon = prefixLen === 0 && suffixLen === 0
    const muchLonger = newText.length > oldText.length * 2
    if (noCommon && muchLonger) return {}
  }

  const flatOld = flattenStyles(oldText, oldStyles)
  const flatNew: FlatStyles = new Array(newText.length).fill(null)

  const ops = diff(oldText, newText)
  // Mapear em ordem para identificar último i conhecido (pra heranças de insert)
  let lastSeenOldIdx = -1

  for (const op of ops) {
    if (op.type === "equal") {
      flatNew[op.j] = flatOld[op.i]
      lastSeenOldIdx = op.i
    } else if (op.type === "replace") {
      flatNew[op.j] = flatOld[op.i]
      lastSeenOldIdx = op.i
    } else if (op.type === "insert") {
      // Herda do caractere ANTERIOR no texto novo (Adobe/Figma rule).
      // Se for inicio absoluto E nao temos contexto anterior, olha ADIANTE
      // no flatOld pelo proximo char conhecido (Adobe-style fallback).
      if (op.j > 0 && flatNew[op.j - 1]) {
        flatNew[op.j] = flatNew[op.j - 1]
      } else if (lastSeenOldIdx >= 0 && flatOld[lastSeenOldIdx]) {
        flatNew[op.j] = flatOld[lastSeenOldIdx]
      } else {
        // Look ahead: encontra primeiro char com style nao-null em flatOld.
        let aheadStyle: any = null
        for (let f = 0; f < flatOld.length; f++) {
          if (flatOld[f]) { aheadStyle = flatOld[f]; break }
        }
        flatNew[op.j] = aheadStyle
      }
    }
    // delete: nada a fazer
  }

  return unflattenStyles(newText, flatNew)
}
