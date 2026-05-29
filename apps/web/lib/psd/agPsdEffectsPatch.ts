/**
 * Patch do ag-psd v30.x para layer effects (chunk `lrFX`).
 *
 * BUG ORIGEM: `readEffects` em ag-psd/effectsHelpers.js tem switch case que
 * `throw new Error(...)` em varias situacoes:
 *   1. Default case: type desconhecido (ex: 'glwS' moderno, etc)
 *   2. Common state com visible=false → throw "Invalid effects common state"
 *   3. Shadow/glow/bevel com blockSize fora do esperado → throw
 *
 * Como readEffects eh chamado em lrFX handler:
 *     target.effects = readEffects(reader)
 * o throw acontece ANTES da atribuicao — `target.effects` fica undefined,
 * perdendo TODOS os effects (mesmo os ja parseados antes do throw).
 *
 * Resultado pratico: PSDs com effects modernos no chunk lrFX (color overlay,
 * gradient overlay, stroke modernos) perdem TUDO no import. Layer renderiza
 * sem tint/overlay aplicado. Sintoma reportado 2026-05-29: Cata vento branco
 * em vez de verde semi-transparente.
 *
 * Fix: substitui o read handler do `lrFX` com versao tolerante:
 *   - Cada effect parsed individualmente
 *   - Throw em qualquer case → marca effect como "skipped", continua loop
 *   - Default (unknown type): le blockSize, pula, continua
 *   - Effects parseados ANTES do throw sao preservados
 *
 * lfx2 (modern descriptor-based) NAO precisa patch — parseEffects ja eh
 * robusto. Esse patch eh so pra lrFX (legacy format usado em PSDs com origem
 * em PS 5-CC).
 *
 * IDEMPOTENTE: applied flag previne re-patch.
 * Compat: ag-psd v30.1.1. Re-validar em upgrades.
 */

import { infoHandlers as agPsdInfoHandlersEsm } from "ag-psd/dist-es/additionalInfo"
import {
  checkSignature, readSignature, skipBytes,
  readUint16, readUint8, readUint32, readFixedPoint32,
  readColor,
} from "ag-psd/dist-es/psdReader"
import { toBlendMode } from "ag-psd/dist-es/helpers"

// Em Next.js App Router (ESM), o import acima compartilha modulo com ag-psd.
// Em CJS (Pages Router, node scripts, bundled webpack), readPsd carrega
// dist/additionalInfo.js (instancia separada do dist-es/additionalInfo.js).
// Nesse caso o patch via dist-es nao surte efeito. Tentamos tambem o CJS path
// via require dinamico — se require nao existe (ESM puro), no-op silencioso.
declare const require: any
function getCjsInfoHandlers(): any[] | null {
  try {
    if (typeof require !== "function") return null
    const mod = require("ag-psd/dist/additionalInfo")
    return mod?.infoHandlers ?? null
  } catch { return null }
}

interface PsdReaderLike {
  view: DataView
  offset: number
  log: (msg: string) => void
  logMissingFeatures?: boolean
}

interface LeftFn { (): number }

const BEVEL_STYLES = [
  undefined, "outer bevel", "inner bevel", "emboss", "pillow emboss", "stroke emboss",
] as const

function readBlendMode(reader: PsdReaderLike): string {
  checkSignature(reader as any, "8BIM")
  const sig = readSignature(reader as any)
  return (toBlendMode as any)[sig] || "normal"
}

function readFixedPoint8(reader: PsdReaderLike): number {
  return readUint8(reader as any) / 0xff
}

/**
 * Re-implementacao tolerante de readEffects. Mesma estrutura case-by-case
 * do ag-psd v30.x MAS:
 *  - cmnS com visible=false → marca effects.disabled (nao throw)
 *  - blockSize fora do esperado → tenta parsear mesmo assim (logs warning)
 *  - Default case (unknown type) → le blockSize, pula bytes, continua
 *  - Qualquer throw em case individual → save partial, abort loop
 */
