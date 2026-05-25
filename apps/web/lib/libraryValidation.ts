/**
 * Validacoes server-side pra ClientLibraryAsset.
 * Centralizado pra ser reusado em POST/PATCH/PUT da library + cartridge import.
 */
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * Valida que slotKey nao-null nao esta em uso por outro asset do mesmo cliente.
 * MySQL nao suporta partial unique constraint (NULL permite multiplas), por isso
 * validamos no app layer.
 *
 * Retorna NextResponse 409 OR null se OK.
 *
 * @param excludeAssetId Pra UPDATE, ignora o proprio asset (slot nao colide com ele mesmo).
 */
export async function assertSlotKeyUnique(
  clientId: string,
  slotKey: string | null | undefined,
  excludeAssetId?: string,
): Promise<NextResponse | null> {
  if (!slotKey || !slotKey.trim()) return null
  const existing = await prisma.clientLibraryAsset.findFirst({
    where: {
      clientId,
      slotKey,
      ...(excludeAssetId ? { NOT: { id: excludeAssetId } } : {}),
    },
    select: { id: true, name: true },
  })
  if (existing) {
    return NextResponse.json({
      error: `slotKey "${slotKey}" ja em uso por "${existing.name}". Slots devem ser unicos por cliente.`,
      conflictAssetId: existing.id,
      conflictAssetName: existing.name,
    }, { status: 409 })
  }
  return null
}
