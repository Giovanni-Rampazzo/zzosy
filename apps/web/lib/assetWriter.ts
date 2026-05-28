"use client"
// CANONICAL ASSET WRITER (CORE 2/5 — 2026-05-28)
//
// FONTE UNICA pra qualquer caller client-side atualizar um asset. Server
// aplica todas migrations (content per-char canonifica, lastOverride strip,
// pieces+kv layers migrateStyles, transacional).
//
// Antes: pagina /assets fazia rebuildSpans LOCAL (so 1 span uniforme),
// updateAssetContent strippa per-char, updateAssetLastOverride PUT separado
// com debounce, swap setava direto pelo banco. Cada caminho com regras
// sutilmente diferentes — drift.
//
// Agora: 1 funcao. Todos chamam putAsset. Server faz o resto.

import { broadcastPieceUpdated, broadcastKvUpdated } from "@/lib/regenerateThumbsBroadcast"

export interface AssetPatch {
  // Texto principal do asset (compat com value/label legacy)
  value?: string
  label?: string
  // Content canonico (TextSpan[]). Server canonifica via buildSpansFromPerChar
  // se text mudou.
  content?: any
  // lastOverride: template aplicado em pecas geradas. Pode incluir styles
  // per-char. Server strippa per-char redundante (igual ao fill).
  lastOverride?: any
  // Image asset
  imageUrl?: string | null
  order?: number
  visible?: boolean
  // GAM library link
  libraryAssetId?: string | null
  libraryAssetVersion?: number | null
  libraryAssetDetached?: boolean
  slotKey?: string | null
}

export interface PutAssetOptions {
  // Disparar broadcast pra refrescar thumbs em outras abas. Default true.
  broadcast?: boolean
}

/**
 * Atualiza UM asset. Server roda migrate transacional: content canonifica,
 * kv.layers + pieces.layers + lastOverride sao migrados via Myers LCS.
 *
 * Retorna o asset atualizado.
 */
export async function putAsset(
  campaignId: string,
  assetId: string,
  patch: AssetPatch,
  opts: PutAssetOptions = {},
): Promise<any> {
  const broadcast = opts.broadcast !== false
  const body = JSON.stringify(patch)
  const res = await fetch(`/api/campaigns/${campaignId}/assets/${assetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`putAsset failed: ${res.status} ${text}`)
  }
  const asset = await res.json()
  if (broadcast) {
    broadcastKvUpdated(campaignId)
  }
  return asset
}
