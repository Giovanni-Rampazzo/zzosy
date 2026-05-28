"use client"
/**
 * ActiveClientContext — guarda o cliente "ativo" no contexto da navegação atual.
 * Páginas que abrem um recurso de cliente (campaign, editor, piece, etc) chamam
 * `useSetActiveClient(client)` num useEffect ao montar. TopNav consome via
 * `useActiveClient()` pra mostrar o logo do cliente no lugar do logo ZZOSY.
 *
 * Páginas globais sem contexto de cliente (dashboard, /campaigns, /pieces lista)
 * chamam `useSetActiveClient(null)` pra limpar.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react"

export interface ActiveClient {
  id: string
  name: string
  brandLogoUrl?: string | null
}

interface ActiveClientContextValue {
  client: ActiveClient | null
  set: (c: ActiveClient | null) => void
}

const Ctx = createContext<ActiveClientContextValue>({ client: null, set: () => {} })

export function ActiveClientProvider({ children }: { children: React.ReactNode }) {
  const [client, set] = useState<ActiveClient | null>(null)
  return <Ctx.Provider value={{ client, set }}>{children}</Ctx.Provider>
}

export function useActiveClient(): ActiveClient | null {
  return useContext(Ctx).client
}

/**
 * Hook pra setar o cliente ativo no mount + limpar no unmount.
 * Use em páginas que carregam um recurso de cliente.
 *
 * @example
 *   useSetActiveClient(campaign?.client ? {
 *     id: campaign.client.id,
 *     name: campaign.client.name,
 *     brandLogoUrl: campaign.client.brandLogoUrl,
 *   } : null)
 */
export function useSetActiveClient(client: ActiveClient | null | undefined) {
  const { set } = useContext(Ctx)
  // Stringify pra evitar re-set quando ref muda mas conteudo eh igual
  const key = client ? `${client.id}|${client.name}|${client.brandLogoUrl ?? ""}` : ""
  const setter = useCallback(() => {
    set(client ?? null)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setter()
    return () => set(null)
  }, [setter, set])
}
