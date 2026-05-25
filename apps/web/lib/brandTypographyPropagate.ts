/**
 * Propaga mudancas dos presets tipograficos da marca pras pecas que ainda
 * estao com o "override original da matriz" — ou seja, nunca foram
 * customizadas localmente pelo user.
 *
 * Como detectamos "ainda original":
 *   1. CampaignAsset.lastOverride.brandPresetKey marca o asset como vinculado
 *      a um preset da marca (titulo/subtitulo/body/legenda).
 *   2. CampaignAsset.lastOverride.brandPresetSnapshot guarda os valores do
 *      preset NA HORA DA CRIACAO. Se bater com o preset antigo do cliente,
 *      significa que o user nunca tocou — propaga.
 *   3. Pros layers no KV.layers e Piece.data.layers, comparamos os overrides
 *      do layer com o snapshot. Se baterem, o layer herda do asset (nao
 *      customizado localmente) e tambem propaga.
 *
 * Adobe-style: mudanca em paragraph style propaga em tudo que herda dele,
 * mas nao toca o que foi overridden manualmente.
 */

import type { PrismaClient } from "@prisma/client"
import {
  BrandPreset, BrandPresetKey, BrandTypography,
  normalizeTypography, presetsEqual, diffTypography,
} from "./brandTypography"

function parseJson(val: any): any {
  if (!val) return null
  if (typeof val === "string") { try { return JSON.parse(val) } catch { return null } }
  return val
}

/** Compara um snapshot inline com o preset (snapshot pode ter campos undefined). */
function snapshotMatches(snapshot: any, preset: BrandPreset): boolean {
  if (!snapshot || typeof snapshot !== "object") return false
  const s: BrandPreset = {
    fontWeight: Number.isFinite(snapshot.fontWeight) ? snapshot.fontWeight : preset.fontWeight,
    fontSize:   Number.isFinite(snapshot.fontSize)   ? snapshot.fontSize   : preset.fontSize,
    leadingPt:  Number.isFinite(snapshot.leadingPt)  ? snapshot.leadingPt  : preset.leadingPt,
    charSpacing: Number.isFinite(snapshot.charSpacing) ? snapshot.charSpacing : preset.charSpacing,
    fontFamily: typeof snapshot.fontFamily === "string" ? snapshot.fontFamily : preset.fontFamily,
  }
  return presetsEqual(s, preset)
}

/**
 * Atualiza valores tipograficos de um override (object com fontSize, etc) pra
 * bater com o novo preset. Retorna NOVO objeto (imutavel).
 *
 * Tambem aceita strings em fontWeight (PSD costuma salvar como "bold"/"normal"
 * ou "300"). Mantemos o tipo string se ja estava string — assim nao quebra
 * comparacao downstream que olha === "bold".
 */
function applyPresetToOverride(override: any, preset: BrandPreset): any {
  const out: any = { ...(override ?? {}) }
  out.fontSize = preset.fontSize
  // fontWeight: preserva tipo se ja era string (PSD legacy), senao numero.
  out.fontWeight = typeof override?.fontWeight === "string"
    ? String(preset.fontWeight)
    : preset.fontWeight
  out.leadingPt = preset.leadingPt
  out.charSpacing = preset.charSpacing
  // fontFamily: so propaga quando o preset tem fontFamily explicito. Quando
  // preset.fontFamily eh undefined, deixa a familia atual (que normalmente
  // veio do client.brandFont — propagacao da brandFont em si fica fora do
  // escopo desta funcao, mantemos coerencia com snapshot do asset).
  if (typeof preset.fontFamily === "string" && preset.fontFamily.trim()) {
    out.fontFamily = preset.fontFamily
  }
  return out
}

/**
 * Propagacao principal. Chamada quando user salva brandTypography novo.
 * Server-side; ja roda dentro do PATCH /api/clients/[id].
 *
 * @param prisma instancia ja autenticada
 * @param clientId id do cliente
 * @param oldT brandTypography ANTES do PATCH (do banco)
 * @param newT brandTypography DEPOIS do PATCH (recebido no body)
 * @returns relatorio leve de contagem (uso pra log)
 */
