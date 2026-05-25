/**
 * Taxonomia GLOBAL do tenant: 3 listas controladas pelo user (segments,
 * categories, filters). Aplicaveis a TODA entidade do ZZOSY (clientes,
 * campanhas, pecas, midias) — fonte unica de verdade pra autocomplete.
 *
 * Auto-merge: quando o user cria um valor numa entidade (ex: segment "Black
 * Friday" numa peca), o helper append na taxonomia do tenant sem duplicar.
 * Gerenciavel via UI em /clients/[id]/edit (visivel ali porque eh "config do
 * usuario", mesmo sendo escopo tenant).
 */

import type { PrismaClient } from "@prisma/client"

export interface Taxonomy {
  segments: string[]
  categories: string[]
  filters: string[]
}

export const EMPTY_TAXONOMY: Taxonomy = {
  segments: [],
  categories: [],
  filters: [],
}

/** Normaliza o JSON do banco pra formato canonico (com defaults). */
export function normalizeTaxonomy(raw: any): Taxonomy {
  const out: any = { ...EMPTY_TAXONOMY }
  if (!raw || typeof raw !== "object") return out
  for (const k of Object.keys(EMPTY_TAXONOMY) as Array<keyof Taxonomy>) {
    const v = raw[k]
    out[k] = Array.isArray(v) ? v.filter((x: any) => typeof x === "string" && x.trim().length > 0) : []
  }
  return out
}

function normalizeForCompare(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Append valores a uma das listas da taxonomia do tenant (auto-merge). Se o
 * valor ja existe (case-insensitive, trim), retorna sem mudar.
 *
 * Usado nos handlers de save de pecas/campanhas/etc quando user cria valor
 * novo. Listas viram fonte unica de verdade pra autocomplete + edicao UI.
 */
export async function appendToTaxonomy(
  prisma: PrismaClient,
  tenantId: string,
  field: keyof Taxonomy,
  values: string | string[],
): Promise<void> {
  const arr = Array.isArray(values) ? values : [values]
  const cleaned = arr.map(v => (typeof v === "string" ? v.trim() : "")).filter(v => v.length > 0)
  if (cleaned.length === 0) return
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { taxonomy: true },
    })
    if (!tenant) return
    const current = normalizeTaxonomy(tenant.taxonomy)
    const existing = new Set(current[field].map(normalizeForCompare))
    let dirty = false
    for (const v of cleaned) {
      if (!existing.has(normalizeForCompare(v))) {
        current[field].push(v)
        existing.add(normalizeForCompare(v))
        dirty = true
      }
    }
    if (dirty) {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { taxonomy: current as any },
      })
    }
  } catch (err) {
    console.warn("[appendToTaxonomy] falha:", err)
  }
}
