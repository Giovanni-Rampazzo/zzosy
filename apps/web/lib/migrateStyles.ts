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
  // Otimização: pares delete+insert adjacentes na mesma posição viram replace.
  // (Word/Photoshop tratam "selecionar e digitar" como replace, herdando estilo do antigo)
  const optimized: DiffOp[] = []
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]
    const next = ops[k + 1]
    if (op.type === "delete" && next?.type === "insert") {
      optimized.push({ type: "replace", i: op.i, j: next.j })
      k++
    } else if (op.type === "insert" && next?.type === "delete") {
      optimized.push({ type: "replace", i: next.i, j: op.j })
      k++
    } else {
      optimized.push(op)
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
      // Herda do caractere ANTERIOR no texto novo (que ja foi processado antes desse insert).
      // Se for o primeiro caractere absoluto, herda do proximo caractere conhecido.
      if (op.j > 0 && flatNew[op.j - 1]) {
        flatNew[op.j] = flatNew[op.j - 1]
      } else if (lastSeenOldIdx >= 0 && flatOld[lastSeenOldIdx]) {
        flatNew[op.j] = flatOld[lastSeenOldIdx]
      } else {
        flatNew[op.j] = null
      }
    }
    // delete: nada a fazer
  }

  return unflattenStyles(newText, flatNew)
}