export async function propagateBrandTypography(
  prisma: PrismaClient,
  clientId: string,
  oldT: BrandTypography,
  newT: BrandTypography,
  // brandFont muda independente dos presets. Quando muda, textos com
  // fontFamily === oldBrandFont (= ainda usando a fonte da marca, nao
  // customizado pra outra) sao atualizados pra newBrandFont. Cobre tambem
  // textos importados de PSD (sem brandPresetKey) que herdam a fonte do brand.
  oldBrandFont: string | null = null,
  newBrandFont: string | null = null,
): Promise<{ assets: number; kvs: number; pieces: number }> {
  const changedKeys = diffTypography(oldT, newT)
  const brandFontChanged = oldBrandFont !== newBrandFont
  if (changedKeys.length === 0 && !brandFontChanged) return { assets: 0, kvs: 0, pieces: 0 }
  const changedSet = new Set<BrandPresetKey>(changedKeys)

  // 1) Lista campanhas do cliente. Pra cliente sem campanhas, encerra cedo.
  const campaigns = await prisma.campaign.findMany({
    where: { clientId },
    select: { id: true },
  })
  const campaignIds = campaigns.map((c) => c.id)
  if (campaignIds.length === 0) return { assets: 0, kvs: 0, pieces: 0 }

  // 2) Lista TODOS os assets de texto (nao so os com brandPresetKey). Mesmo
  //    textos importados de PSD podem ter fontFamily=brandFont (herdam brand).
  const assets = await prisma.campaignAsset.findMany({
    where: { campaignId: { in: campaignIds }, type: "TEXT" },
    select: { id: true, content: true, lastOverride: true },
  })

  let assetsUpdated = 0
  const propagateMap = new Map<string, { wasOriginal: boolean; oldSnap: BrandPreset; newSnap: BrandPreset; presetKey: BrandPresetKey }>()
  // assetId → { newFontFamily }: usado pra propagar brandFont change nos
  // layers do KV/Piece. Se brand font mudou e algum span ou override do asset
  // referenciava oldBrandFont, registramos pra atualizar os layers tambem.
  const fontFamilyPropagateMap = new Map<string, string>()

  for (const a of assets) {
    const lo: any = a.lastOverride
    const key = lo?.brandPresetKey as BrandPresetKey | undefined
    let newOverride: any = lo
    let newContent: any = undefined
    let dirtyOverride = false
    let dirtyContent = false

    // === A. Propagacao de PRESET ===
    // Caminho explicito: brandPresetKey + snapshot ainda original.
    if (key && changedSet.has(key)) {
      const oldPreset = oldT[key]
      const newPreset = newT[key]
      const wasOriginal = snapshotMatches(lo?.brandPresetSnapshot, oldPreset)
      propagateMap.set(a.id, { wasOriginal, oldSnap: oldPreset, newSnap: newPreset, presetKey: key })
      if (wasOriginal) {
        newOverride = applyPresetToOverride(lo, newPreset)
        newOverride.brandPresetKey = key
        newOverride.brandPresetSnapshot = { ...newPreset }
        dirtyOverride = true
      }
    } else if (!key && lo && typeof lo === "object" && changedSet.size > 0) {
      // Caminho FUZZY: asset sem brandPresetKey (PSD import tipico).
      // Se lastOverride bate com algum preset antigo, aplica preset novo +
      // marca brandPresetKey pra futuras propagacoes serem deterministicas.
      const matchedKey = fuzzyMatchPreset(lo)
      if (matchedKey && changedSet.has(matchedKey)) {
        const newPreset = newT[matchedKey]
        newOverride = applyPresetToOverride(lo, newPreset)
        newOverride.brandPresetKey = matchedKey
        newOverride.brandPresetSnapshot = { ...newPreset }
        propagateMap.set(a.id, {
          wasOriginal: true,
          oldSnap: oldT[matchedKey],
          newSnap: newPreset,
          presetKey: matchedKey,
        })
        dirtyOverride = true
      }
    }

    // === B. Propagacao de BRAND FONT ===
    // Atualiza fontFamily em spans/lastOverride que === oldBrandFont.
    if (brandFontChanged && newBrandFont && oldBrandFont) {
      // B.1 Spans no content
      const spansRaw: any = typeof a.content === "string"
        ? (() => { try { return JSON.parse(a.content as any) } catch { return null } })()
        : a.content
      if (Array.isArray(spansRaw)) {
        let spansDirty = false
        const newSpans = spansRaw.map((s: any) => {
          if (s?.style?.fontFamily === oldBrandFont) {
            spansDirty = true
            return { ...s, style: { ...s.style, fontFamily: newBrandFont } }
          }
          return s
        })
        if (spansDirty) {
          newContent = newSpans
          dirtyContent = true
        }
      }
      // B.2 lastOverride.fontFamily + styles per-char
      if (newOverride && typeof newOverride === "object") {
        let workingLO = newOverride === lo ? { ...(lo ?? {}) } : newOverride
        let loFontDirty = false
        if (workingLO.fontFamily === oldBrandFont) {
          workingLO.fontFamily = newBrandFont
          loFontDirty = true
        }
        if (workingLO.styles && typeof workingLO.styles === "object") {
          const newStyles: any = {}
          let stylesDirty = false
          for (const lineKey of Object.keys(workingLO.styles)) {
            const line = workingLO.styles[lineKey]
            if (!line || typeof line !== "object") {
              newStyles[lineKey] = line
              continue
            }
            const newLine: any = {}
            for (const colKey of Object.keys(line)) {
              const cs = line[colKey]
              if (cs && cs.fontFamily === oldBrandFont) {
                newLine[colKey] = { ...cs, fontFamily: newBrandFont }
                stylesDirty = true
              } else {
                newLine[colKey] = cs
              }
            }
            newStyles[lineKey] = newLine
          }
          if (stylesDirty) {
            workingLO.styles = newStyles
            loFontDirty = true
          }
        }
        if (loFontDirty) {
          newOverride = workingLO
          dirtyOverride = true
          fontFamilyPropagateMap.set(a.id, newBrandFont)
        }
      }
    }

    // Update unico por asset (mais eficiente).
    if (dirtyOverride || dirtyContent) {
      const data: any = {}
      if (dirtyOverride) data.lastOverride = newOverride
      if (dirtyContent) data.content = typeof newContent === "string" ? newContent : JSON.stringify(newContent)
      await prisma.campaignAsset.update({ where: { id: a.id }, data })
      assetsUpdated++
    }
  }
  // Continua pro KV/Piece processing mesmo se propagateMap e fontFamilyPropagateMap
  // estao vazios — layers podem ter overrides.fontFamily=oldBrandFont sem o
  // asset correspondente ter sido tocado (asset com fontFamily customizado mas
  // layer herdando do brand). Tambem cobre o caso "asset tem brandPresetKey mas
  // wasOriginal=false (asset customizado) — layer ainda pode estar no preset
  // original" — propagateMap eh setado nesse caso e propag carrega oldSnap.
  // Skip apenas quando NADA mudou (typography + brandFont identicos).

  /**
   * Tenta achar qual preset (titulo/subtitulo/body/legenda) ESTE layer ou asset
   * representa, comparando valores tipograficos com cada preset antigo. Util
   * pra layers de PSD imports que nao tem brandPresetKey explicito — se TODOS
   * os campos batem com UM preset (e so um), considera "esse era o preset".
   *
   * Match exato em fontFamily/fontWeight/fontSize/leadingPt/charSpacing. Se
   * dois presets coincidem (configuracao identica), retorna null pra evitar
   * propagacao ambigua.
   */
  function fuzzyMatchPreset(ov: any): BrandPresetKey | null {
    if (!ov || typeof ov !== "object") return null
    const layerFamily = typeof ov.fontFamily === "string" ? ov.fontFamily : null
    const layerWeight = typeof ov.fontWeight === "number"
      ? ov.fontWeight
      : (typeof ov.fontWeight === "string" && ov.fontWeight.trim().length > 0
        ? (Number(ov.fontWeight) || (ov.fontWeight.toLowerCase() === "bold" ? 700 : 400))
        : null)
    const layerSize = typeof ov.fontSize === "number" ? ov.fontSize : null
    const layerLeading = typeof ov.leadingPt === "number" ? ov.leadingPt : null
    const layerCharSpacing = typeof ov.charSpacing === "number" ? ov.charSpacing : null

    // Requer fontSize pra match (o campo mais discriminante; sem ele nao da
    // pra distinguir Titulo de Body). fontFamily pode ser herdado do brand
    // (null = match com qualquer presetFamily).
    if (layerSize === null) return null

    type Candidate = { key: BrandPresetKey; score: number }
    const candidates: Candidate[] = []
    for (const k of Object.keys(oldT) as BrandPresetKey[]) {
      if (!changedSet.has(k)) continue
      const p = oldT[k]
      const presetFamily = p.fontFamily ?? oldBrandFont ?? null
      // OBRIGATORIOS: fontSize bate exato. fontFamily bate OU layer eh null
      // (herda). Sem isso, layer com fontSize diferente nao eh esse preset.
      if (layerSize !== p.fontSize) continue
      if (layerFamily !== null && layerFamily !== presetFamily) continue
      // BONUS: outros campos sao "tie breakers" — quanto mais batem, mais
      // confianca de que esse eh o preset certo. Se PSD entrega leadingPt
      // diferente do preset (comum), ainda pode ser match valido.
      let score = 2 // fontSize + (fontFamily ou null)
      if (layerWeight !== null && layerWeight === p.fontWeight) score++
      if (layerLeading !== null && layerLeading === p.leadingPt) score++
      if (layerCharSpacing !== null && layerCharSpacing === p.charSpacing) score++
      candidates.push({ key: k, score })
    }
    if (candidates.length === 0) return null
    // Pega o candidato com MAIOR score. Se empate no maior, eh ambiguo → null.
    candidates.sort((a, b) => b.score - a.score)
    if (candidates.length >= 2 && candidates[0].score === candidates[1].score) return null
    return candidates[0].key
  }

  /**
   * Aplica propagacao de PRESET (todos campos) E BRAND FONT a um override de
   * layer. Combina regras:
   *  - Se asset tem brandPresetKey (propag setado) E layer nao customizado →
   *    aplica todos campos do novo preset.
   *  - Senao, tenta FUZZY MATCH contra os presets antigos (valores batem com
   *    1 preset unico) → aplica preset novo correspondente.
   *  - INDEPENDENTE: brandFont mudou + override.fontFamily === oldBrandFont
   *    → atualiza fontFamily (per-char styles tambem).
   * Retorna o novo override se ALGO mudou, undefined senao.
   */
  function propagateInLayerOverrides(layer: any): any | undefined {
    const assetId = layer?.assetId
    const ov = layer?.overrides ?? {}
    let newOv: any = ov
    let dirty = false

    // Sinal EXPLICITO do user: dsLinked=false significa que ele customizou
    // algum aspecto do layer via Properties Panel (tipografia ou cor). Mesmo
    // que hasTypoOverride seja false (ex: customizou so cor), nao propaga
    // preset por cima pra nao "religar" silenciosamente o que o user
    // explicitamente desvinculou.
    const dsLinkedExplicitlyFalse = ov?.dsLinked === false

    // (A) PRESET propagation — caminho explicito via brandPresetKey
    const propag = assetId ? propagateMap.get(assetId) : undefined
    if (propag) {
      const layerSnap = {
        fontWeight: Number.isFinite(ov.fontWeight) ? ov.fontWeight : (typeof ov.fontWeight === "string" ? Number(ov.fontWeight) || propag.oldSnap.fontWeight : propag.oldSnap.fontWeight),
        fontSize:   Number.isFinite(ov.fontSize)   ? ov.fontSize   : propag.oldSnap.fontSize,
        leadingPt:  Number.isFinite(ov.leadingPt)  ? ov.leadingPt  : propag.oldSnap.leadingPt,
        charSpacing: Number.isFinite(ov.charSpacing) ? ov.charSpacing : propag.oldSnap.charSpacing,
        fontFamily: typeof ov.fontFamily === "string" ? ov.fontFamily : propag.oldSnap.fontFamily,
      }
      const hasTypoOverride = ov.fontSize !== undefined
        || ov.fontWeight !== undefined
        || ov.leadingPt !== undefined
        || ov.charSpacing !== undefined
        || ov.fontFamily !== undefined
      const allowPropagate = !dsLinkedExplicitlyFalse
        && (!hasTypoOverride || presetsEqual(layerSnap, propag.oldSnap))
      if (allowPropagate) {
        newOv = applyPresetToOverride(newOv, propag.newSnap)
        dirty = true
      }
    } else if (!dsLinkedExplicitlyFalse) {
      // (A') FUZZY MATCH — pra layers de PSD imports sem brandPresetKey.
      // Se valores tipograficos batem com 1 preset velho unico, propaga.
      // dsLinked=false bloqueia mesmo fuzzy match — user customizou
      // intencionalmente, server nao deve adivinhar.
      const matchedKey = fuzzyMatchPreset(newOv)
      if (matchedKey && changedSet.has(matchedKey)) {
        newOv = applyPresetToOverride(newOv, newT[matchedKey])
        dirty = true
      }
    }

    // (B) BRAND FONT propagation — independente de preset.
    // Cobre layers de PSD imports que herdam a fonte do brand sem brandPresetKey.
    if (brandFontChanged && newBrandFont && oldBrandFont) {
      let workingOv = newOv === ov ? { ...ov } : newOv
      let fontDirty = false
      if (workingOv.fontFamily === oldBrandFont) {
        workingOv.fontFamily = newBrandFont
        fontDirty = true
      }
      // Per-char styles tambem
      if (workingOv.styles && typeof workingOv.styles === "object") {
        const newStyles: any = {}
        let stylesDirty = false
        for (const lineKey of Object.keys(workingOv.styles)) {
          const line = workingOv.styles[lineKey]
          if (!line || typeof line !== "object") { newStyles[lineKey] = line; continue }
          const newLine: any = {}
          for (const colKey of Object.keys(line)) {
            const cs = line[colKey]
            if (cs && cs.fontFamily === oldBrandFont) {
              newLine[colKey] = { ...cs, fontFamily: newBrandFont }
              stylesDirty = true
            } else {
              newLine[colKey] = cs
            }
          }
          newStyles[lineKey] = newLine
        }
        if (stylesDirty) {
          workingOv.styles = newStyles
          fontDirty = true
        }
      }
      if (fontDirty) {
        newOv = workingOv
        dirty = true
      }
    }

    return dirty ? newOv : undefined
  }

  // 3) Propaga nos KVs.
  const kvs = await prisma.keyVision.findMany({
    where: { campaignId: { in: campaignIds } },
    select: { id: true, layers: true },
  })
  let kvsUpdated = 0
  for (const kv of kvs) {
    const layers: any[] = parseJson(kv.layers) ?? []
    if (!Array.isArray(layers) || layers.length === 0) continue
    let dirty = false
    for (const layer of layers) {
      const newOv = propagateInLayerOverrides(layer)
      if (newOv) {
        layer.overrides = newOv
        dirty = true
      }
    }
    if (dirty) {
      await prisma.keyVision.update({
        where: { id: kv.id },
        data: { layers: JSON.stringify(layers) },
      })
      kvsUpdated++
    }
  }

  // 4) Propaga nas Pieces. Mesma logica, mas Piece.data.layers em vez de KV.layers.
  const pieces = await prisma.piece.findMany({
    where: { campaignId: { in: campaignIds } },
    select: { id: true, data: true },
  })
  let piecesUpdated = 0
  for (const piece of pieces) {
    const pdata: any = parseJson(piece.data)
    const layers: any[] = pdata?.layers
    if (!pdata || !Array.isArray(layers) || layers.length === 0) continue
    let dirty = false
    for (const layer of layers) {
      const newOv = propagateInLayerOverrides(layer)
      if (newOv) {
        layer.overrides = newOv
        dirty = true
      }
    }
    if (dirty) {
      await prisma.piece.update({
        where: { id: piece.id },
        data: { data: JSON.stringify({ ...pdata, layers }) },
      })
      piecesUpdated++
    }
  }

  return { assets: assetsUpdated, kvs: kvsUpdated, pieces: piecesUpdated }
}
