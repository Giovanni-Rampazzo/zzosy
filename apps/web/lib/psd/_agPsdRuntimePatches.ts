/**
 * Runtime patches do ag-psd via deep `require()`.
 *
 * Por que isolado: tinha IIFE em reader.ts top-level fazendo
 * `require("ag-psd/dist/descriptor.js")` direto. Funciona em CJS mas eh
 * fragil — Next.js 16 / Turbopack pode externalizar ag-psd e o deep path
 * deixa de bater (build quebrou 2026-05-29 com agPsdEffectsPatch.ts via
 * import ESM). Aqui mantemos require() (forca CJS resolution, mais robusto
 * que ESM static import deep), centralizamos os patches e adicionamos
 * version-check pra avisar quando ag-psd subir e o patch precisar revisar.
 *
 * Quando ag-psd subir de versao:
 *   1. Atualiza EXPECTED_VERSION abaixo
 *   2. Roda os smoke tests (lib/psd/__test__/*)
 *   3. Verifica que stroke vstk ainda eh extraido (sintoma do bug original)
 *
 * Patches aplicados:
 *
 * #1 ENUM.decode tolerante a forma HUMANA do descritor
 *    Bug ag-psd v18..v30: ENUM.decode espera PSD code (ex: 'BlnM.Nrml') mas
 *    Photoshop CC as vezes salva 'BlnM.normal'. split('.')[1] = 'normal' nao
 *    existe no rev map → throw "Unrecognized value for enum". O throw acontece
 *    no vstk handler (BlnM.decode(strokeStyleBlendMode)). ag-psd captura
 *    silenciosamente e NUNCA seta vectorStroke → shape importa sem stroke.
 *    Fix: tenta PSD code primeiro, fallback pra forma humana (split + return).
 *
 * lrFX/lfx2 layer effects sao patchados via patch-package em node_modules/
 * (vide patches/ag-psd+30.1.1.patch). Mecanismos diferentes — esse arquivo
 * cobre patches que precisam acessar internals em runtime.
 */

// Casado a esta versao. Se ag-psd subir e os caminhos `dist/descriptor.js`
// mudarem OU o shape dos enums mudar, patchModule vai falhar silencioso —
// o version-check abaixo loga warning pra obrigar revisao.
const EXPECTED_VERSION = "30.1.1"

const ENUM_TARGETS = [
  "BlnM",
  "strokeStyleLineCapType",
  "strokeStyleLineJoinType",
  "strokeStyleLineAlignment",
] as const

declare const require: any

function patchEnumModule(mod: any): boolean {
  if (!mod || mod.__zzosyEnumPatched) return false
  let patchedAny = false
  for (const name of ENUM_TARGETS) {
    const e = mod[name]
    if (!e || typeof e.decode !== "function" || e.__zzosyPatched) continue
    const orig = e.decode
    e.decode = function (val: string) {
      try { return orig(val) }
      catch (err) {
        if (typeof val === "string" && val.includes(".")) {
          return val.split(".")[1]
        }
        throw err
      }
    }
    e.__zzosyPatched = true
    patchedAny = true
  }
  if (patchedAny) mod.__zzosyEnumPatched = true
  return patchedAny
}

function checkVersion(): boolean {
  try {
    const pkg = require("ag-psd/package.json")
    const v = pkg?.version
    if (v !== EXPECTED_VERSION) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ag-psd runtime patches] versao instalada ${v} != esperada ${EXPECTED_VERSION}. ` +
        `Revise lib/psd/_agPsdRuntimePatches.ts + patches/ag-psd+*.patch antes de fazer deploy.`
      )
      return false
    }
    return true
  } catch {
    return false
  }
}

let applied = false

/**
 * Aplica os patches runtime do ag-psd UMA vez. Idempotente.
 * Chamado top-level em lib/psd/reader.ts.
 */
export function applyAgPsdRuntimePatches(): void {
  if (applied) return
  applied = true

  if (typeof require !== "function") {
    // ESM-only context (raro pra rotas server). Nada a fazer aqui — o
    // patch-package via postinstall ainda cobre lrFX. ENUM patches ficam
    // sem efeito; bug nominal (stroke sem fill em PSDs com forma humana).
    return
  }

  checkVersion()

  // Tenta multiplas variantes do caminho do modulo (dist em prod, dist-es em
  // alguns bundlers). require() resolve via CJS — robusto em Next.js.
  const candidates = ["ag-psd/dist/descriptor.js", "ag-psd/dist-es/descriptor.js"]
  let anyPatched = false
  for (const c of candidates) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(c)
      if (patchEnumModule(mod)) anyPatched = true
    } catch { /* tenta proximo */ }
  }
  if (!anyPatched) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ag-psd runtime patches] nenhum dos caminhos ${candidates.join(", ")} resolveu. ` +
      `Patches de ENUM.decode NAO aplicados. PSDs com forma HUMANA em descritores podem perder vectorStroke.`
    )
  }
}
