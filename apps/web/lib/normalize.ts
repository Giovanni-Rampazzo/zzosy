/**
 * Normaliza strings pra matching tolerante (ignora case, acentos, espacos).
 * Usado pra casar nomes de layers PSD com nomes de assets da campanha.
 *
 * Exemplos:
 *   normalize("GIOVANNI ")    -> "giovanni"
 *   normalize("Giovánni")     -> "giovanni"
 *   normalize("  Foo  Bar ")  -> "foobar"
 *   normalize(null)           -> ""
 */
export function normalizeName(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .normalize("NFD")           // separa acentos dos caracteres base
    .replace(/[\u0300-\u036f]/g, "") // remove os marcadores de acento
    .toLowerCase()
    .replace(/\s+/g, "")        // remove TODOS os espacos (interno + extremos)
}