function readEffectsForgiving(reader: PsdReaderLike): any {
  const log = (m: string) => {
    if (reader.logMissingFeatures) reader.log(m)
  }
  const version = readUint16(reader as any)
  if (version !== 0) {
    log(`[agPsdEffectsPatch] lrFX version unsupported: ${version}`)
    return undefined
  }
  const effectsCount = readUint16(reader as any)
  const effects: any = {}

  for (let i = 0; i < effectsCount; i++) {
    try {
      checkSignature(reader as any, "8BIM")
      const type = readSignature(reader as any)
      switch (type) {
        case "cmnS": {
          const size = readUint32(reader as any)
          const cmnVersion = readUint32(reader as any)
          const visible = !!readUint8(reader as any)
          skipBytes(reader as any, 2)
          if (size !== 7 || cmnVersion !== 0) {
            // Format invalido — bytes seguintes mal-alinhados. Abort com o que ja temos.
            log(`[agPsdEffectsPatch] cmnS malformado (size=${size}, version=${cmnVersion}) — abort loop`)
            return effects
          }
          if (!visible) effects.disabled = true
          break
        }
        case "dsdw":
        case "isdw": {
          const blockSize = readUint32(reader as any)
          readUint32(reader as any) // version
          const size = readFixedPoint32(reader as any)
          readFixedPoint32(reader as any) // intensity
          const angle = readFixedPoint32(reader as any)
          const distance = readFixedPoint32(reader as any)
          const color = readColor(reader as any)
          const blendMode = readBlendMode(reader)
          const enabled = !!readUint8(reader as any)
          const useGlobalLight = !!readUint8(reader as any)
          const opacity = readFixedPoint8(reader)
          if (blockSize >= 51) readColor(reader as any) // native color
          const shadowInfo = {
            size: { units: "Pixels", value: size },
            distance: { units: "Pixels", value: distance },
            angle, color, blendMode, enabled, useGlobalLight, opacity,
          }
          if (type === "dsdw") effects.dropShadow = [shadowInfo]
          else effects.innerShadow = [shadowInfo]
          break
        }
        case "oglw": {
          const blockSize = readUint32(reader as any)
          readUint32(reader as any) // version
          const size = readFixedPoint32(reader as any)
          readFixedPoint32(reader as any) // intensity
          const color = readColor(reader as any)
          const blendMode = readBlendMode(reader)
          const enabled = !!readUint8(reader as any)
          const opacity = readFixedPoint8(reader)
          if (blockSize >= 42) readColor(reader as any) // native color
          effects.outerGlow = {
            size: { units: "Pixels", value: size },
            color, blendMode, enabled, opacity,
          }
          break
        }
        case "iglw": {
          const blockSize = readUint32(reader as any)
          readUint32(reader as any) // version
          const size = readFixedPoint32(reader as any)
          readFixedPoint32(reader as any) // intensity
          const color = readColor(reader as any)
          const blendMode = readBlendMode(reader)
          const enabled = !!readUint8(reader as any)
          const opacity = readFixedPoint8(reader)
          if (blockSize >= 43) {
            readUint8(reader as any) // inverted
            readColor(reader as any) // native color
          }
          effects.innerGlow = {
            size: { units: "Pixels", value: size },
            color, blendMode, enabled, opacity,
          }
          break
        }
        case "bevl": {
          const blockSize = readUint32(reader as any)
          readUint32(reader as any) // version
          const angle = readFixedPoint32(reader as any)
          const strength = readFixedPoint32(reader as any)
          const size = readFixedPoint32(reader as any)
          const highlightBlendMode = readBlendMode(reader)
          const shadowBlendMode = readBlendMode(reader)
          const highlightColor = readColor(reader as any)
          const shadowColor = readColor(reader as any)
          const style = BEVEL_STYLES[readUint8(reader as any)] || "inner bevel"
          const highlightOpacity = readFixedPoint8(reader)
          const shadowOpacity = readFixedPoint8(reader)
          const enabled = !!readUint8(reader as any)
          const useGlobalLight = !!readUint8(reader as any)
          const direction = readUint8(reader as any) ? "down" : "up"
          if (blockSize >= 78) {
            readColor(reader as any) // real highlight
            readColor(reader as any) // real shadow
          }
          effects.bevel = {
            size: { units: "Pixels", value: size },
            angle, strength, highlightBlendMode, shadowBlendMode,
            highlightColor, shadowColor, style,
            highlightOpacity, shadowOpacity, enabled, useGlobalLight, direction,
          }
          break
        }
        case "sofi": {
          const size = readUint32(reader as any)
          readUint32(reader as any) // version
          const blendMode = readBlendMode(reader)
          const color = readColor(reader as any)
          const opacity = readFixedPoint8(reader)
          const enabled = !!readUint8(reader as any)
          readColor(reader as any) // native color
          if (size !== 34) {
            log(`[agPsdEffectsPatch] sofi size inesperado: ${size} (esperado 34) — campo lido OK`)
          }
          effects.solidFill = [{ blendMode, color, opacity, enabled }]
          break
        }
        default: {
          // Unknown effect type — le blockSize e pula
          const blockSize = readUint32(reader as any)
          skipBytes(reader as any, blockSize)
          log(`[agPsdEffectsPatch] effect type desconhecido '${type}' (${blockSize}b) — pulado`)
          break
        }
      }
    } catch (e) {
      log(`[agPsdEffectsPatch] erro lendo effect #${i}: ${String((e as any)?.message ?? e)} — parse parou aqui, preservando ${Object.keys(effects).length} effects ja lidos`)
      break
    }
  }

  return effects
}

let applied = false

/**
 * Aplica o patch UMA VEZ. Idempotente — chamadas subsequentes sao no-op.
 * Importar este modulo + chamar applyAgPsdEffectsPatch() no boot do reader.
 */
export function applyAgPsdEffectsPatch(): void {
  if (applied) return
  applied = true

  function patchedLrFxRead(this: any, reader: PsdReaderLike, target: any, left: LeftFn) {
    if (target.effects) {
      // ag-psd ja populou (ex: lmfx leu antes) — skip
      skipBytes(reader as any, left())
      return
    }
    const parsed = readEffectsForgiving(reader)
    if (parsed && Object.keys(parsed).length > 0) target.effects = parsed
    if (left() > 0) skipBytes(reader as any, left())
  }

  function patchOne(handlers: any[] | null | undefined, label: string): boolean {
    if (!Array.isArray(handlers)) return false
    const h = handlers.find((x: any) => x?.key === "lrFX")
    if (!h) return false
    h.read = patchedLrFxRead
    if (typeof console !== "undefined") console.log(`[agPsdEffectsPatch] patched lrFX in ${label}`)
    return true
  }

  const patchedEsm = patchOne(agPsdInfoHandlersEsm as any, "dist-es")
  const patchedCjs = patchOne(getCjsInfoHandlers(), "dist")

  if (!patchedEsm && !patchedCjs && typeof console !== "undefined") {
    console.warn("[agPsdEffectsPatch] lrFX handler nao encontrado em ESM nem CJS — ag-psd reorganizou? Patch nao aplicado.")
  }
}
