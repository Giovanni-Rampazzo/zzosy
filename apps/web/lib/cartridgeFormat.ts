/**
 * Versioning + parsing de cartridge .zzosy. Permite breaking changes futuras
 * sem perder import de cartuchos antigos.
 *
 * Politica:
 *  - LATEST = versao gerada por export atual
 *  - SUPPORTED = lista de versoes que o import sabe ler
 *  - Cartucho com format fora de SUPPORTED → erro claro de incompatibilidade
 *  - parseCartridgeManifest devolve manifest NORMALIZADO no formato LATEST
 *    (parser por versao faz upgrade in-memory).
 */

export const CARTRIDGE_FORMAT_LATEST = "zzosy-cartridge-v1" as const

/** Versoes que sabemos ler/normalizar pro shape interno atual. */
export const CARTRIDGE_FORMAT_SUPPORTED = [
  "zzosy-cartridge-v1",
  // Quando vier v2 com breaking change: adicionar aqui + parser dedicado.
] as const

export type CartridgeFormatVersion = typeof CARTRIDGE_FORMAT_SUPPORTED[number]

export interface CartridgeAssetManifest {
  slotKey: string | null
  name: string
  type: string
  content?: any
  lastOverride?: any
  tags?: string[]
  notes?: string | null
  meta?: Record<string, unknown>
  binary?: string
  thumbnail?: string
  smartObject?: {
    binary: string
    mime: string
    originalName: string
    width?: number | null
    height?: number | null
    sizeBytes?: number
  }
  /** Forward-compat: posicao opcional pra cartridges gerados de campanha snapshot. */
  posX?: number
  posY?: number
  width?: number
  height?: number
}

export interface CartridgeManifest {
  format: CartridgeFormatVersion
  name: string
  sourceClient?: string
  createdAt: string
  assets: CartridgeAssetManifest[]
}

export class CartridgeFormatError extends Error {
  constructor(message: string, public readonly receivedFormat?: string) {
    super(message)
    this.name = "CartridgeFormatError"
  }
}

/**
 * Parseia + valida manifest. Throws CartridgeFormatError em incompatibilidade.
 * Retorna manifest sempre no shape LATEST (parser auto-upgrade).
 */
export function parseCartridgeManifest(rawJson: string): CartridgeManifest {
  let parsed: any
  try { parsed = JSON.parse(rawJson) }
  catch { throw new CartridgeFormatError("manifest.json invalido — JSON malformado") }

  if (!parsed || typeof parsed !== "object") {
    throw new CartridgeFormatError("manifest.json deve ser objeto")
  }
  const fmt = parsed.format
  if (typeof fmt !== "string") {
    throw new CartridgeFormatError("manifest.format ausente")
  }
  if (!(CARTRIDGE_FORMAT_SUPPORTED as readonly string[]).includes(fmt)) {
    throw new CartridgeFormatError(
      `Versao de cartridge nao suportada: "${fmt}". Suportadas: ${CARTRIDGE_FORMAT_SUPPORTED.join(", ")}. Atualize o ZZOSY pra versao mais recente.`,
      fmt,
    )
  }

  // V1: shape ja eh o LATEST. Quando v2 vier, switch case faz upgrade.
  switch (fmt as CartridgeFormatVersion) {
    case "zzosy-cartridge-v1":
      return normalizeV1(parsed)
    default:
      throw new CartridgeFormatError(`Parser nao implementado pra ${fmt}`, fmt)
  }
}

function normalizeV1(raw: any): CartridgeManifest {
  return {
    format: "zzosy-cartridge-v1",
    name: raw.name ?? "Untitled cartridge",
    sourceClient: raw.sourceClient,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    assets: Array.isArray(raw.assets) ? raw.assets : [],
  }
}

/**
 * Gera manifest na versao LATEST. Usado pelo export.
 */
export function buildCartridgeManifest(input: {
  name: string
  sourceClient?: string
  assets: CartridgeAssetManifest[]
}): CartridgeManifest {
  return {
    format: CARTRIDGE_FORMAT_LATEST,
    name: input.name,
    sourceClient: input.sourceClient,
    createdAt: new Date().toISOString(),
    assets: input.assets,
  }
}
